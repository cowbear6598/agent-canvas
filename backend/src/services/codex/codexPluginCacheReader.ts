import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "../../utils/logger.js";

export type CodexPluginCacheSource = "official" | "user";

export interface CodexPluginMcpDefinition {
  pluginId: string;
  name: string;
  source: CodexPluginCacheSource;
  transport: "stdio" | "http" | "sse";
  enabled: boolean;
}

export interface CodexPluginCacheEntry {
  pluginId: string;
  pluginName: string;
  rootPath: string;
  source: CodexPluginCacheSource;
  enabled: boolean;
  skillRoots: string[];
  mcpServers: CodexPluginMcpDefinition[];
}

type PluginMcpMetadata = Pick<
  CodexPluginMcpDefinition,
  "name" | "transport" | "enabled"
>;

const MANIFEST_SCAN_MAX_DEPTH = 6;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function getCodexHomePath(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveManifestPath(
  pluginRoot: string,
  relativePath: string,
): string | null {
  const candidate = path.resolve(pluginRoot, relativePath);
  return isPathInside(pluginRoot, candidate) ? candidate : null;
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function resolveCodexPluginSource(
  resourcePath: string,
): CodexPluginCacheSource {
  const normalizedPath = resourcePath.replaceAll("\\", "/").toLowerCase();
  return /\/plugins\/cache\/(openai-|official|curated)/.test(normalizedPath)
    ? "official"
    : "user";
}

function resolveMarketplaceId(manifestPath: string): string | null {
  const cacheRoot = path.join(getCodexHomePath(), "plugins", "cache");
  const relative = path.relative(cacheRoot, manifestPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0] || null;
}

async function collectManifestPaths(
  currentPath: string,
  depth: number,
): Promise<string[]> {
  if (depth > MANIFEST_SCAN_MAX_DEPTH) return [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    if (!isNotFound(error)) {
      logger.warn(
        "Plugin",
        "Warn",
        `掃描 Codex plugin cache 失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const childPath = path.join(currentPath, entry.name);
    if (entry.name === ".codex-plugin") {
      results.push(path.join(childPath, "plugin.json"));
      continue;
    }
    results.push(...(await collectManifestPaths(childPath, depth + 1)));
  }
  return results;
}

function inferMcpTransport(
  config: Record<string, unknown>,
): "stdio" | "http" | "sse" | null {
  if (typeof config.command === "string") return "stdio";
  if (typeof config.url !== "string") return null;
  return config.type === "sse" || config.transport === "sse" ? "sse" : "http";
}

function parseMcpRecord(raw: unknown): PluginMcpMetadata[] {
  const record = asRecord(raw);
  if (!record) return [];
  const container =
    asRecord(record.mcpServers) ?? asRecord(record.mcp_servers) ?? record;
  const results: PluginMcpMetadata[] = [];

  for (const [name, rawConfig] of Object.entries(container)) {
    const config = asRecord(rawConfig);
    if (!config) continue;
    const transport = inferMcpTransport(config);
    if (!transport) continue;
    results.push({ name, transport, enabled: config.enabled !== false });
  }
  return results;
}

async function readMcpJson(
  pluginRoot: string,
  relativePath: string,
): Promise<PluginMcpMetadata[]> {
  const configPath = resolveManifestPath(pluginRoot, relativePath);
  if (!configPath) {
    logger.warn("Plugin", "Warn", "Codex Plugin MCP 設定路徑超出 plugin 目錄，已略過");
    return [];
  }

  try {
    return parseMcpRecord(JSON.parse(await fs.readFile(configPath, "utf-8")));
  } catch (error) {
    if (!isNotFound(error)) {
      logger.warn(
        "Plugin",
        "Warn",
        `讀取 Codex Plugin MCP 設定失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [];
  }
}

async function readMcpDefinitions(
  pluginRoot: string,
  rawMcpServers: unknown,
): Promise<PluginMcpMetadata[]> {
  const entries =
    rawMcpServers === undefined
      ? [".mcp.json"]
      : Array.isArray(rawMcpServers)
        ? rawMcpServers
        : [rawMcpServers];
  const definitions: PluginMcpMetadata[] = [];

  for (const entry of entries) {
    definitions.push(
      ...(typeof entry === "string"
        ? await readMcpJson(pluginRoot, entry)
        : parseMcpRecord(entry)),
    );
  }
  return definitions;
}

async function readPluginMcpServers(
  manifest: Record<string, unknown>,
  pluginRoot: string,
  pluginId: string,
  source: CodexPluginCacheSource,
  pluginEnabled: boolean,
): Promise<CodexPluginMcpDefinition[]> {
  const rawMcpServers = manifest.mcpServers ?? manifest.mcp_servers;
  const definitions = await readMcpDefinitions(pluginRoot, rawMcpServers);

  return [
    ...new Map(
      definitions.map((definition) => [
        definition.name,
        {
          pluginId,
          name: definition.name,
          source,
          transport: definition.transport,
          enabled: pluginEnabled && definition.enabled,
        },
      ]),
    ).values(),
  ];
}

async function readPluginManifest(
  manifestPath: string,
): Promise<CodexPluginCacheEntry | null> {
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    const record = asRecord(parsed);
    if (!record) return null;
    manifest = record;
  } catch (error) {
    if (!isNotFound(error)) {
      logger.warn(
        "Plugin",
        "Warn",
        `讀取 Codex Plugin manifest 失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }

  const pluginName =
    typeof manifest.name === "string" ? manifest.name.trim() : "";
  const marketplaceId = resolveMarketplaceId(manifestPath);
  const pluginId =
    typeof manifest.id === "string" && manifest.id.trim()
      ? manifest.id.trim()
      : marketplaceId
        ? `${pluginName}@${marketplaceId}`
        : pluginName;
  if (!pluginName || !pluginId) return null;

  const pluginRoot = path.dirname(path.dirname(manifestPath));
  const skillRoots = normalizeStringList(manifest.skills)
    .map((relativePath) => resolveManifestPath(pluginRoot, relativePath))
    .filter((skillPath): skillPath is string => skillPath !== null);
  const source = resolveCodexPluginSource(manifestPath);
  const enabled = manifest.enabled !== false;

  return {
    pluginId,
    pluginName,
    rootPath: pluginRoot,
    source,
    enabled,
    skillRoots,
    mcpServers: await readPluginMcpServers(
      manifest,
      pluginRoot,
      pluginId,
      source,
      enabled,
    ),
  };
}

/**
 * 直接讀取本機已 materialize 的 Codex Plugin，不啟動 App Server。
 * 單一 manifest 損壞時只略過該 Plugin，避免整份 Pod 資源清單失敗。
 */
export async function readCodexPluginCache(): Promise<CodexPluginCacheEntry[]> {
  const manifestPaths = await collectManifestPaths(
    path.join(getCodexHomePath(), "plugins", "cache"),
    0,
  );

  const entries = await Promise.all(
    manifestPaths
      .sort((first, second) =>
        first.localeCompare(second, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      )
      .map((manifestPath) => readPluginManifest(manifestPath)),
  );
  return [
    ...new Map(
      entries
        .filter((entry): entry is CodexPluginCacheEntry => entry !== null)
        .map((entry) => [entry.pluginId, entry]),
    ).values(),
  ];
}

/** 直接列出 Plugin manifest 明確宣告的 MCP server。 */
export async function readCodexPluginMcps(
  _cwd: string,
): Promise<CodexPluginMcpDefinition[]> {
  return (await readCodexPluginCache()).flatMap((plugin) => plugin.mcpServers);
}
