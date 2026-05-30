import path from "path";
import fs from "fs";
import os from "os";
import { createHash, randomUUID } from "crypto";
import { unzipSync } from "fflate";
import { simpleGit } from "simple-git";
import { ok, err } from "../../types/result.js";
import type { Result } from "../../types/result.js";
import {
  gitOperation,
  gitOperationWithPath,
  fsOperation,
} from "../../utils/operationHelpers.js";
import { parseGithubRepo, GITHUB_HTTPS_PREFIX } from "./githubRepoParser.js";
import {
  resolveInstallPath,
  resolveUploadInstallPath,
} from "./pluginPaths.js";
import { listSkillsForPlugin, type SkillInfo } from "./pluginScanFs.js";
import { managedPluginStore } from "./managedPluginRegistry.js";
import type {
  ManagedBundleSource,
  ManagedPluginRecord,
} from "./managedPluginRegistry.js";
import { getDb } from "../../database/index.js";
import { logger } from "../../utils/logger.js";

const PLUGIN_MANIFEST_RELATIVE_PATHS = [
  path.join(".codex-plugin", "plugin.json"),
  path.join(".claude-plugin", "plugin.json"),
];

export const MAX_BUNDLE_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_TOTAL_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_BUNDLE_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_BUNDLE_ENTRY_COUNT = 500;

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_U16_SENTINEL = 0xffff;
const ZIP64_U32_SENTINEL = 0xffffffff;
const ZIP_SYMLINK_FILE_TYPE = 0xa000;
const ZIP_FILE_TYPE_MASK = 0xf000;

interface ParsedZipEntry {
  normalizedName: string;
  isDirectory: boolean;
  uncompressedSize: number;
}

interface ExtractedBundleMetadata {
  displayName: string;
  description: string | null;
  skills: SkillInfo[];
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function getPluginMetadataFailureReason(errors: unknown[]): string {
  if (errors.some((error) => error instanceof SyntaxError)) {
    return "JSON 損毀";
  }

  const fileError = errors.find(
    (error): error is NodeJS.ErrnoException =>
      error instanceof Error && "code" in error,
  );
  if (fileError?.code === "ENOENT") {
    return "檔案不存在";
  }
  if (fileError?.code === "EACCES") {
    return "權限不足";
  }

  const firstError = errors[0];
  return firstError instanceof Error ? firstError.message : String(firstError);
}

function stripArchiveExtension(filename: string): string {
  return filename.replace(/\.zip$/i, "");
}

function createBundleError(code: string, message: string): string {
  return `${code}:${message}`;
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectoryOffset(
  archiveBytes: Uint8Array,
): number | null {
  if (archiveBytes.byteLength < 22) {
    return null;
  }

  const view = new DataView(
    archiveBytes.buffer,
    archiveBytes.byteOffset,
    archiveBytes.byteLength,
  );
  const minOffset = Math.max(0, archiveBytes.byteLength - 0xffff - 22);
  for (let offset = archiveBytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32LE(view, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return null;
}

function validateZipEntryPath(
  destinationPath: string,
  normalizedName: string,
): Result<string> {
  const pureParts = normalizedName.split("/").filter(Boolean);
  if (
    normalizedName.startsWith("/") ||
    pureParts.some((part) => part === "..")
  ) {
    return err(
      createBundleError(
        "BUNDLE_PATH_TRAVERSAL",
        `bundle 內含不安全路徑：${normalizedName}`,
      ),
    );
  }

  const destination = path.resolve(destinationPath);
  const targetPath = path.resolve(destination, ...pureParts);
  if (targetPath !== destination && !targetPath.startsWith(`${destination}${path.sep}`)) {
    return err(
      createBundleError(
        "BUNDLE_PATH_TRAVERSAL",
        `bundle 內含不安全路徑：${normalizedName}`,
      ),
    );
  }

  return ok(targetPath);
}

function parseZipEntries(archiveBytes: Uint8Array): Result<ParsedZipEntry[]> {
  const view = new DataView(
    archiveBytes.buffer,
    archiveBytes.byteOffset,
    archiveBytes.byteLength,
  );
  const eocdOffset = findEndOfCentralDirectoryOffset(archiveBytes);
  if (eocdOffset === null) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "上傳檔案不是合法的 ZIP bundle",
      ),
    );
  }

  const diskNumber = readUint16LE(view, eocdOffset + 4);
  const centralDirectoryDiskNumber = readUint16LE(view, eocdOffset + 6);
  const entriesOnThisDisk = readUint16LE(view, eocdOffset + 8);
  const totalEntries = readUint16LE(view, eocdOffset + 10);
  const centralDirectorySize = readUint32LE(view, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(view, eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDiskNumber !== 0 ||
    entriesOnThisDisk !== totalEntries
  ) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "目前不支援分割式 ZIP bundle",
      ),
    );
  }

  if (
    entriesOnThisDisk === ZIP64_U16_SENTINEL ||
    totalEntries === ZIP64_U16_SENTINEL ||
    centralDirectorySize === ZIP64_U32_SENTINEL ||
    centralDirectoryOffset === ZIP64_U32_SENTINEL
  ) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "目前不支援 ZIP64 格式的 bundle",
      ),
    );
  }

  if (totalEntries === 0) {
    return err(
      createBundleError(
        "EMPTY_BUNDLE_ARCHIVE",
        "bundle 壓縮檔內沒有任何內容",
      ),
    );
  }

  if (totalEntries > MAX_BUNDLE_ENTRY_COUNT) {
    return err(
      createBundleError(
        "BUNDLE_TOO_MANY_FILES",
        `bundle 檔案數量超過允許上限（${MAX_BUNDLE_ENTRY_COUNT} 個）`,
      ),
    );
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset >= archiveBytes.byteLength ||
    centralDirectoryEnd > archiveBytes.byteLength
  ) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "bundle 中央目錄資料損毀",
      ),
    );
  }

  const decoder = new TextDecoder();
  const entries: ParsedZipEntry[] = [];
  let totalUncompressedBytes = 0;
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > archiveBytes.byteLength) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          "bundle 中央目錄資料不完整",
        ),
      );
    }

    if (
      readUint32LE(view, cursor) !==
      ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE
    ) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          "bundle 中央目錄格式不正確",
        ),
      );
    }

    const compressedSize = readUint32LE(view, cursor + 20);
    const uncompressedSize = readUint32LE(view, cursor + 24);
    const fileNameLength = readUint16LE(view, cursor + 28);
    const extraFieldLength = readUint16LE(view, cursor + 30);
    const fileCommentLength = readUint16LE(view, cursor + 32);
    const externalAttributes = readUint32LE(view, cursor + 38);
    const localHeaderOffset = readUint32LE(view, cursor + 42);
    const fileNameOffset = cursor + 46;
    const nextCursor =
      fileNameOffset + fileNameLength + extraFieldLength + fileCommentLength;

    if (nextCursor > archiveBytes.byteLength) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          "bundle 中央目錄檔名資料不完整",
        ),
      );
    }

    if (
      compressedSize === ZIP64_U32_SENTINEL ||
      uncompressedSize === ZIP64_U32_SENTINEL ||
      localHeaderOffset === ZIP64_U32_SENTINEL
    ) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          "目前不支援 ZIP64 格式的 bundle",
        ),
      );
    }

    if (localHeaderOffset + 4 > archiveBytes.byteLength) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          "bundle local header 位址不合法",
        ),
      );
    }

    if (
      readUint32LE(view, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE
    ) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          "bundle local header 格式不正確",
        ),
      );
    }

    const normalizedName = decoder
      .decode(archiveBytes.subarray(fileNameOffset, fileNameOffset + fileNameLength))
      .replace(/\\/g, "/");
    if (!normalizedName) {
      cursor = nextCursor;
      continue;
    }

    const posixMode = (externalAttributes >>> 16) & 0xffff;
    if ((posixMode & ZIP_FILE_TYPE_MASK) === ZIP_SYMLINK_FILE_TYPE) {
      return err(
        createBundleError(
          "BUNDLE_SYMLINK_FORBIDDEN",
          `bundle 內含不允許的 symlink：${normalizedName}`,
        ),
      );
    }

    const pathResult = validateZipEntryPath(os.tmpdir(), normalizedName);
    if (!pathResult.success) {
      return pathResult;
    }

    const isDirectory = normalizedName.endsWith("/");
    if (!isDirectory) {
      if (uncompressedSize > MAX_BUNDLE_ENTRY_BYTES) {
        return err(
          createBundleError(
            "BUNDLE_ENTRY_TOO_LARGE",
            `bundle 內檔案超過允許的最大大小（${normalizedName}）`,
          ),
        );
      }

      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > MAX_BUNDLE_TOTAL_UNCOMPRESSED_BYTES) {
        return err(
          createBundleError(
            "BUNDLE_ARCHIVE_TOO_LARGE",
            "bundle 解壓後總大小超過允許上限（25 MB）",
          ),
        );
      }
    }

    entries.push({
      normalizedName,
      isDirectory,
      uncompressedSize,
    });
    cursor = nextCursor;
  }

  if (!entries.some((entry) => !entry.isDirectory)) {
    return err(
      createBundleError(
        "EMPTY_BUNDLE_ARCHIVE",
        "bundle 壓縮檔內沒有任何可匯入檔案",
      ),
    );
  }

  return ok(entries);
}

function createUploadSourceRef(archiveBytes: Uint8Array): string {
  return createHash("sha256").update(archiveBytes).digest("hex").slice(0, 32);
}

async function readUploadedArchiveBytes(file: File): Promise<Result<Uint8Array>> {
  if (file.size > MAX_BUNDLE_ARCHIVE_BYTES) {
    return err(
      createBundleError(
        "BUNDLE_FILE_TOO_LARGE",
        "bundle 壓縮檔超過允許的最大大小（10 MB）",
      ),
    );
  }

  try {
    return ok(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "無法讀取上傳的 bundle 壓縮檔",
      ),
    );
  }
}

async function extractZipArchiveToDirectory(
  archiveBytes: Uint8Array,
  destinationPath: string,
  entries: ParsedZipEntry[],
): Promise<Result<void>> {
  let extractedFiles: Record<string, Uint8Array>;
  try {
    extractedFiles = unzipSync(archiveBytes);
  } catch {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "上傳檔案不是合法的 ZIP bundle",
      ),
    );
  }

  for (const entry of entries) {
    const targetPathResult = validateZipEntryPath(
      destinationPath,
      entry.normalizedName,
    );
    if (!targetPathResult.success) {
      return targetPathResult;
    }

    if (entry.isDirectory) {
      await fs.promises.mkdir(targetPathResult.data, { recursive: true });
      continue;
    }

    const fileBytes = extractedFiles[entry.normalizedName];
    if (!(fileBytes instanceof Uint8Array)) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          `bundle 缺少檔案內容：${entry.normalizedName}`,
        ),
      );
    }

    if (fileBytes.byteLength !== entry.uncompressedSize) {
      return err(
        createBundleError(
          "INVALID_BUNDLE_ARCHIVE",
          `bundle 檔案大小驗證失敗：${entry.normalizedName}`,
        ),
      );
    }

    await fs.promises.mkdir(path.dirname(targetPathResult.data), {
      recursive: true,
    });
    await fs.promises.writeFile(targetPathResult.data, fileBytes);
  }

  return ok(undefined);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getFallbackSkillName(skills: SkillInfo[]): string | null {
  const firstNamedSkill = skills.find((skill) => skill.skillName.trim() !== "");
  if (!firstNamedSkill) {
    return null;
  }

  const normalized = firstNamedSkill.skillName.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? null;
}

function getSourceLabel(sourceType: ManagedBundleSource["type"]): string {
  return sourceType === "github" ? "GitHub" : "本地上傳";
}

async function extractOptionalPluginMetadata(
  installPath: string,
): Promise<{ displayName: string | null; description: string | null }> {
  const errors: unknown[] = [];

  for (const relativePath of PLUGIN_MANIFEST_RELATIVE_PATHS) {
    try {
      const metaPath = path.join(installPath, relativePath);
      const raw = await fs.promises.readFile(metaPath, "utf-8");
      const meta = JSON.parse(raw);
      return {
        displayName:
          typeof meta?.name === "string" && meta.name.trim().length > 0
            ? meta.name.trim()
            : null,
        description:
          typeof meta?.description === "string" && meta.description.trim()
            ? meta.description.trim()
            : null,
      };
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 0 || errors.every(isFileNotFoundError)) {
    return { displayName: null, description: null };
  }

  const reason = getPluginMetadataFailureReason(errors);
  logger.warn(
    "Plugin",
    "Warn",
    `讀取 bundle metadata 失敗，路徑: ${installPath}，原因: ${reason}`,
  );
  return { displayName: null, description: null };
}

async function extractBundleMetadata(
  installPath: string,
  fallbackDisplayName: string,
): Promise<Result<ExtractedBundleMetadata>> {
  const skills = await listSkillsForPlugin(installPath);
  if (skills.length === 0) {
    return err("BUNDLE_SKILL_NOT_FOUND");
  }

  const manifestMetadata = await extractOptionalPluginMetadata(installPath);
  const firstSkillName = getFallbackSkillName(skills);
  const firstSkillDescription =
    skills.find((skill) => skill.description.trim().length > 0)?.description ??
    null;

  return ok({
    displayName:
      manifestMetadata.displayName ??
      firstSkillName ??
      fallbackDisplayName,
    description: manifestMetadata.description ?? firstSkillDescription,
    skills,
  });
}

async function removeDirectoryIfExists(targetPath: string): Promise<void> {
  await fs.promises.rm(targetPath, { recursive: true, force: true });
}

async function ensureBundleHasSkillsOrRollback(
  installPath: string,
  fallbackDisplayName: string,
): Promise<Result<ExtractedBundleMetadata>> {
  const metadataResult = await extractBundleMetadata(
    installPath,
    fallbackDisplayName,
  );

  if (metadataResult.success) {
    return metadataResult;
  }

  await removeDirectoryIfExists(installPath).catch(() => void 0);
  return metadataResult;
}

function parseBundleError(error: string): { code: string; message: string } {
  const separatorIndex = error.indexOf(":");
  if (separatorIndex === -1) {
    return { code: error, message: error };
  }

  return {
    code: error.slice(0, separatorIndex),
    message: error.slice(separatorIndex + 1),
  };
}

function createGithubSource(fullName: string): ManagedBundleSource {
  return { type: "github", ref: fullName };
}

function createUploadSource(sourceRef: string): ManagedBundleSource {
  return { type: "upload", ref: sourceRef };
}

function resolveRecordSource(
  record: Pick<ManagedPluginRecord, "id" | "githubRepo"> &
    Partial<Pick<ManagedPluginRecord, "source">>,
): ManagedBundleSource {
  if (record.source) {
    return record.source;
  }

  return createGithubSource(record.githubRepo || record.id);
}

function getExistingRecordBySource(
  source: ManagedBundleSource,
): ManagedPluginRecord | null {
  if (typeof managedPluginStore.getBySource === "function") {
    return managedPluginStore.getBySource(source);
  }

  if (
    source.type === "github" &&
    typeof managedPluginStore.getByGithubRepo === "function"
  ) {
    return managedPluginStore.getByGithubRepo(source.ref);
  }

  return null;
}

async function createRecord(
  source: ManagedBundleSource,
  installPath: string,
  displayName: string,
  description: string | null,
): Promise<ManagedPluginRecord> {
  const now = new Date().toISOString();
  const id =
    source.type === "github" ? source.ref : `upload:${source.ref}`;
  return managedPluginStore.insert({
    id,
    source,
    githubRepo: source.ref,
    displayName,
    description,
    installPath,
    installedAt: now,
    updatedAt: now,
  });
}

export async function installPlugin(
  githubRepo: string,
): Promise<Result<ManagedPluginRecord>> {
  const parsed = parseGithubRepo(githubRepo);
  if (!parsed) {
    return err("INVALID_GITHUB_REPO_FORMAT");
  }

  const { owner, repo, fullName } = parsed;
  const source = createGithubSource(fullName);
  if (getExistingRecordBySource(source)) {
    return err("PLUGIN_ALREADY_INSTALLED");
  }

  const installPath = resolveInstallPath(fullName);
  await removeDirectoryIfExists(installPath);

  const httpsUrl = `${GITHUB_HTTPS_PREFIX}${owner}/${repo}.git`;
  const cloneResult = await gitOperation(
    () => simpleGit().clone(httpsUrl, installPath),
    `clone bundle ${fullName}`,
  );
  if (!cloneResult.success) {
    return err(
      typeof cloneResult.error === "string"
        ? cloneResult.error
        : cloneResult.error.key,
    );
  }

  const metadataResult = await ensureBundleHasSkillsOrRollback(installPath, repo);
  if (!metadataResult.success) {
    return err(metadataResult.error);
  }

  const record = await createRecord(
    source,
    installPath,
    metadataResult.data.displayName,
    metadataResult.data.description,
  );
  return ok(record);
}

export async function importBundleArchive(
  file: File,
): Promise<Result<ManagedPluginRecord>> {
  const archiveBytesResult = await readUploadedArchiveBytes(file);
  if (!archiveBytesResult.success) {
    return err(archiveBytesResult.error);
  }

  const archiveBytes = archiveBytesResult.data;
  const parsedEntriesResult = parseZipEntries(archiveBytes);
  if (!parsedEntriesResult.success) {
    return err(parsedEntriesResult.error);
  }

  const extractRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "agent-canvas-bundle-extract-"),
  );

  try {
    const extractResult = await extractZipArchiveToDirectory(
      archiveBytes,
      extractRoot,
      parsedEntriesResult.data,
    );
    if (!extractResult.success) {
      return err(extractResult.error);
    }

    const fallbackDisplayName = stripArchiveExtension(file.name) || "bundle";
    const metadataResult = await extractBundleMetadata(
      extractRoot,
      fallbackDisplayName,
    );
    if (!metadataResult.success) {
      return err(metadataResult.error);
    }

    const sourceRef = createUploadSourceRef(archiveBytes);
    const source = createUploadSource(sourceRef);
    if (getExistingRecordBySource(source)) {
      return err("PLUGIN_ALREADY_INSTALLED");
    }

    const installPath = resolveUploadInstallPath(sourceRef);
    await removeDirectoryIfExists(installPath);
    await fs.promises.mkdir(path.dirname(installPath), { recursive: true });
    await fs.promises.rename(extractRoot, installPath);

    const record = await createRecord(
      source,
      installPath,
      metadataResult.data.displayName,
      metadataResult.data.description,
    );
    return ok(record);
  } finally {
    await removeDirectoryIfExists(extractRoot).catch(() => void 0);
  }
}

export async function removePlugin(id: string): Promise<Result<void>> {
  const record = managedPluginStore.getById(id);
  if (!record) {
    return err("PLUGIN_NOT_FOUND");
  }

  const rmResult = await fsOperation(
    () => fs.promises.rm(record.installPath, { recursive: true, force: true }),
    `rm bundle dir ${record.installPath}`,
  );
  if (!rmResult.success) {
    return err(
      typeof rmResult.error === "string" ? rmResult.error : rmResult.error.key,
    );
  }

  getDb().prepare("DELETE FROM pod_plugin_ids WHERE plugin_id = ?").run(id);
  managedPluginStore.delete(id);

  return ok();
}

export async function updatePlugin(
  id: string,
): Promise<Result<ManagedPluginRecord>> {
  const record = managedPluginStore.getById(id);
  if (!record) {
    return err("PLUGIN_NOT_FOUND");
  }

  const source = resolveRecordSource(record);
  if (source.type !== "github") {
    return err("UPLOAD_BUNDLE_UPDATE_UNSUPPORTED");
  }

  const parsed = parseGithubRepo(source.ref);
  if (!parsed) {
    return err("INVALID_GITHUB_REPO_FORMAT");
  }

  const { owner, repo } = parsed;
  const stagingPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "agent-canvas-bundle-update-"),
  );
  try {
    const httpsUrl = `${GITHUB_HTTPS_PREFIX}${owner}/${repo}.git`;
    const cloneResult = await gitOperation(
      () => simpleGit().clone(httpsUrl, stagingPath),
      `update clone bundle ${source.ref}`,
    );
    if (!cloneResult.success) {
      return err(
        typeof cloneResult.error === "string"
          ? cloneResult.error
          : cloneResult.error.key,
      );
    }

    const metadataResult = await ensureBundleHasSkillsOrRollback(
      stagingPath,
      repo,
    );
    if (!metadataResult.success) {
      return err(metadataResult.error);
    }

    const backupPath = path.join(
      os.tmpdir(),
      `agent-canvas-bundle-backup-${randomUUID()}`,
    );
    const installPathExisted = await pathExists(record.installPath);

    if (installPathExisted) {
      const backupMoveResult = await fsOperation(
        () => fs.promises.rename(record.installPath, backupPath),
        `backup bundle dir ${record.installPath}`,
      );
      if (!backupMoveResult.success) {
        return err(
          typeof backupMoveResult.error === "string"
            ? backupMoveResult.error
            : backupMoveResult.error.key,
        );
      }
    }

    const activateResult = await fsOperation(
      async () => {
        await fs.promises.mkdir(path.dirname(record.installPath), {
          recursive: true,
        });
        await fs.promises.rename(stagingPath, record.installPath);
      },
      `activate updated bundle ${source.ref}`,
    );
    if (!activateResult.success) {
      if (installPathExisted) {
        await fs.promises.rename(backupPath, record.installPath).catch(
          () => void 0,
        );
      }
      return err(
        typeof activateResult.error === "string"
          ? activateResult.error
          : activateResult.error.key,
      );
    }

    const updatedRecord = managedPluginStore.update(id, {
      displayName: metadataResult.data.displayName,
      description: metadataResult.data.description,
      updatedAt: new Date().toISOString(),
    });

    if (!updatedRecord) {
      await removeDirectoryIfExists(record.installPath).catch(() => void 0);
      if (installPathExisted) {
        await fs.promises.rename(backupPath, record.installPath).catch(
          () => void 0,
        );
      }
      return err("PLUGIN_UPDATE_FAILED");
    }

    if (installPathExisted) {
      await removeDirectoryIfExists(backupPath).catch(() => void 0);
    }

    return ok(updatedRecord);
  } finally {
    await removeDirectoryIfExists(stagingPath).catch(() => void 0);
  }
}

export async function refreshAllPlugins(): Promise<
  Result<ManagedPluginRecord[]>
> {
  const records = managedPluginStore.list();

  const refreshOnePlugin = async (
    record: ManagedPluginRecord,
  ): Promise<ManagedPluginRecord> => {
    const source = resolveRecordSource(record);
    if (source.type !== "github") {
      return record;
    }

    const refreshResult = await gitOperationWithPath(
      record.installPath,
      async (git) => {
        await git.fetch();
        const head = await git.revparse(["HEAD"]);
        const remoteHead = await git.revparse(["@{u}"]);
        if (head !== remoteHead) {
          await git.pull();
          return true;
        }
        return false;
      },
      `refresh bundle ${source.ref}`,
    );

    if (refreshResult.success && refreshResult.data === true) {
      const updated = managedPluginStore.update(record.id, {
        updatedAt: new Date().toISOString(),
      });
      return updated ?? record;
    }

    return record;
  };

  const updatedRecords = await Promise.all(records.map(refreshOnePlugin));
  return ok(updatedRecords);
}

export function describePluginRecordSource(record: ManagedPluginRecord): string {
  return `${getSourceLabel(record.source.type)} · ${record.source.ref}`;
}

export function formatBundleImportError(error: string): string {
  const parsed = parseBundleError(error);
  switch (parsed.code) {
    case "BUNDLE_SKILL_NOT_FOUND":
      return "bundle 內找不到任何 SKILL.md";
    case "EMPTY_BUNDLE_ARCHIVE":
      return parsed.message;
    case "BUNDLE_PATH_TRAVERSAL":
      return parsed.message;
    case "BUNDLE_SYMLINK_FORBIDDEN":
      return parsed.message;
    case "INVALID_BUNDLE_ARCHIVE":
      return parsed.message;
    case "BUNDLE_FILE_TOO_LARGE":
      return parsed.message;
    case "BUNDLE_ENTRY_TOO_LARGE":
      return parsed.message;
    case "BUNDLE_ARCHIVE_TOO_LARGE":
      return parsed.message;
    case "BUNDLE_TOO_MANY_FILES":
      return parsed.message;
    default:
      return parsed.message;
  }
}
