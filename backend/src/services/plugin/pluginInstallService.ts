import path from "path";
import fs from "fs";
import os from "os";
import { createHash, randomUUID } from "crypto";
import { unzipSync } from "fflate";
import { simpleGit } from "simple-git";
import { err, getResultErrorString, ok } from "../../types/result.js";
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
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import { podStore } from "../podStore.js";
import type { Pod } from "../../types/pod.js";
import {
  isZip64Entry,
  isZip64EndRecord,
  isMultiDiskZip,
  isZipSymlink,
  openZipCentralDirectory,
  readCentralDirectoryEntryHeader,
  readUint32LE,
  ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE,
  ZIP_LOCAL_FILE_HEADER_SIGNATURE,
  type ZipCentralDirectoryEntryHeader,
  type ZipEndOfCentralDirectory,
} from "../../utils/zipCentralDirectory.js";

const PLUGIN_MANIFEST_RELATIVE_PATHS = [
  path.join(".codex-plugin", "plugin.json"),
  path.join(".claude-plugin", "plugin.json"),
];
const MARKETPLACE_MANIFEST_RELATIVE_PATH = ".agents/plugins/marketplace.json";

export const MAX_BUNDLE_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_TOTAL_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_BUNDLE_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_BUNDLE_ENTRY_COUNT = 500;

interface ParsedZipEntry {
  normalizedName: string;
  isDirectory: boolean;
  uncompressedSize: number;
}

interface BundleZipDirectoryBounds {
  totalEntries: number;
  centralDirectoryOffset: number;
}

interface ParsedBundleZipEntryAtCursor {
  entry: ParsedZipEntry | null;
  nextCursor: number;
}

interface ExtractedBundleMetadata {
  displayName: string;
  description: string | null;
  skills: SkillInfo[];
}

export interface BundleImportResult {
  plugin: ManagedPluginRecord;
  plugins: ManagedPluginRecord[];
  affectedPods: Array<{ canvasId: string; pod: Pod }>;
}

interface OptionalPluginMetadata {
  displayName: string | null;
  description: string | null;
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

  if (
    errors.some(
      (error) =>
        error instanceof Error && "code" in error && error.code === "EACCES",
    )
  ) {
    return "權限不足";
  }

  const actionableError = errors.find((error) => !isFileNotFoundError(error));
  if (actionableError !== undefined) {
    return actionableError instanceof Error
      ? actionableError.message
      : String(actionableError);
  }

  return "檔案不存在";
}

function stripArchiveExtension(filename: string): string {
  return filename.replace(/\.zip$/i, "");
}

function createBundleError(code: string, message: string): string {
  return `${code}:${message}`;
}

async function createInstallSiblingTempDirectory(
  installPath: string,
  prefix: string,
): Promise<string> {
  const installRoot = path.dirname(installPath);
  await fs.promises.mkdir(installRoot, { recursive: true });
  return fs.promises.mkdtemp(path.join(installRoot, prefix));
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

function validateBundleZipDirectory(
  endRecord: ZipEndOfCentralDirectory,
  archiveSize: number,
): Result<BundleZipDirectoryBounds> {
  const { totalEntries, centralDirectorySize, centralDirectoryOffset } =
    endRecord;

  if (isMultiDiskZip(endRecord)) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "目前不支援分割式 ZIP bundle",
      ),
    );
  }

  if (isZip64EndRecord(endRecord)) {
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
    centralDirectoryOffset >= archiveSize ||
    centralDirectoryEnd > archiveSize
  ) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "bundle 中央目錄資料損毀",
      ),
    );
  }

  return ok({ totalEntries, centralDirectoryOffset });
}

function readBundleZipEntryHeader(
  archiveBytes: Uint8Array,
  view: DataView,
  cursor: number,
): Result<ZipCentralDirectoryEntryHeader> {
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

  const header = readCentralDirectoryEntryHeader(view, cursor);
  const { localHeaderOffset, nextCursor } = header;

  if (nextCursor > archiveBytes.byteLength) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "bundle 中央目錄檔名資料不完整",
      ),
    );
  }

  if (isZip64Entry(header)) {
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

  return ok(header);
}

function parseBundleZipEntry(
  archiveBytes: Uint8Array,
  decoder: TextDecoder,
  header: ZipCentralDirectoryEntryHeader,
): Result<ParsedBundleZipEntryAtCursor> {
  const {
    uncompressedSize,
    fileNameLength,
    externalAttributes,
    fileNameOffset,
    nextCursor,
  } = header;

  const normalizedName = decoder
    .decode(archiveBytes.subarray(fileNameOffset, fileNameOffset + fileNameLength))
    .replace(/\\/g, "/");
  if (!normalizedName) {
    return ok({ entry: null, nextCursor });
  }

  if (isZipSymlink(externalAttributes)) {
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
  if (!isDirectory && uncompressedSize > MAX_BUNDLE_ENTRY_BYTES) {
    return err(
      createBundleError(
        "BUNDLE_ENTRY_TOO_LARGE",
        `bundle 內檔案超過允許的最大大小（${normalizedName}）`,
      ),
    );
  }

  return ok({
    entry: { normalizedName, isDirectory, uncompressedSize },
    nextCursor,
  });
}

function parseZipEntries(archiveBytes: Uint8Array): Result<ParsedZipEntry[]> {
  const openedDirectory = openZipCentralDirectory(archiveBytes);
  if (!openedDirectory) {
    return err(
      createBundleError(
        "INVALID_BUNDLE_ARCHIVE",
        "上傳檔案不是合法的 ZIP bundle",
      ),
    );
  }

  const { view, endRecord } = openedDirectory;
  const directoryResult = validateBundleZipDirectory(
    endRecord,
    archiveBytes.byteLength,
  );
  if (!directoryResult.success) return directoryResult;
  const { totalEntries, centralDirectoryOffset } = directoryResult.data;

  const decoder = new TextDecoder();
  const entries: ParsedZipEntry[] = [];
  let totalUncompressedBytes = 0;
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    const headerResult = readBundleZipEntryHeader(archiveBytes, view, cursor);
    if (!headerResult.success) return headerResult;

    const entryResult = parseBundleZipEntry(
      archiveBytes,
      decoder,
      headerResult.data,
    );
    if (!entryResult.success) return entryResult;

    const { entry, nextCursor } = entryResult.data;
    cursor = nextCursor;
    if (!entry) continue;

    if (!entry.isDirectory) {
      totalUncompressedBytes += entry.uncompressedSize;
      if (totalUncompressedBytes > MAX_BUNDLE_TOTAL_UNCOMPRESSED_BYTES) {
        return err(
          createBundleError(
            "BUNDLE_ARCHIVE_TOO_LARGE",
            "bundle 解壓後總大小超過允許上限（25 MB）",
          ),
        );
      }
    }

    entries.push(entry);
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
  const namedSkills = skills.filter((skill) => skill.skillName.trim() !== "");
  if (namedSkills.length !== 1) {
    return null;
  }

  const normalized = namedSkills[0]!.skillName.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readPluginMetadataFromDirectory(
  pluginPath: string,
  errors: unknown[],
): Promise<OptionalPluginMetadata | null> {
  for (const relativePath of PLUGIN_MANIFEST_RELATIVE_PATHS) {
    try {
      const raw = await fs.promises.readFile(
        path.join(pluginPath, relativePath),
        "utf-8",
      );
      const metadata: unknown = JSON.parse(raw);
      if (!isRecord(metadata)) {
        return { displayName: null, description: null };
      }

      return {
        displayName:
          typeof metadata.name === "string" && metadata.name.trim().length > 0
            ? metadata.name.trim()
            : null,
        description:
          typeof metadata.description === "string" &&
          metadata.description.trim()
            ? metadata.description.trim()
            : null,
      };
    } catch (error) {
      errors.push(error);
    }
  }

  return null;
}

function resolveSingleMarketplacePluginPath(
  installPath: string,
  marketplace: unknown,
): string | null {
  if (
    !isRecord(marketplace) ||
    !Array.isArray(marketplace.plugins) ||
    marketplace.plugins.length !== 1
  ) {
    return null;
  }

  const plugin = marketplace.plugins[0];
  const source = isRecord(plugin) ? plugin.source : null;
  if (
    !isRecord(source) ||
    source.source !== "local" ||
    typeof source.path !== "string"
  ) {
    return null;
  }

  const resolvedPath = path.resolve(installPath, source.path);
  if (!isPathWithinDirectory(resolvedPath, installPath)) {
    throw new Error("marketplace plugin 路徑超出 bundle 範圍");
  }

  return resolvedPath;
}

async function extractOptionalPluginMetadata(
  installPath: string,
): Promise<OptionalPluginMetadata> {
  const errors: unknown[] = [];

  const rootMetadata = await readPluginMetadataFromDirectory(
    installPath,
    errors,
  );
  if (rootMetadata) {
    return rootMetadata;
  }

  try {
    const marketplacePath = path.join(
      installPath,
      MARKETPLACE_MANIFEST_RELATIVE_PATH,
    );
    const raw = await fs.promises.readFile(marketplacePath, "utf-8");
    const pluginPath = resolveSingleMarketplacePluginPath(
      installPath,
      JSON.parse(raw),
    );
    if (pluginPath) {
      const nestedMetadata = await readPluginMetadataFromDirectory(
        pluginPath,
        errors,
      );
      if (nestedMetadata) {
        return nestedMetadata;
      }
    }
  } catch (error) {
    errors.push(error);
  }

  if (errors.every(isFileNotFoundError)) {
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

function createRecord(
  source: ManagedBundleSource,
  installPath: string,
  displayName: string,
  description: string | null,
  sortIndex?: number,
): ManagedPluginRecord {
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
    sortIndex,
    installedAt: now,
    updatedAt: now,
  });
}

function normalizePluginDisplayName(displayName: string | null): string {
  return displayName?.trim().toLowerCase() ?? "";
}

function findMatchingUploadedPlugins(
  displayName: string,
): ManagedPluginRecord[] {
  const normalizedName = normalizePluginDisplayName(displayName);
  return managedPluginStore
    .list()
    .filter(
      (plugin) =>
        plugin.source.type === "upload" &&
        normalizePluginDisplayName(plugin.displayName) === normalizedName,
    );
}

function collectAffectedPodIds(
  plugins: ManagedPluginRecord[],
): Array<{ canvasId: string; podId: string }> {
  const affectedPods = new Map<
    string,
    { canvasId: string; podId: string }
  >();

  for (const plugin of plugins) {
    for (const podEntry of podStore.getPodsByPluginIdGlobal(plugin.id)) {
      affectedPods.set(podEntry.pod.id, {
        canvasId: podEntry.canvasId,
        podId: podEntry.pod.id,
      });
    }
  }

  return [...affectedPods.values()];
}

type PluginPathBackups = Map<string, PluginInstallBackup>;

async function restorePluginPathBackups(
  backups: PluginPathBackups,
): Promise<void> {
  for (const [installPath, backup] of [...backups].reverse()) {
    await restorePluginInstall(installPath, backup);
  }
}

async function cleanupPluginPathBackups(
  backups: PluginPathBackups,
): Promise<void> {
  await Promise.all(
    [...backups.values()]
      .filter((backup) => backup.installPathExisted)
      .map((backup) =>
        removeDirectoryIfExists(backup.backupPath).catch(() => void 0),
      ),
  );
}

async function backupPluginPaths(
  installPaths: string[],
): Promise<Result<PluginPathBackups>> {
  const backups: PluginPathBackups = new Map();

  for (const installPath of [...new Set(installPaths)]) {
    const backupResult = await backupPluginInstall(installPath);
    if (!backupResult.success) {
      await restorePluginPathBackups(backups);
      return err(backupResult.error);
    }
    backups.set(installPath, backupResult.data);
  }

  return ok(backups);
}

function createBundleReplacementError(message: string): string {
  return createBundleError("BUNDLE_REPLACEMENT_FAILED", message);
}

function resolveAffectedPods(
  affectedPodIds: Array<{ canvasId: string; podId: string }>,
): Array<{ canvasId: string; pod: Pod }> {
  return affectedPodIds
    .map(({ canvasId, podId }) => {
      const podEntry = podStore.getByIdGlobal(podId);
      return podEntry ? { canvasId, pod: podEntry.pod } : null;
    })
    .filter(
      (entry): entry is { canvasId: string; pod: Pod } => entry !== null,
    );
}

async function activateUploadedPlugin(
  source: ManagedBundleSource,
  installPath: string,
  extractRoot: string,
  metadata: ExtractedBundleMetadata,
  matchingPlugins: ManagedPluginRecord[],
): Promise<Result<BundleImportResult>> {
  const affectedPodIds = collectAffectedPodIds(matchingPlugins);
  const earliestSortIndex =
    matchingPlugins.length > 0
      ? Math.min(...matchingPlugins.map((plugin) => plugin.sortIndex))
      : undefined;
  const backupResult = await backupPluginPaths([
    ...matchingPlugins.map((plugin) => plugin.installPath),
    installPath,
  ]);
  if (!backupResult.success) {
    return err(createBundleReplacementError("無法備份既有的本地 plugin"));
  }

  const backups = backupResult.data;
  const installPathBackup = backups.get(installPath)!;

  const activateResult = await activatePluginInstall(
    extractRoot,
    installPath,
    source.ref,
    installPathBackup,
  );
  if (!activateResult.success) {
    await restorePluginPathBackups(backups);
    return err(
      createBundleReplacementError("無法啟用新上傳的本地 plugin"),
    );
  }

  let plugin: ManagedPluginRecord;
  try {
    const db = getDb();
    const commitReplacement = db.transaction(() => {
      if (matchingPlugins.length > 0) {
        const deletePodBindings = db.prepare(
          "DELETE FROM pod_plugin_ids WHERE plugin_id = ?",
        );
        for (const matchingPlugin of matchingPlugins) {
          deletePodBindings.run(matchingPlugin.id);
          managedPluginStore.delete(matchingPlugin.id);
        }
      }

      return createRecord(
        source,
        installPath,
        metadata.displayName,
        metadata.description,
        earliestSortIndex,
      );
    });
    plugin = commitReplacement();
  } catch (error) {
    logger.error(
      "Plugin",
      "Error",
      "取代本地 plugin 的資料時失敗",
      error,
    );
    await removeDirectoryIfExists(installPath).catch(() => void 0);
    await restorePluginPathBackups(backups);
    return err(
      createBundleReplacementError("無法儲存新上傳的本地 plugin"),
    );
  }

  await cleanupPluginPathBackups(backups);
  return ok({
    plugin,
    plugins: managedPluginStore.list(),
    affectedPods: resolveAffectedPods(affectedPodIds),
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
  if (managedPluginStore.getBySource(source)) {
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
    return err(getResultErrorString(cloneResult.error));
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
): Promise<Result<BundleImportResult>> {
  const archiveBytesResult = await readUploadedArchiveBytes(file);
  if (!archiveBytesResult.success) {
    return err(archiveBytesResult.error);
  }

  const archiveBytes = archiveBytesResult.data;
  const parsedEntriesResult = parseZipEntries(archiveBytes);
  if (!parsedEntriesResult.success) {
    return err(parsedEntriesResult.error);
  }

  const sourceRef = createUploadSourceRef(archiveBytes);
  const source = createUploadSource(sourceRef);
  const installPath = resolveUploadInstallPath(sourceRef);
  const extractRoot = await createInstallSiblingTempDirectory(
    installPath,
    ".agent-canvas-bundle-extract-",
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

    const matchingPlugins = findMatchingUploadedPlugins(
      metadataResult.data.displayName,
    );
    return activateUploadedPlugin(
      source,
      installPath,
      extractRoot,
      metadataResult.data,
      matchingPlugins,
    );
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
    return err(getResultErrorString(rmResult.error));
  }

  getDb().prepare("DELETE FROM pod_plugin_ids WHERE plugin_id = ?").run(id);
  managedPluginStore.delete(id);

  return ok();
}

interface PluginInstallBackup {
  backupPath: string;
  installPathExisted: boolean;
}

async function backupPluginInstall(
  installPath: string,
): Promise<Result<PluginInstallBackup>> {
  const backupPath = path.join(
    path.dirname(installPath),
    `.agent-canvas-bundle-backup-${randomUUID()}`,
  );
  const installPathExisted = await pathExists(installPath);
  if (!installPathExisted) {
    return ok({ backupPath, installPathExisted });
  }

  const moveResult = await fsOperation(
    () => fs.promises.rename(installPath, backupPath),
    `backup bundle dir ${installPath}`,
  );
  if (!moveResult.success) {
    return err(getResultErrorString(moveResult.error));
  }

  return ok({ backupPath, installPathExisted });
}

async function restorePluginInstall(
  installPath: string,
  backup: PluginInstallBackup,
): Promise<void> {
  if (!backup.installPathExisted) return;
  await fs.promises
    .rename(backup.backupPath, installPath)
    .catch(() => void 0);
}

async function activatePluginInstall(
  stagingPath: string,
  installPath: string,
  sourceRef: string,
  backup: PluginInstallBackup,
): Promise<Result<void>> {
  const activateResult = await fsOperation(
    async () => {
      await fs.promises.mkdir(path.dirname(installPath), { recursive: true });
      await fs.promises.rename(stagingPath, installPath);
    },
    `activate updated bundle ${sourceRef}`,
  );
  if (activateResult.success) return ok();

  await restorePluginInstall(installPath, backup);
  return err(getResultErrorString(activateResult.error));
}

async function commitPluginUpdate(
  id: string,
  record: ManagedPluginRecord,
  metadata: ExtractedBundleMetadata,
  backup: PluginInstallBackup,
): Promise<Result<ManagedPluginRecord>> {
  const updatedRecord = managedPluginStore.update(id, {
    displayName: metadata.displayName,
    description: metadata.description,
    updatedAt: new Date().toISOString(),
  });

  if (!updatedRecord) {
    await removeDirectoryIfExists(record.installPath).catch(() => void 0);
    await restorePluginInstall(record.installPath, backup);
    return err("PLUGIN_UPDATE_FAILED");
  }

  if (backup.installPathExisted) {
    await removeDirectoryIfExists(backup.backupPath).catch(() => void 0);
  }
  return ok(updatedRecord);
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
  const stagingPath = await createInstallSiblingTempDirectory(
    record.installPath,
    ".agent-canvas-bundle-update-",
  );
  try {
    const httpsUrl = `${GITHUB_HTTPS_PREFIX}${owner}/${repo}.git`;
    const cloneResult = await gitOperation(
      () => simpleGit().clone(httpsUrl, stagingPath),
      `update clone bundle ${source.ref}`,
    );
    if (!cloneResult.success) {
      return err(getResultErrorString(cloneResult.error));
    }

    const metadataResult = await ensureBundleHasSkillsOrRollback(
      stagingPath,
      repo,
    );
    if (!metadataResult.success) {
      return err(metadataResult.error);
    }

    const backupResult = await backupPluginInstall(record.installPath);
    if (!backupResult.success) {
      return backupResult;
    }

    const activateResult = await activatePluginInstall(
      stagingPath,
      record.installPath,
      source.ref,
      backupResult.data,
    );
    if (!activateResult.success) {
      return activateResult;
    }

    const commitResult = await commitPluginUpdate(
      id,
      record,
      metadataResult.data,
      backupResult.data,
    );
    return commitResult;
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
