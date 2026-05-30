import path from "path";
import fs from "fs";
import os from "os";
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

const ZIP_EXTRACT_SCRIPT = String.raw`
import json
import os
import pathlib
import stat
import sys
import zipfile

archive_path = sys.argv[1]
destination_path = sys.argv[2]

def fail(code: str, message: str) -> None:
    sys.stderr.write(json.dumps({"code": code, "message": message}, ensure_ascii=False))
    sys.exit(2)

try:
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if not entries:
            fail("EMPTY_BUNDLE_ARCHIVE", "bundle 壓縮檔內沒有任何內容")

        file_entries = []
        destination = pathlib.Path(destination_path).resolve()

        for info in entries:
            name = info.filename
            if not name:
                continue
            normalized_name = name.replace("\\\\", "/")
            pure_path = pathlib.PurePosixPath(normalized_name)
            if pure_path.is_absolute() or ".." in pure_path.parts:
                fail("BUNDLE_PATH_TRAVERSAL", f"bundle 內含不安全路徑：{normalized_name}")

            mode = (info.external_attr >> 16) & 0o170000
            if stat.S_ISLNK(mode):
                fail("BUNDLE_SYMLINK_FORBIDDEN", f"bundle 內含不允許的 symlink：{normalized_name}")

            target_path = (destination / pathlib.Path(*pure_path.parts)).resolve()
            if target_path != destination and destination not in target_path.parents:
                fail("BUNDLE_PATH_TRAVERSAL", f"bundle 內含不安全路徑：{normalized_name}")

            if normalized_name.endswith("/"):
                target_path.mkdir(parents=True, exist_ok=True)
                continue

            target_path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info, "r") as src, open(target_path, "wb") as dst:
                dst.write(src.read())
            file_entries.append(normalized_name)

        if not file_entries:
            fail("EMPTY_BUNDLE_ARCHIVE", "bundle 壓縮檔內沒有任何可匯入檔案")

        sys.stdout.write(json.dumps({"files": file_entries}, ensure_ascii=False))
except zipfile.BadZipFile:
    fail("INVALID_BUNDLE_ARCHIVE", "上傳檔案不是合法的 ZIP bundle")
`;

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

function slugifySourceRef(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "bundle";
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

async function writeUploadedArchiveToTemp(file: File): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "agent-canvas-bundle-import-"),
  );
  const archivePath = path.join(tempDir, file.name);
  await Bun.write(archivePath, file);
  return archivePath;
}

async function runCommand(
  cmd: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

async function extractZipArchive(
  archivePath: string,
  destinationPath: string,
): Promise<Result<void>> {
  const result = await runCommand([
    "python3",
    "-c",
    ZIP_EXTRACT_SCRIPT,
    archivePath,
    destinationPath,
  ]).catch((error) =>
    Promise.resolve({
      exitCode: 127,
      stdout: "",
      stderr:
        error instanceof Error
          ? error.message
          : "無法啟動 bundle 解壓縮驗證工具",
    }),
  );

  if (result.exitCode === 0) {
    return ok(undefined);
  }

  try {
    const parsed = JSON.parse(result.stderr) as {
      code?: string;
      message?: string;
    };
    if (parsed.code && parsed.message) {
      return err(`${parsed.code}:${parsed.message}`);
    }
  } catch {
    // ignore JSON parse failure
  }

  if (result.exitCode === 127) {
    return err(
      "BUNDLE_IMPORT_ENVIRONMENT_UNAVAILABLE:缺少 bundle 解壓縮所需的 python3 執行環境",
    );
  }

  return err(
    `INVALID_BUNDLE_ARCHIVE:${result.stderr.trim() || "無法解析上傳的 bundle 壓縮檔"}`,
  );
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
  const archivePath = await writeUploadedArchiveToTemp(file);
  const extractRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "agent-canvas-bundle-extract-"),
  );

  try {
    const extractResult = await extractZipArchive(archivePath, extractRoot);
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

    const sourceRef = slugifySourceRef(metadataResult.data.displayName);
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
    await removeDirectoryIfExists(path.dirname(archivePath)).catch(() => void 0);
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
  const rmResult = await fsOperation(
    () => fs.promises.rm(record.installPath, { recursive: true, force: true }),
    `rm bundle dir ${record.installPath}`,
  );
  if (!rmResult.success) {
    return err(
      typeof rmResult.error === "string" ? rmResult.error : rmResult.error.key,
    );
  }

  const httpsUrl = `${GITHUB_HTTPS_PREFIX}${owner}/${repo}.git`;
  const cloneResult = await gitOperation(
    () => simpleGit().clone(httpsUrl, record.installPath),
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
    record.installPath,
    repo,
  );
  if (!metadataResult.success) {
    return err(metadataResult.error);
  }

  const updatedRecord = managedPluginStore.update(id, {
    displayName: metadataResult.data.displayName,
    description: metadataResult.data.description,
    updatedAt: new Date().toISOString(),
  });

  if (!updatedRecord) {
    return err("PLUGIN_UPDATE_FAILED");
  }

  return ok(updatedRecord);
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
    case "BUNDLE_IMPORT_ENVIRONMENT_UNAVAILABLE":
      return parsed.message;
    default:
      return parsed.message;
  }
}
