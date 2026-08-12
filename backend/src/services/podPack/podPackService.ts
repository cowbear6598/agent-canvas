import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { unzipSync, zipSync } from "fflate";
import {
  POD_PACK_FORMAT,
  POD_PACK_VERSION,
  podPackExportRequestSchema,
  podPackManifestSchema,
  type PodPackExportRequest,
  type PodPackManifest,
} from "../../schemas/podPackSchemas.js";
import { managedPluginStore } from "../plugin/managedPluginRegistry.js";
import { listSkillsForPlugin } from "../plugin/pluginScanFs.js";
import { resolveUploadInstallPath } from "../plugin/pluginPaths.js";
import { managedMcpStore, type ManagedMcpServerRecord } from "../mcp/managedMcpStore.js";
import { podStore } from "../podStore.js";
import { connectionStore } from "../connectionStore.js";
import { workspaceService } from "../workspace/index.js";
import { toConnectionPublic, toPodPublicView } from "../../types/index.js";
import {
  isMultiDiskZip,
  isZip64EndRecord,
  isZip64Entry,
  isZipSymlink,
  openZipCentralDirectory,
  readCentralDirectoryEntryHeader,
  readUint32LE,
  ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE,
  ZIP_LOCAL_FILE_HEADER_SIGNATURE,
} from "../../utils/zipCentralDirectory.js";

export const MAX_POD_PACK_BYTES = 25 * 1024 * 1024;
const MAX_POD_PACK_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_POD_PACK_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_POD_PACK_ENTRIES = 1000;
const POD_WIDTH = 224;
const POD_HEIGHT = 112;

type ArchiveEntries = Record<string, Uint8Array>;
type DependencyAction = "reuse" | "install" | "rename";

export interface PodPackDependencyPreview {
  originalKey: string;
  name: string;
  resolvedName: string;
  fingerprint: string;
  action: DependencyAction;
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
  version: typeof POD_PACK_VERSION;
  podCount: number;
  connectionCount: number;
  plugins: PodPackDependencyPreview[];
  managedMcps: PodPackDependencyPreview[];
}

function sha256(...parts: Array<string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function isSafeArchivePath(name: string): boolean {
  if (!name || name.startsWith("/") || name.includes("\\")) return false;
  return !name.split("/").some((part) => part === ".." || part === "");
}

function validateEntries(entries: ArchiveEntries): void {
  const names = Object.keys(entries);
  if (names.length === 0 || names.length > MAX_POD_PACK_ENTRIES) {
    throw new Error("POD_PACK_ENTRY_COUNT_INVALID");
  }
  let total = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!isSafeArchivePath(name)) throw new Error(`POD_PACK_PATH_INVALID:${name}`);
    if (bytes.byteLength > MAX_POD_PACK_ENTRY_BYTES) {
      throw new Error(`POD_PACK_ENTRY_TOO_LARGE:${name}`);
    }
    total += bytes.byteLength;
    if (total > MAX_POD_PACK_UNCOMPRESSED_BYTES) {
      throw new Error("POD_PACK_UNCOMPRESSED_TOO_LARGE");
    }
  }
}

function inflateArchive(bytes: Uint8Array): ArchiveEntries {
  const opened = openZipCentralDirectory(bytes);
  if (!opened) throw new Error("POD_PACK_ARCHIVE_INVALID");
  const { view, endRecord } = opened;
  if (isMultiDiskZip(endRecord) || isZip64EndRecord(endRecord)) {
    throw new Error("POD_PACK_ZIP_FORMAT_UNSUPPORTED");
  }
  if (endRecord.totalEntries === 0 || endRecord.totalEntries > MAX_POD_PACK_ENTRIES) {
    throw new Error("POD_PACK_ENTRY_COUNT_INVALID");
  }
  const centralEnd = endRecord.centralDirectoryOffset + endRecord.centralDirectorySize;
  if (endRecord.centralDirectoryOffset >= bytes.byteLength || centralEnd > bytes.byteLength) {
    throw new Error("POD_PACK_ARCHIVE_INVALID");
  }
  const decoder = new TextDecoder();
  let cursor = endRecord.centralDirectoryOffset;
  let total = 0;
  for (let index = 0; index < endRecord.totalEntries; index += 1) {
    if (cursor + 46 > bytes.byteLength || readUint32LE(view, cursor) !== ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error("POD_PACK_ARCHIVE_INVALID");
    }
    const header = readCentralDirectoryEntryHeader(view, cursor);
    if (isZip64Entry(header) || isZipSymlink(header.externalAttributes)) {
      throw new Error("POD_PACK_ZIP_ENTRY_UNSUPPORTED");
    }
    if (header.nextCursor > bytes.byteLength || header.localHeaderOffset + 4 > bytes.byteLength || readUint32LE(view, header.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error("POD_PACK_ARCHIVE_INVALID");
    }
    const name = decoder.decode(bytes.subarray(header.fileNameOffset, header.fileNameOffset + header.fileNameLength));
    if (!isSafeArchivePath(name)) throw new Error(`POD_PACK_PATH_INVALID:${name}`);
    if (header.uncompressedSize > MAX_POD_PACK_ENTRY_BYTES) throw new Error(`POD_PACK_ENTRY_TOO_LARGE:${name}`);
    total += header.uncompressedSize;
    if (total > MAX_POD_PACK_UNCOMPRESSED_BYTES) throw new Error("POD_PACK_UNCOMPRESSED_TOO_LARGE");
    cursor = header.nextCursor;
  }
  let entries: ArchiveEntries;
  try { entries = unzipSync(bytes); } catch { throw new Error("POD_PACK_ARCHIVE_INVALID"); }
  validateEntries(entries);
  return entries;
}

async function readDirectoryEntries(root: string): Promise<ArchiveEntries> {
  const result: ArchiveEntries = {};
  async function walk(current: string): Promise<void> {
    const dirents = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.name === ".git" || dirent.isSymbolicLink()) continue;
      const absolute = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!dirent.isFile()) continue;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (!isSafeArchivePath(relative)) throw new Error(`PLUGIN_PATH_INVALID:${relative}`);
      result[relative] = new Uint8Array(await fs.readFile(absolute));
      if (Object.keys(result).length > MAX_POD_PACK_ENTRIES) {
        throw new Error("PLUGIN_ENTRY_COUNT_INVALID");
      }
    }
  }
  await walk(root);
  return result;
}

function fingerprintEntries(entries: ArchiveEntries): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(entries).sort()) {
    hash.update(name);
    hash.update("\0");
    hash.update(entries[name]!);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listExecutableFiles(entries: ArchiveEntries): string[] {
  const extensions = new Set([".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".exe", ".com", ".py", ".js", ".mjs", ".cjs", ".ts", ".rb", ".pl"]);
  return Object.keys(entries)
    .filter((name) => extensions.has(path.extname(name).toLowerCase()) || /(^|\/)(hooks?|scripts?|bin)(\/|$)/i.test(name))
    .sort();
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

function fingerprintMcp(config: ReturnType<typeof mcpPortableConfig>): string {
  return sha256(stableJson(config));
}

function toExportPods(pods: PodPackExportRequest["pods"]): PodPackExportRequest["pods"] {
  return pods.map((pod) => ({ ...pod, repositoryId: null }));
}

export async function createPodPackArchive(rawInput: unknown): Promise<Uint8Array> {
  const parsed = podPackExportRequestSchema.safeParse(rawInput);
  if (!parsed.success) throw new Error("POD_PACK_EXPORT_DATA_INVALID");
  const input = parsed.data;
  const selectedIds = new Set(input.pods.map((pod) => pod.originalId));
  if (input.connections.some((connection) => !selectedIds.has(connection.originalSourcePodId) || !selectedIds.has(connection.originalTargetPodId))) {
    throw new Error("POD_PACK_CONNECTION_OUTSIDE_SELECTION");
  }

  const archiveEntries: ArchiveEntries = {};
  const pluginIds = [...new Set(input.pods.flatMap((pod) => pod.pluginIds ?? []))];
  const plugins: PodPackManifest["plugins"] = [];
  for (const pluginId of pluginIds) {
    const record = managedPluginStore.getById(pluginId);
    if (!record) throw new Error(`POD_PACK_PLUGIN_NOT_FOUND:${pluginId}`);
    const files = await readDirectoryEntries(record.installPath);
    if (Object.keys(files).length === 0) throw new Error(`POD_PACK_PLUGIN_EMPTY:${pluginId}`);
    const fingerprint = fingerprintEntries(files);
    const bundlePath = `plugins/${fingerprint}.zip` as const;
    archiveEntries[bundlePath] = zipSync(files, { level: 6 });
    plugins.push({
      originalId: pluginId,
      displayName: record.displayName ?? pluginId,
      description: record.description,
      source: record.source,
      fingerprint,
      bundlePath,
      skills: await listSkillsForPlugin(record.installPath),
      executableFiles: listExecutableFiles(files),
    });
  }

  const mcpNames = [...new Set(input.pods.flatMap((pod) => pod.mcpServerNames ?? []))];
  const managedMcps: PodPackManifest["managedMcps"] = [];
  for (const name of mcpNames) {
    const record = managedMcpStore.getByName(name);
    if (!record) continue;
    const portable = mcpPortableConfig(record);
    managedMcps.push({ originalName: name, fingerprint: fingerprintMcp(portable), ...portable });
  }

  const manifest: PodPackManifest = {
    format: POD_PACK_FORMAT,
    version: POD_PACK_VERSION,
    exportedAt: new Date().toISOString(),
    pods: toExportPods(input.pods),
    connections: input.connections,
    plugins,
    managedMcps,
  };
  archiveEntries["manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2));
  const archive = zipSync(archiveEntries, { level: 6 });
  if (archive.byteLength > MAX_POD_PACK_BYTES) throw new Error("POD_PACK_TOO_LARGE");
  return archive;
}

export function parsePodPackArchive(bytes: Uint8Array): { manifest: PodPackManifest; entries: ArchiveEntries } {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_POD_PACK_BYTES) throw new Error("POD_PACK_SIZE_INVALID");
  const entries = inflateArchive(bytes);
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("POD_PACK_MANIFEST_MISSING");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new Error("POD_PACK_MANIFEST_JSON_INVALID"); }
  const parsed = podPackManifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error("POD_PACK_MANIFEST_INVALID");
  const manifest = parsed.data;
  if (new Set(manifest.pods.map((pod) => pod.originalId)).size !== manifest.pods.length) throw new Error("POD_PACK_DUPLICATE_POD_ID");
  if (new Set(manifest.plugins.map((plugin) => plugin.originalId)).size !== manifest.plugins.length) throw new Error("POD_PACK_DUPLICATE_PLUGIN_ID");
  for (const plugin of manifest.plugins) {
    const bundle = entries[plugin.bundlePath];
    if (!bundle) throw new Error(`POD_PACK_PLUGIN_BUNDLE_MISSING:${plugin.originalId}`);
    let files: ArchiveEntries;
    try { files = inflateArchive(bundle); } catch { throw new Error(`POD_PACK_PLUGIN_BUNDLE_INVALID:${plugin.originalId}`); }
    if (fingerprintEntries(files) !== plugin.fingerprint) throw new Error(`POD_PACK_PLUGIN_FINGERPRINT_MISMATCH:${plugin.originalId}`);
    if (!Object.keys(files).some((name) => name === "SKILL.md" || name.endsWith("/SKILL.md"))) {
      throw new Error(`POD_PACK_PLUGIN_SKILL_MISSING:${plugin.originalId}`);
    }
    plugin.executableFiles = listExecutableFiles(files);
  }
  for (const mcp of manifest.managedMcps) {
    const { originalName: _name, fingerprint, ...portable } = mcp;
    if (fingerprintMcp(portable) !== fingerprint) throw new Error(`POD_PACK_MCP_FINGERPRINT_MISMATCH:${mcp.originalName}`);
  }
  const podIds = new Set(manifest.pods.map((pod) => pod.originalId));
  const pluginIds = new Set(manifest.plugins.map((plugin) => plugin.originalId));
  for (const pod of manifest.pods) {
    if ((pod.pluginIds ?? []).some((id) => !pluginIds.has(id))) throw new Error("POD_PACK_PLUGIN_REFERENCE_MISSING");
  }
  if (manifest.connections.some((connection) => !podIds.has(connection.originalSourcePodId) || !podIds.has(connection.originalTargetPodId))) {
    throw new Error("POD_PACK_CONNECTION_REFERENCE_INVALID");
  }
  return { manifest, entries };
}

async function installedPluginFingerprints(): Promise<Map<string, { id: string; name: string }>> {
  const result = new Map<string, { id: string; name: string }>();
  for (const record of managedPluginStore.list()) {
    try {
      const files = await readDirectoryEntries(record.installPath);
      result.set(fingerprintEntries(files), { id: record.id, name: record.displayName ?? record.id });
    } catch { /* 損毀的既有 Plugin 不可阻擋匯入預覽。 */ }
  }
  return result;
}

function uniqueImportedName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name;
  let index = 2;
  let candidate = `${name} (imported)`;
  while (existing.has(candidate)) candidate = `${name} (imported ${index++})`;
  return candidate;
}

function uniqueImportedMcpName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name;
  let index = 1;
  let candidate: string;
  do {
    const suffix = index++ === 1 ? "-imported" : `-imported-${index - 1}`;
    candidate = `${name.slice(0, 200 - suffix.length)}${suffix}`;
  } while (existing.has(candidate));
  return candidate;
}

async function resolvePreview(manifest: PodPackManifest): Promise<PodPackPreview> {
  const pluginFingerprints = await installedPluginFingerprints();
  const pluginNames = new Set(managedPluginStore.list().map((item) => item.displayName ?? item.id));
  const plugins = manifest.plugins.map((plugin) => {
    const matched = pluginFingerprints.get(plugin.fingerprint);
    const resolvedName = matched?.name ?? uniqueImportedName(plugin.displayName, pluginNames);
    if (!matched) pluginNames.add(resolvedName);
    return { originalKey: plugin.originalId, name: plugin.displayName, resolvedName, fingerprint: plugin.fingerprint, action: matched ? "reuse" as const : resolvedName === plugin.displayName ? "install" as const : "rename" as const, skills: plugin.skills, executableFiles: plugin.executableFiles };
  });
  const existingMcps = managedMcpStore.list();
  const mcpByFingerprint = new Map(existingMcps.map((record) => [fingerprintMcp(mcpPortableConfig(record)), record]));
  const mcpNames = new Set(existingMcps.map((item) => item.name));
  const managedMcps = manifest.managedMcps.map((mcp) => {
    const matched = mcpByFingerprint.get(mcp.fingerprint);
    const resolvedName = matched?.name ?? uniqueImportedMcpName(mcp.originalName, mcpNames);
    if (!matched) mcpNames.add(resolvedName);
    return { originalKey: mcp.originalName, name: mcp.originalName, resolvedName, fingerprint: mcp.fingerprint, action: matched ? "reuse" as const : resolvedName === mcp.originalName ? "install" as const : "rename" as const, envKeys: mcp.envKeys, transport: mcp.transport, command: mcp.command, args: mcp.args, url: mcp.url };
  });
  return { format: POD_PACK_FORMAT, version: POD_PACK_VERSION, podCount: manifest.pods.length, connectionCount: manifest.connections.length, plugins, managedMcps };
}

export async function previewPodPackArchive(bytes: Uint8Array): Promise<PodPackPreview> {
  return resolvePreview(parsePodPackArchive(bytes).manifest);
}

async function writePluginBundle(bundle: Uint8Array, destination: string): Promise<void> {
  const files = inflateArchive(bundle);
  await fs.mkdir(destination, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = path.resolve(destination, ...name.split("/"));
    if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error("POD_PACK_PLUGIN_PATH_INVALID");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

function positionImportedPods(manifest: PodPackManifest, targetX: number, targetY: number, pluginMap: Map<string, string>, mcpMap: Map<string, string>): PodPackManifest["pods"] {
  const minX = Math.min(...manifest.pods.map((pod) => pod.x));
  const maxX = Math.max(...manifest.pods.map((pod) => pod.x + POD_WIDTH));
  const minY = Math.min(...manifest.pods.map((pod) => pod.y));
  const maxY = Math.max(...manifest.pods.map((pod) => pod.y + POD_HEIGHT));
  const offsetX = targetX - (minX + maxX) / 2;
  const offsetY = targetY - (minY + maxY) / 2;
  return manifest.pods.map((pod) => ({
    ...pod,
    x: pod.x + offsetX,
    y: pod.y + offsetY,
    repositoryId: null,
    pluginIds: (pod.pluginIds ?? []).map((id) => pluginMap.get(id)).filter((id): id is string => !!id),
    mcpServerNames: (pod.mcpServerNames ?? []).map((name) => mcpMap.get(name) ?? name),
  }));
}

function generateImportPodName(original: string, existingNames: Set<string>): string {
  if (!existingNames.has(original)) return original;
  let counter = 1;
  let candidate: string;
  do {
    const suffix = ` (${counter++})`;
    candidate = `${original.slice(0, 100 - suffix.length)}${suffix}`;
  } while (existingNames.has(candidate));
  return candidate;
}

export async function importPodPackArchive(bytes: Uint8Array, options: { canvasId: string; targetX: number; targetY: number }): Promise<{
  success: true;
  preview: PodPackPreview;
  createdPods: ReturnType<typeof toPodPublicView>[];
  createdConnections: ReturnType<typeof toConnectionPublic>[];
  podIdMapping: Record<string, string>;
}> {
  const { manifest, entries } = parsePodPackArchive(bytes);
  const preview = await resolvePreview(manifest);
  const createdPluginIds: string[] = [];
  const createdPluginPaths: string[] = [];
  const createdMcpIds: string[] = [];
  const createdPodIds: string[] = [];
  const createdWorkspacePaths: string[] = [];
  const createdConnectionIds: string[] = [];
  const pluginMap = new Map<string, string>();
  const mcpMap = new Map<string, string>();
  try {
    for (const item of preview.plugins) {
      const manifestPlugin = manifest.plugins.find((plugin) => plugin.originalId === item.originalKey)!;
      if (item.action === "reuse") {
        const existing = (await installedPluginFingerprints()).get(item.fingerprint);
        if (!existing) throw new Error("POD_PACK_PLUGIN_CHANGED_DURING_IMPORT");
        pluginMap.set(item.originalKey, existing.id);
        continue;
      }
      const sourceRef = `${item.fingerprint}-${randomUUID().slice(0, 8)}`;
      const installPath = resolveUploadInstallPath(sourceRef);
      createdPluginPaths.push(installPath);
      await writePluginBundle(entries[manifestPlugin.bundlePath]!, installPath);
      const now = new Date().toISOString();
      const record = managedPluginStore.insert({ id: `podpack:${sourceRef}`, source: { type: "upload", ref: sourceRef }, githubRepo: sourceRef, displayName: item.resolvedName, description: manifestPlugin.description, installPath, installedAt: now, updatedAt: now });
      createdPluginIds.push(record.id);
      pluginMap.set(item.originalKey, record.id);
    }
    const existingMcps = managedMcpStore.list();
    const mcpByFingerprint = new Map(existingMcps.map((record) => [fingerprintMcp(mcpPortableConfig(record)), record]));
    for (const item of preview.managedMcps) {
      const source = manifest.managedMcps.find((mcp) => mcp.originalName === item.originalKey)!;
      const existing = mcpByFingerprint.get(item.fingerprint);
      if (existing) { mcpMap.set(item.originalKey, existing.name); continue; }
      const record = source.transport === "stdio"
        ? managedMcpStore.save({ name: item.resolvedName, enabled: source.enabled, transport: "stdio", command: source.command ?? "", args: source.args, cwd: null, env: Object.fromEntries(source.envKeys.map((key) => [key, ""])) })
        : managedMcpStore.save({ name: item.resolvedName, enabled: source.enabled, transport: source.transport, url: source.url ?? "" });
      createdMcpIds.push(record.id);
      mcpMap.set(item.originalKey, record.name);
    }
    const podIdMapping: Record<string, string> = {};
    const positionedPods = positionImportedPods(manifest, options.targetX, options.targetY, pluginMap, mcpMap);
    const createdPods = [];
    const existingNames = new Set(podStore.list(options.canvasId).map((pod) => pod.name));
    for (const item of positionedPods) {
      const name = generateImportPodName(item.name, existingNames);
      existingNames.add(name);
      const { pod } = podStore.create(options.canvasId, {
        name,
        x: item.x,
        y: item.y,
        rotation: item.rotation,
        provider: item.provider,
        providerConfig: item.providerConfig,
        fastModeEnabled: item.fastModeEnabled,
        mcpServerNames: item.mcpServerNames,
        pluginIds: item.pluginIds,
        repositoryId: null,
        goal: item.goal,
      });
      createdPods.push(pod);
      createdPodIds.push(pod.id);
      createdWorkspacePaths.push(pod.workspacePath);
      const workspaceResult = await workspaceService.createWorkspace(pod.workspacePath);
      if (!workspaceResult.success) throw new Error("POD_PACK_WORKSPACE_CREATE_FAILED");
      podIdMapping[item.originalId] = pod.id;
    }
    const createdConnections = [];
    for (const item of manifest.connections) {
      const sourcePodId = podIdMapping[item.originalSourcePodId];
      const targetPodId = podIdMapping[item.originalTargetPodId];
      if (!sourcePodId || !targetPodId) throw new Error("POD_PACK_CONNECTION_REFERENCE_INVALID");
      const connection = connectionStore.create(options.canvasId, {
        sourcePodId,
        sourceAnchor: item.sourceAnchor,
        targetPodId,
        targetAnchor: item.targetAnchor,
        triggerMode: item.triggerMode,
        direct: item.direct,
        summaryProvider: item.summaryProvider ?? undefined,
        summaryModel: item.summaryModel,
        summaryThinkingLevel: item.summaryThinkingLevel,
        label: item.label,
        description: item.description,
        branchProvider: item.branchProvider ?? undefined,
        branchModel: item.branchModel ?? undefined,
        branchThinkingLevel: item.branchThinkingLevel,
      });
      createdConnections.push(connection);
      createdConnectionIds.push(connection.id);
    }
    return { success: true as const, preview, createdPods: createdPods.map(toPodPublicView), createdConnections: createdConnections.map(toConnectionPublic), podIdMapping };
  } catch (error) {
    for (const id of createdConnectionIds.reverse()) connectionStore.delete(options.canvasId, id);
    for (const id of createdPodIds.reverse()) podStore.delete(options.canvasId, id);
    for (const workspacePath of createdWorkspacePaths) await workspaceService.deleteWorkspace(workspacePath);
    for (const id of createdMcpIds.reverse()) managedMcpStore.delete(id);
    for (const id of createdPluginIds.reverse()) managedPluginStore.delete(id);
    for (const installPath of createdPluginPaths) await fs.rm(installPath, { recursive: true, force: true });
    throw error;
  }
}
