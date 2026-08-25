import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { unzipSync, zipSync } from "fflate";
import { simpleGit } from "simple-git";
import {
  POD_PACK_FORMAT,
  POD_PACK_VERSION,
  podPackExportRequestSchema,
  podPackManifestSchema,
  type PodPackExportRequest,
  type PodPackImportOptions,
  type PodPackManifest,
} from "../../schemas/podPackSchemas.js";
import { config } from "../../config/index.js";
import { checkDiskSpace } from "../diskSpace.js";
import { createDirectoryArchive } from "../../utils/directoryArchive.js";
import {
  createStreamingZip,
  extractStreamingZip,
  type ZipDiskEntry,
} from "../../utils/streamingZip.js";
import { managedPluginStore } from "../plugin/managedPluginRegistry.js";
import { listSkillsForPlugin } from "../plugin/pluginScanFs.js";
import {
  resolveInstallPath,
  resolveUploadInstallPath,
} from "../plugin/pluginPaths.js";
import { managedMcpStore, type ManagedMcpServerRecord } from "../mcp/managedMcpStore.js";
import { repositoryNoteStore } from "../noteStores.js";
import { repositoryService } from "../repositoryService.js";
import { gitService } from "../workspace/gitService.js";
import { podStore } from "../podStore.js";
import { connectionStore } from "../connectionStore.js";
import { workspaceService } from "../workspace/index.js";
import { toConnectionPublic, toPodPublicView } from "../../types/index.js";

const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_LEGACY_POD_PACK_BYTES = 50 * 1024 * 1024;
const POD_WIDTH = 224;
const POD_HEIGHT = 112;
const EXECUTABLE_EXTENSIONS = new Set([
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".exe",
  ".com", ".py", ".js", ".mjs", ".cjs", ".ts", ".rb", ".pl",
]);

/**
 * Pod pack v2 的可攜內容為 Pod 拓撲、Repository 快照與 note、Plugin 快照及
 * Managed MCP 的非機密設定。下列 runtime／local 資料刻意不進封裝，preview
 * 會把代碼交給前端以目前語系明確顯示。
 */
const POD_PACK_OMITTED_RESOURCES = [
  "chats",
  "runtimeWorkspaces",
  "secrets",
  "repositoryMemory",
] as const;

type ArchiveEntries = Record<string, Uint8Array>;
type DependencyAction = "reuse" | "existing" | "install" | "rename";
type ManifestRepository = Extract<PodPackManifest, { version: 2 }>["repositories"][number];
type ManifestRepositoryNote = NonNullable<ManifestRepository["note"]>;

export interface PodPackDependencyPreview {
  originalKey: string;
  name: string;
  resolvedName: string;
  fingerprint: string;
  action: DependencyAction;
  source?: "git" | "directory" | { type: "github" | "upload"; ref: string };
  skills?: PodPackManifest["plugins"][number]["skills"];
  executableFiles?: string[];
  envKeys?: string[];
  transport?: "stdio" | "http" | "sse";
  command?: string | null;
  args?: string[];
  url?: string | null;
}

export interface PodPackPreview {
  format: typeof POD_PACK_FORMAT;
  version: 1 | typeof POD_PACK_VERSION;
  podCount: number;
  connectionCount: number;
  repositories: PodPackDependencyPreview[];
  plugins: PodPackDependencyPreview[];
  managedMcps: PodPackDependencyPreview[];
  omitted: string[];
}

export interface PreparedPodPack {
  archivePath: string;
  rootPath: string;
  manifest: PodPackManifest;
  preview: PodPackPreview;
  pluginDirectories: Map<string, string>;
  repositoryDirectories: Map<string, string>;
}

function repositoriesOf(manifest: PodPackManifest): ManifestRepository[] {
  return manifest.version === 2 ? manifest.repositories : [];
}

function repositoryNotesOf(
  repository: ManifestRepository,
): ManifestRepositoryNote[] {
  return repository.notes ?? (repository.note ? [repository.note] : []);
}

function repositoryNotesForImport(
  repository: ManifestRepository,
  manifest: PodPackManifest,
): ManifestRepositoryNote[] {
  const notes = repositoryNotesOf(repository);
  const boundPodIds = new Set(
    notes.flatMap((note) =>
      note.boundToOriginalPodId ? [note.boundToOriginalPodId] : [],
    ),
  );
  const template = notes[0];
  const missingNotes = manifest.pods
    .filter(
      (pod) =>
        pod.repositoryId === repository.originalId &&
        !boundPodIds.has(pod.originalId),
    )
    .map((pod) => ({
      repositoryId: repository.originalId,
      name: template?.name ?? repository.displayName,
      x: template?.x ?? pod.x,
      y: template?.y ?? pod.y,
      boundToOriginalPodId: pod.originalId,
      originalPosition: template?.originalPosition ?? null,
    }));

  return [...notes, ...missingNotes];
}

function sha256(...parts: Array<string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

interface ScannedDirectory {
  fingerprint: string;
  files: string[];
  executableFiles: string[];
  totalBytes: number;
}

function isExecutablePath(name: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(path.extname(name).toLowerCase()) ||
    /(^|\/)(hooks?|scripts?|bin)(\/|$)/i.test(name);
}

async function scanDirectory(
  root: string,
  include?: (relative: string, kind: "file" | "directory" | "symlink") => boolean | Promise<boolean>,
): Promise<ScannedDirectory> {
  const hash = createHash("sha256");
  const files: string[] = [];
  let totalBytes = 0;
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = await fs.lstat(absolute);
      const kind = stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file";
      if (include && !(await include(relative, kind))) continue;
      if (kind === "directory") {
        await walk(absolute);
        continue;
      }
      if (kind !== "file" && kind !== "symlink") continue;
      files.push(relative);
      totalBytes += kind === "symlink"
        ? Buffer.byteLength(await fs.readlink(absolute))
        : stat.size;
      hash.update(relative);
      hash.update("\0");
      if (kind === "symlink") hash.update(await fs.readlink(absolute));
      else for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      hash.update("\0");
    }
  }
  await walk(root);
  return {
    fingerprint: hash.digest("hex"),
    files,
    executableFiles: files.filter(isExecutablePath).sort(),
    totalBytes,
  };
}

async function measureDirectory(
  root: string,
  include: (relative: string, kind: "file" | "directory" | "symlink") => boolean | Promise<boolean>,
): Promise<number> {
  let total = 0;
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = await fs.lstat(absolute);
      const kind = stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file";
      if (!(await include(relative, kind))) continue;
      if (kind === "directory") await walk(absolute);
      else total += kind === "symlink" ? Buffer.byteLength(await fs.readlink(absolute)) : stat.size;
      if (!Number.isSafeInteger(total)) throw new Error("POD_PACK_UNCOMPRESSED_SIZE_INVALID");
    }
  }
  await walk(root);
  return total;
}

async function pluginSnapshot(
  pluginId: string,
  snapshotRoot: string,
): Promise<{ manifest: PodPackManifest["plugins"][number]; diskEntry: ZipDiskEntry }> {
  const record = managedPluginStore.getById(pluginId);
  if (!record) throw new Error(`POD_PACK_PLUGIN_NOT_FOUND:${pluginId}`);
  const include = (relative: string): boolean =>
    relative !== ".git" && !relative.startsWith(".git/");
  const scanned = await scanDirectory(record.installPath, include);
  if (scanned.files.length === 0) throw new Error(`POD_PACK_PLUGIN_EMPTY:${pluginId}`);
  const disk = await checkDiskSpace(snapshotRoot, scanned.totalBytes);
  if (!disk.ok) throw new Error("POD_PACK_DISK_FULL");
  const bundlePath = `plugins/${scanned.fingerprint}.zip` as const;
  const destination = path.join(snapshotRoot, ...bundlePath.split("/"));
  await createDirectoryArchive(record.installPath, destination, { include });
  return {
    manifest: {
      originalId: pluginId,
      displayName: record.displayName ?? pluginId,
      description: record.description,
      source: record.source,
      fingerprint: scanned.fingerprint,
      bundlePath,
      skills: await listSkillsForPlugin(record.installPath),
      executableFiles: scanned.executableFiles,
    },
    diskEntry: { archivePath: bundlePath, filePath: destination },
  };
}

async function createRepositoryFilter(
  root: string,
  isGit: boolean,
): Promise<(relative: string, kind: "file" | "directory" | "symlink") => boolean> {
  if (isGit) {
    const output = await simpleGit({ baseDir: root }).raw([
      "ls-files", "--cached", "--others", "--exclude-standard", "-z",
    ]).catch(() => "");
    const selected = new Set(output.split("\0").filter(Boolean).map((name) => name.split(path.sep).join("/")));
    const selectedDirectories = new Set<string>();
    for (const name of selected) {
      const parts = name.split("/");
      parts.pop();
      while (parts.length > 0) {
        selectedDirectories.add(parts.join("/"));
        parts.pop();
      }
    }
    return (relative, kind) => {
      if (relative === ".git" || relative.startsWith(".git/")) return true;
      if (kind !== "directory") return selected.has(relative);
      return selectedDirectories.has(relative);
    };
  }

  const matcher = ignore();
  const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf-8").catch(() => "");
  if (gitignore) matcher.add(gitignore);
  return (relative, kind) => !matcher.ignores(kind === "directory" ? `${relative}/` : relative);
}

async function repositorySnapshot(
  repositoryId: string,
  input: PodPackExportRequest,
  snapshotRoot: string,
): Promise<{ manifest: ManifestRepository; diskEntry: ZipDiskEntry } | null> {
  if (!(await repositoryService.exists(repositoryId))) return null;
  const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
  const gitResult = await gitService.isGitRepository(repositoryPath);
  const isGit = gitResult.success && gitResult.data;
  const include = await createRepositoryFilter(repositoryPath, isGit);
  const disk = await checkDiskSpace(snapshotRoot, await measureDirectory(repositoryPath, include));
  if (!disk.ok) throw new Error("POD_PACK_DISK_FULL");
  const temporaryPath = path.join(snapshotRoot, "repositories", `${randomUUID()}.zip`);
  await createDirectoryArchive(repositoryPath, temporaryPath, { include });
  const fingerprint = await hashFile(temporaryPath);
  const bundlePath = `repositories/${fingerprint}.zip` as const;
  const destination = path.join(snapshotRoot, ...bundlePath.split("/"));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(temporaryPath, destination);
  const branchResult = isGit ? await gitService.getCurrentBranch(repositoryPath) : null;
  const notes = input.repositoryNotes.filter(
    (item) => item.repositoryId === repositoryId,
  );
  return {
    manifest: {
      originalId: repositoryId,
      displayName: repositoryService.getMetadata(repositoryId)?.name ?? repositoryId,
      source: isGit ? "git" : "directory",
      currentBranch: branchResult?.success ? branchResult.data : null,
      fingerprint,
      bundlePath,
      note: notes[0] ?? null,
      notes,
    },
    diskEntry: { archivePath: bundlePath, filePath: destination },
  };
}

function mcpPortableConfig(record: ManagedMcpServerRecord): Omit<PodPackManifest["managedMcps"][number], "originalName" | "fingerprint"> {
  return {
    transport: record.transport,
    enabled: record.enabled,
    command: record.transport === "stdio" ? record.command : null,
    args: record.transport === "stdio" ? record.args : [],
    url: record.transport === "stdio" ? null : record.url,
    envKeys: record.transport === "stdio" ? Object.keys(record.env).sort() : [],
  };
}

function fingerprintMcp(configValue: ReturnType<typeof mcpPortableConfig>): string {
  return sha256(stableJson(configValue));
}

interface SnapshotResult {
  manifest: Extract<PodPackManifest, { version: 2 }>;
  diskEntries: ZipDiskEntry[];
}

async function buildSnapshot(rawInput: unknown, snapshotRoot: string): Promise<SnapshotResult> {
  const parsed = podPackExportRequestSchema.safeParse(rawInput);
  if (!parsed.success) throw new Error("POD_PACK_EXPORT_DATA_INVALID");
  const input = parsed.data;
  const selectedIds = new Set(input.pods.map((pod) => pod.originalId));
  if (input.connections.some((connection) =>
    !selectedIds.has(connection.originalSourcePodId) || !selectedIds.has(connection.originalTargetPodId))) {
    throw new Error("POD_PACK_CONNECTION_OUTSIDE_SELECTION");
  }

  await fs.mkdir(snapshotRoot, { recursive: true });
  const diskEntries: ZipDiskEntry[] = [];
  const plugins: PodPackManifest["plugins"] = [];
  for (const pluginId of [...new Set(input.pods.flatMap((pod) => pod.pluginIds ?? []))]) {
    const snapshot = await pluginSnapshot(pluginId, snapshotRoot);
    plugins.push(snapshot.manifest);
    diskEntries.push(snapshot.diskEntry);
  }

  const repositories: ManifestRepository[] = [];
  const repositoryIds = [...new Set(input.pods.flatMap((pod) => pod.repositoryId ? [pod.repositoryId] : []))];
  for (const repositoryId of repositoryIds) {
    const snapshot = await repositorySnapshot(repositoryId, input, snapshotRoot);
    if (!snapshot) continue;
    repositories.push(snapshot.manifest);
    diskEntries.push(snapshot.diskEntry);
  }
  const exportedRepositoryIds = new Set(repositories.map((item) => item.originalId));

  const managedMcps: PodPackManifest["managedMcps"] = [];
  for (const name of [...new Set(input.pods.flatMap((pod) => pod.mcpServerNames ?? []))]) {
    const record = managedMcpStore.getByName(name);
    if (!record) continue;
    const portable = mcpPortableConfig(record);
    managedMcps.push({ originalName: name, fingerprint: fingerprintMcp(portable), ...portable });
  }

  return {
    manifest: {
      format: POD_PACK_FORMAT,
      version: POD_PACK_VERSION,
      exportedAt: new Date().toISOString(),
      pods: input.pods.map((pod) => ({
        ...pod,
        repositoryId: pod.repositoryId && exportedRepositoryIds.has(pod.repositoryId)
          ? pod.repositoryId
          : null,
      })),
      connections: input.connections,
      repositories,
      plugins,
      managedMcps,
    },
    diskEntries,
  };
}

export async function createPodPackArchiveFile(rawInput: unknown, destinationPath: string): Promise<void> {
  await fs.mkdir(config.tmpRoot, { recursive: true });
  const snapshotRoot = await fs.mkdtemp(path.join(config.tmpRoot, "podpack-export-"));
  try {
    const snapshot = await buildSnapshot(rawInput, snapshotRoot);
    const requiredBytes = (await Promise.all(
      snapshot.diskEntries.map((entry) => fs.stat(entry.filePath).then((stat) => stat.size)),
    )).reduce((total, size) => total + size, MAX_MANIFEST_BYTES);
    const disk = await checkDiskSpace(path.dirname(destinationPath), requiredBytes);
    if (!disk.ok) throw new Error("POD_PACK_DISK_FULL");
    await createStreamingZip(
      destinationPath,
      Buffer.from(JSON.stringify(snapshot.manifest, null, 2)),
      snapshot.diskEntries,
    );
  } finally {
    await fs.rm(snapshotRoot, { recursive: true, force: true });
  }
}

/** 僅保留給小型單元測試與舊呼叫端；正式 API 使用磁碟串流版本。 */
export async function createPodPackArchive(rawInput: unknown): Promise<Uint8Array> {
  await fs.mkdir(config.tmpRoot, { recursive: true });
  const snapshotRoot = await fs.mkdtemp(path.join(config.tmpRoot, "podpack-legacy-"));
  try {
    const snapshot = await buildSnapshot(rawInput, snapshotRoot);
    const entries: ArchiveEntries = {
      "manifest.json": Buffer.from(JSON.stringify(snapshot.manifest, null, 2)),
    };
    for (const entry of snapshot.diskEntries) entries[entry.archivePath] = new Uint8Array(await fs.readFile(entry.filePath));
    return zipSync(entries, { level: 6 });
  } finally {
    await fs.rm(snapshotRoot, { recursive: true, force: true });
  }
}

function parseManifestBytes(bytes: Uint8Array): PodPackManifest {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("POD_PACK_MANIFEST_TOO_LARGE");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("POD_PACK_MANIFEST_JSON_INVALID"); }
  const parsed = podPackManifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error("POD_PACK_MANIFEST_INVALID");
  return parsed.data;
}

function validateManifestReferences(manifest: PodPackManifest): void {
  const repositories = repositoriesOf(manifest);
  const podIds = new Set(manifest.pods.map((pod) => pod.originalId));
  const pluginIds = new Set(manifest.plugins.map((plugin) => plugin.originalId));
  const repositoryIds = new Set(repositories.map((item) => item.originalId));
  if (podIds.size !== manifest.pods.length || pluginIds.size !== manifest.plugins.length ||
      repositoryIds.size !== repositories.length) {
    throw new Error("POD_PACK_DUPLICATE_ID");
  }
  for (const pod of manifest.pods) {
    if ((pod.pluginIds ?? []).some((id) => !pluginIds.has(id))) throw new Error("POD_PACK_PLUGIN_REFERENCE_MISSING");
    if (pod.repositoryId && !repositoryIds.has(pod.repositoryId)) throw new Error("POD_PACK_REPOSITORY_REFERENCE_MISSING");
  }
  if (manifest.connections.some((connection) =>
    !podIds.has(connection.originalSourcePodId) || !podIds.has(connection.originalTargetPodId))) {
    throw new Error("POD_PACK_CONNECTION_REFERENCE_INVALID");
  }
  for (const repository of repositories) {
    if (repositoryNotesOf(repository).some(
      (note) => note.boundToOriginalPodId && !podIds.has(note.boundToOriginalPodId),
    )) {
      throw new Error("POD_PACK_REPOSITORY_NOTE_REFERENCE_INVALID");
    }
  }
}

export function parsePodPackArchive(bytes: Uint8Array): { manifest: PodPackManifest; entries: ArchiveEntries } {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LEGACY_POD_PACK_BYTES) throw new Error("POD_PACK_SIZE_INVALID");
  let entries: ArchiveEntries;
  try { entries = unzipSync(bytes); }
  catch { throw new Error("POD_PACK_ARCHIVE_INVALID"); }
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("POD_PACK_MANIFEST_MISSING");
  const manifest = parseManifestBytes(manifestBytes);
  validateManifestReferences(manifest);
  for (const plugin of manifest.plugins) if (!entries[plugin.bundlePath]) throw new Error(`POD_PACK_PLUGIN_BUNDLE_MISSING:${plugin.originalId}`);
  for (const repository of repositoriesOf(manifest)) {
    const bundle = entries[repository.bundlePath];
    if (!bundle) throw new Error(`POD_PACK_REPOSITORY_BUNDLE_MISSING:${repository.originalId}`);
    if (sha256(bundle) !== repository.fingerprint) throw new Error(`POD_PACK_REPOSITORY_FINGERPRINT_MISMATCH:${repository.originalId}`);
  }
  return { manifest, entries };
}

async function installedPluginFingerprints(): Promise<Map<string, { id: string; name: string; source: { type: "github" | "upload"; ref: string } }>> {
  const result = new Map<string, { id: string; name: string; source: { type: "github" | "upload"; ref: string } }>();
  for (const record of managedPluginStore.list()) {
    try {
      const scanned = await scanDirectory(record.installPath, (relative) => relative !== ".git" && !relative.startsWith(".git/"));
      result.set(scanned.fingerprint, { id: record.id, name: record.displayName ?? record.id, source: record.source });
    } catch { /* 損毀的既有 Plugin 不可阻擋匯入預覽。 */ }
  }
  return result;
}

function uniqueDisplayName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name;
  let index = 1;
  let candidate = `${name} (imported)`;
  while (existing.has(candidate)) candidate = `${name} (imported ${++index})`;
  return candidate;
}

function uniqueImportedName(
  name: string,
  existing: Set<string>,
  maxLength: number,
): string {
  if (!existing.has(name)) return name;
  let index = 1;
  let suffix = "-imported";
  let candidate = `${name.slice(0, maxLength - suffix.length)}${suffix}`;
  while (existing.has(candidate)) {
    suffix = `-imported-${++index}`;
    candidate = `${name.slice(0, maxLength - suffix.length)}${suffix}`;
  }
  return candidate;
}

async function resolvePreview(manifest: PodPackManifest): Promise<PodPackPreview> {
  const pluginFingerprints = await installedPluginFingerprints();
  const pluginRecords = managedPluginStore.list();
  const pluginNames = new Set(pluginRecords.map((item) => item.displayName ?? item.id));
  const plugins = manifest.plugins.map((plugin) => {
    const sourceMatch = managedPluginStore.getBySource(plugin.source);
    const fingerprintMatch = pluginFingerprints.get(plugin.fingerprint);
    const compatibleFingerprintMatch = fingerprintMatch &&
      fingerprintMatch.source.type === plugin.source.type &&
      (plugin.source.type === "upload" || fingerprintMatch.source.ref === plugin.source.ref)
      ? fingerprintMatch
      : undefined;
    const resolvedName = sourceMatch
      ? sourceMatch.displayName ?? sourceMatch.id
      : compatibleFingerprintMatch?.name ?? uniqueDisplayName(plugin.displayName, pluginNames);
    if (!sourceMatch && !compatibleFingerprintMatch) pluginNames.add(resolvedName);
    return {
      originalKey: plugin.originalId,
      name: plugin.displayName,
      resolvedName,
      fingerprint: plugin.fingerprint,
      action: sourceMatch
        ? "existing" as const
        : compatibleFingerprintMatch
          ? "reuse" as const
          : resolvedName === plugin.displayName
            ? "install" as const
            : "rename" as const,
      source: plugin.source,
      skills: plugin.skills,
      executableFiles: plugin.executableFiles,
    };
  });

  const existingRepositories = new Set((await repositoryService.list()).map((item) => item.id));
  const repositories = repositoriesOf(manifest).map((repository) => {
    const resolvedName = uniqueImportedName(
      repository.displayName,
      existingRepositories,
      100,
    );
    existingRepositories.add(resolvedName);
    return {
      originalKey: repository.originalId,
      name: repository.displayName,
      resolvedName,
      fingerprint: repository.fingerprint,
      action: resolvedName === repository.displayName ? "install" as const : "rename" as const,
      source: repository.source,
    };
  });

  const existingMcps = managedMcpStore.list();
  const mcpByFingerprint = new Map(existingMcps.map((record) => [fingerprintMcp(mcpPortableConfig(record)), record]));
  const mcpNames = new Set(existingMcps.map((item) => item.name));
  const managedMcps = manifest.managedMcps.map((mcp) => {
    const matched = mcpByFingerprint.get(mcp.fingerprint);
    const resolvedName = matched?.name ?? uniqueImportedName(
      mcp.originalName,
      mcpNames,
      200,
    );
    if (!matched) mcpNames.add(resolvedName);
    return {
      originalKey: mcp.originalName,
      name: mcp.originalName,
      resolvedName,
      fingerprint: mcp.fingerprint,
      action: matched ? "reuse" as const : resolvedName === mcp.originalName ? "install" as const : "rename" as const,
      envKeys: mcp.envKeys,
      transport: mcp.transport,
      command: mcp.command,
      args: mcp.args,
      url: mcp.url,
    };
  });

  return {
    format: POD_PACK_FORMAT,
    version: manifest.version,
    podCount: manifest.pods.length,
    connectionCount: manifest.connections.length,
    repositories,
    plugins,
    managedMcps,
    omitted: [...POD_PACK_OMITTED_RESOURCES],
  };
}

async function validatePreparedBundles(
  rootPath: string,
  manifest: PodPackManifest,
): Promise<{ pluginDirectories: Map<string, string>; repositoryDirectories: Map<string, string> }> {
  const pluginDirectories = new Map<string, string>();
  const repositoryDirectories = new Map<string, string>();
  for (const plugin of manifest.plugins) {
    const bundlePath = path.join(rootPath, ...plugin.bundlePath.split("/"));
    if (!(await fs.stat(bundlePath).catch(() => null))) {
      throw new Error(`POD_PACK_PLUGIN_BUNDLE_MISSING:${plugin.originalId}`);
    }
    const destination = path.join(rootPath, "validated", "plugins", plugin.fingerprint);
    await extractStreamingZip(bundlePath, destination, { allowSymlinks: false });
    const scanned = await scanDirectory(destination);
    if (scanned.fingerprint !== plugin.fingerprint) throw new Error(`POD_PACK_PLUGIN_FINGERPRINT_MISMATCH:${plugin.originalId}`);
    if (!scanned.files.some((name) => name === "SKILL.md" || name.endsWith("/SKILL.md"))) {
      throw new Error(`POD_PACK_PLUGIN_SKILL_MISSING:${plugin.originalId}`);
    }
    plugin.executableFiles = scanned.executableFiles;
    pluginDirectories.set(plugin.originalId, destination);
  }
  for (const repository of repositoriesOf(manifest)) {
    const bundlePath = path.join(rootPath, ...repository.bundlePath.split("/"));
    if (!(await fs.stat(bundlePath).catch(() => null))) {
      throw new Error(`POD_PACK_REPOSITORY_BUNDLE_MISSING:${repository.originalId}`);
    }
    if (await hashFile(bundlePath) !== repository.fingerprint) {
      throw new Error(`POD_PACK_REPOSITORY_FINGERPRINT_MISMATCH:${repository.originalId}`);
    }
    const destination = path.join(rootPath, "validated", "repositories", repository.fingerprint);
    await extractStreamingZip(bundlePath, destination, {
      allowSymlinks: true,
      allowEmpty: true,
      repairLegacyRepositorySymlinks: true,
    });
    const gitPathExists = await fs.lstat(path.join(destination, ".git")).then(() => true).catch(() => false);
    if ((repository.source === "git") !== gitPathExists) {
      throw new Error(`POD_PACK_REPOSITORY_SOURCE_MISMATCH:${repository.originalId}`);
    }
    repositoryDirectories.set(repository.originalId, destination);
  }
  return { pluginDirectories, repositoryDirectories };
}

export async function preparePodPackArchive(archivePath: string, rootPath: string): Promise<PreparedPodPack> {
  const extracted = path.join(rootPath, "archive");
  await fs.rm(extracted, { recursive: true, force: true });
  const archiveEntries = await extractStreamingZip(archivePath, extracted, {
    allowSymlinks: false,
    allowedPath: (name) =>
      name === "manifest.json" ||
      /^plugins\/[a-f0-9]{64}\.zip$/.test(name) ||
      /^repositories\/[a-f0-9]{64}\.zip$/.test(name),
  });
  const manifestPath = path.join(extracted, "manifest.json");
  const stat = await fs.stat(manifestPath).catch(() => null);
  if (!stat) throw new Error("POD_PACK_MANIFEST_MISSING");
  if (stat.size > MAX_MANIFEST_BYTES) throw new Error("POD_PACK_MANIFEST_TOO_LARGE");
  const manifest = parseManifestBytes(new Uint8Array(await fs.readFile(manifestPath)));
  validateManifestReferences(manifest);
  const expectedEntries = new Set([
    "manifest.json",
    ...manifest.plugins.map((plugin) => plugin.bundlePath),
    ...repositoriesOf(manifest).map((repository) => repository.bundlePath),
  ]);
  if (archiveEntries.some((name) => !expectedEntries.has(name))) {
    throw new Error("POD_PACK_UNREFERENCED_ENTRY");
  }
  const directories = await validatePreparedBundles(extracted, manifest);
  return {
    archivePath,
    rootPath,
    manifest,
    preview: await resolvePreview(manifest),
    ...directories,
  };
}

export async function previewPodPackArchive(bytes: Uint8Array): Promise<PodPackPreview> {
  const parsed = parsePodPackArchive(bytes);
  return resolvePreview(parsed.manifest);
}

interface ImportArtifacts {
  pluginIds: string[];
  pluginPaths: string[];
  mcpIds: string[];
  repositoryIds: string[];
  noteIds: string[];
  podIds: string[];
  workspacePaths: string[];
  connectionIds: string[];
}

function createArtifacts(): ImportArtifacts {
  return { pluginIds: [], pluginPaths: [], mcpIds: [], repositoryIds: [], noteIds: [], podIds: [], workspacePaths: [], connectionIds: [] };
}

async function importPlugins(prepared: PreparedPodPack, artifacts: ImportArtifacts): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const fingerprints = await installedPluginFingerprints();
  for (const item of prepared.preview.plugins) {
    const source = prepared.manifest.plugins.find((plugin) => plugin.originalId === item.originalKey)!;
    if (item.action === "existing") {
      const existing = managedPluginStore.getBySource(source.source);
      if (!existing) throw new Error("POD_PACK_PLUGIN_CHANGED_DURING_IMPORT");
      result.set(item.originalKey, existing.id);
      continue;
    }
    if (item.action === "reuse") {
      const matched = fingerprints.get(item.fingerprint);
      const sourceMatches = matched &&
        matched.source.type === source.source.type &&
        (source.source.type === "upload" || matched.source.ref === source.source.ref);
      const existing = sourceMatches ? managedPluginStore.getById(matched.id) : null;
      if (!existing) throw new Error("POD_PACK_PLUGIN_CHANGED_DURING_IMPORT");
      result.set(item.originalKey, existing.id);
      continue;
    }

    const sourceRef = source.source.type === "github"
      ? source.source.ref
      : `${source.fingerprint}-${randomUUID().slice(0, 8)}`;
    const installPath = source.source.type === "github"
      ? `${resolveInstallPath(sourceRef)}__imported-${source.fingerprint.slice(0, 8)}-${randomUUID().slice(0, 8)}`
      : resolveUploadInstallPath(sourceRef);
    if (await fs.lstat(installPath).then(() => true).catch(() => false)) {
      throw new Error("POD_PACK_PLUGIN_PATH_CONFLICT");
    }
    artifacts.pluginPaths.push(installPath);
    await fs.cp(prepared.pluginDirectories.get(item.originalKey)!, installPath, { recursive: true, errorOnExist: true, force: false });
    const now = new Date().toISOString();
    const record = managedPluginStore.insert({
      id: source.source.type === "github"
        ? `podpack:github:${source.fingerprint}:${randomUUID().slice(0, 8)}`
        : `upload:${sourceRef}`,
      source: source.source.type === "github" ? source.source : { type: "upload", ref: sourceRef },
      githubRepo: sourceRef,
      displayName: item.resolvedName,
      description: source.description,
      installPath,
      installedAt: now,
      updatedAt: now,
    });
    artifacts.pluginIds.push(record.id);
    result.set(item.originalKey, record.id);
  }
  return result;
}

function importMcps(manifest: PodPackManifest, preview: PodPackPreview, artifacts: ImportArtifacts): Map<string, string> {
  const result = new Map<string, string>();
  const existing = managedMcpStore.list();
  const byFingerprint = new Map(existing.map((record) => [fingerprintMcp(mcpPortableConfig(record)), record]));
  for (const item of preview.managedMcps) {
    const source = manifest.managedMcps.find((mcp) => mcp.originalName === item.originalKey)!;
    const matched = byFingerprint.get(item.fingerprint);
    if (matched) {
      result.set(item.originalKey, matched.name);
      continue;
    }
    const record = source.transport === "stdio"
      ? managedMcpStore.save({ name: item.resolvedName, enabled: source.enabled, transport: "stdio", command: source.command ?? "", args: source.args, cwd: null, env: Object.fromEntries(source.envKeys.map((key) => [key, ""])) })
      : managedMcpStore.save({ name: item.resolvedName, enabled: source.enabled, transport: source.transport, url: source.url ?? "" });
    artifacts.mcpIds.push(record.id);
    result.set(item.originalKey, record.name);
  }
  return result;
}

async function importRepositories(prepared: PreparedPodPack, artifacts: ImportArtifacts): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const item of prepared.preview.repositories) {
    const source = repositoriesOf(prepared.manifest).find((repository) => repository.originalId === item.originalKey)!;
    const repositoryPath = repositoryService.getRepositoryPath(item.resolvedName);
    if (await repositoryService.exists(item.resolvedName)) throw new Error("POD_PACK_REPOSITORY_PATH_CONFLICT");
    await fs.mkdir(path.dirname(repositoryPath), { recursive: true });
    artifacts.repositoryIds.push(item.resolvedName);
    await fs.cp(prepared.repositoryDirectories.get(item.originalKey)!, repositoryPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    if (source.currentBranch) await repositoryService.registerMetadata(item.resolvedName, { currentBranch: source.currentBranch });
    result.set(item.originalKey, item.resolvedName);
  }
  return result;
}

function calculateOffset(manifest: PodPackManifest, targetX: number, targetY: number): { x: number; y: number } {
  const minX = Math.min(...manifest.pods.map((pod) => pod.x));
  const maxX = Math.max(...manifest.pods.map((pod) => pod.x + POD_WIDTH));
  const minY = Math.min(...manifest.pods.map((pod) => pod.y));
  const maxY = Math.max(...manifest.pods.map((pod) => pod.y + POD_HEIGHT));
  return { x: targetX - (minX + maxX) / 2, y: targetY - (minY + maxY) / 2 };
}

function uniquePodName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name;
  let index = 1;
  let suffix = ` (${index})`;
  let candidate = `${name.slice(0, 100 - suffix.length)}${suffix}`;
  while (existing.has(candidate)) {
    suffix = ` (${++index})`;
    candidate = `${name.slice(0, 100 - suffix.length)}${suffix}`;
  }
  return candidate;
}

async function importPods(
  prepared: PreparedPodPack,
  options: PodPackImportOptions,
  pluginMap: Map<string, string>,
  mcpMap: Map<string, string>,
  repositoryMap: Map<string, string>,
  artifacts: ImportArtifacts,
): Promise<{ pods: Array<ReturnType<typeof podStore.create>["pod"]>; mapping: Record<string, string>; offset: { x: number; y: number } }> {
  const offset = calculateOffset(prepared.manifest, options.targetX, options.targetY);
  const names = new Set(podStore.list(options.canvasId).map((pod) => pod.name));
  const pods: Array<ReturnType<typeof podStore.create>["pod"]> = [];
  const mapping: Record<string, string> = {};
  for (const item of prepared.manifest.pods) {
    const name = uniquePodName(item.name, names);
    names.add(name);
    const { pod } = podStore.create(options.canvasId, {
      name,
      x: item.x + offset.x,
      y: item.y + offset.y,
      rotation: item.rotation,
      provider: item.provider,
      providerConfig: item.providerConfig,
      fastModeEnabled: item.fastModeEnabled,
      mcpServerNames: (item.mcpServerNames ?? []).map((value) => mcpMap.get(value) ?? value),
      pluginIds: (item.pluginIds ?? []).map((value) => pluginMap.get(value)).filter((value): value is string => !!value),
      repositoryId: item.repositoryId ? repositoryMap.get(item.repositoryId) ?? null : null,
      goal: item.goal,
    });
    artifacts.podIds.push(pod.id);
    artifacts.workspacePaths.push(pod.workspacePath);
    const workspace = await workspaceService.createWorkspace(pod.workspacePath);
    if (!workspace.success) throw new Error("POD_PACK_WORKSPACE_CREATE_FAILED");
    mapping[item.originalId] = pod.id;
    pods.push(pod);
  }
  return { pods, mapping, offset };
}

function importRepositoryNotes(
  prepared: PreparedPodPack,
  options: PodPackImportOptions,
  repositoryMap: Map<string, string>,
  podMap: Record<string, string>,
  offset: { x: number; y: number },
  artifacts: ImportArtifacts,
): Array<ReturnType<typeof repositoryNoteStore.create>> {
  return repositoriesOf(prepared.manifest).flatMap((repository) => {
    const repositoryId = repositoryMap.get(repository.originalId);
    if (!repositoryId) return [];
    return repositoryNotesForImport(repository, prepared.manifest).map(
      (source) => {
        const note = repositoryNoteStore.create(options.canvasId, {
          repositoryId,
          name: source.name,
          x: source.x + offset.x,
          y: source.y + offset.y,
          boundToPodId: source.boundToOriginalPodId
            ? podMap[source.boundToOriginalPodId] ?? null
            : null,
          originalPosition: source.originalPosition,
        });
        artifacts.noteIds.push(note.id);
        return note;
      },
    );
  });
}

function importConnections(
  manifest: PodPackManifest,
  canvasId: string,
  podMap: Record<string, string>,
  artifacts: ImportArtifacts,
): Array<ReturnType<typeof connectionStore.create>> {
  return manifest.connections.map((item) => {
    const sourcePodId = podMap[item.originalSourcePodId];
    const targetPodId = podMap[item.originalTargetPodId];
    if (!sourcePodId || !targetPodId) throw new Error("POD_PACK_CONNECTION_REFERENCE_INVALID");
    const connection = connectionStore.create(canvasId, {
      sourcePodId, sourceAnchor: item.sourceAnchor, targetPodId, targetAnchor: item.targetAnchor,
      triggerMode: item.triggerMode, direct: item.direct,
      summaryProvider: item.summaryProvider ?? undefined, summaryModel: item.summaryModel,
      summaryThinkingLevel: item.summaryThinkingLevel, label: item.label, description: item.description,
      branchProvider: item.branchProvider ?? undefined, branchModel: item.branchModel ?? undefined,
      branchThinkingLevel: item.branchThinkingLevel,
    });
    artifacts.connectionIds.push(connection.id);
    return connection;
  });
}

async function rollback(options: PodPackImportOptions, artifacts: ImportArtifacts): Promise<void> {
  for (const id of artifacts.connectionIds.reverse()) connectionStore.delete(options.canvasId, id);
  for (const id of artifacts.noteIds.reverse()) repositoryNoteStore.delete(options.canvasId, id);
  for (const id of artifacts.podIds.reverse()) podStore.delete(options.canvasId, id);
  for (const workspacePath of artifacts.workspacePaths) await workspaceService.deleteWorkspace(workspacePath);
  for (const id of artifacts.repositoryIds.reverse()) await repositoryService.delete(id);
  for (const id of artifacts.mcpIds.reverse()) managedMcpStore.delete(id);
  for (const id of artifacts.pluginIds.reverse()) managedPluginStore.delete(id);
  for (const installPath of artifacts.pluginPaths) await fs.rm(installPath, { recursive: true, force: true });
}

export interface PodPackImportResult {
  success: true;
  preview: PodPackPreview;
  createdPods: Array<ReturnType<typeof toPodPublicView>>;
  createdRepositoryNotes: Array<ReturnType<typeof repositoryNoteStore.create>>;
  createdConnections: Array<ReturnType<typeof toConnectionPublic>>;
  podIdMapping: Record<string, string>;
}

export async function importPreparedPodPack(
  prepared: PreparedPodPack,
  options: PodPackImportOptions,
): Promise<PodPackImportResult> {
  const artifacts = createArtifacts();
  try {
    const pluginMap = await importPlugins(prepared, artifacts);
    const mcpMap = importMcps(prepared.manifest, prepared.preview, artifacts);
    const repositoryMap = await importRepositories(prepared, artifacts);
    const { pods, mapping, offset } = await importPods(prepared, options, pluginMap, mcpMap, repositoryMap, artifacts);
    const repositoryNotes = importRepositoryNotes(prepared, options, repositoryMap, mapping, offset, artifacts);
    const connections = importConnections(prepared.manifest, options.canvasId, mapping, artifacts);
    return {
      success: true as const,
      preview: prepared.preview,
      createdPods: pods.map(toPodPublicView),
      createdRepositoryNotes: repositoryNotes,
      createdConnections: connections.map(toConnectionPublic),
      podIdMapping: mapping,
    };
  } catch (error) {
    await rollback(options, artifacts);
    throw error;
  }
}

/** 舊介面的記憶體 adapter，僅用於相容既有單元測試。 */
export async function importPodPackArchive(
  bytes: Uint8Array,
  options: PodPackImportOptions,
): Promise<PodPackImportResult> {
  await fs.mkdir(config.tmpRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(config.tmpRoot, "podpack-import-"));
  const archivePath = path.join(root, "source.podpack");
  try {
    await fs.writeFile(archivePath, bytes);
    return await importPreparedPodPack(await preparePodPackArchive(archivePath, root), options);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
