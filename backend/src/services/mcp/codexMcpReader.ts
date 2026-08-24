/**
 * 直接讀取 Codex 使用者與 trusted project 的 config.toml。
 * 只擷取 Pod 資源選擇需要的 MCP、Plugin 與 Skill 啟用狀態。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../../utils/logger.js";
import { MCP_SERVER_NAME_PATTERN } from "../../schemas/mcpSchemas.js";

const CACHE_TTL_MS = 5000;

export interface CodexMcpServer {
  name: string;
  type: "stdio" | "http" | "sse";
  enabled: boolean;
}

export interface CodexPluginMcpEnabledOverride {
  pluginId: string;
  name: string;
  enabled: boolean;
}

export interface CodexPluginEnabledOverride {
  pluginId: string;
  enabled: boolean;
}

export interface CodexSkillEnabledOverride {
  path: string;
  enabled: boolean;
}

interface ParsedCodexConfig {
  servers: CodexMcpServer[];
  pluginMcpOverrides: CodexPluginMcpEnabledOverride[];
  pluginOverrides: CodexPluginEnabledOverride[];
  skillOverrides: CodexSkillEnabledOverride[];
}

interface CacheEntry {
  data: ParsedCodexConfig;
  expiresAt: number;
}

const EMPTY_CODEX_CONFIG: ParsedCodexConfig = {
  servers: [],
  pluginMcpOverrides: [],
  pluginOverrides: [],
  skillOverrides: [],
};
const cache = new Map<string, CacheEntry>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getCodexConfigPath(): string {
  return (
    process.env.CODEX_CONFIG_PATH ??
    path.join(
      process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
      "config.toml",
    )
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function readTomlRecord(configPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (error) {
    if (!isNotFound(error)) {
      logger.warn(
        "McpServer",
        "Warn",
        `讀取 Codex config.toml 失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }

  try {
    return asRecord(Bun.TOML.parse(raw));
  } catch (error) {
    logger.warn(
      "McpServer",
      "Warn",
      `Codex config.toml TOML 解析失敗：${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function parseServers(config: Record<string, unknown>): CodexMcpServer[] {
  const mcpServers = asRecord(config.mcp_servers) ?? {};
  const result: CodexMcpServer[] = [];

  for (const [serverName, rawServer] of Object.entries(mcpServers)) {
    const server = asRecord(rawServer);
    if (!server) continue;
    if (!MCP_SERVER_NAME_PATTERN.test(serverName)) {
      logger.warn(
        "McpServer",
        "Warn",
        `Codex MCP server name 含不合法字元，已略過（name 長度：${serverName.length}）`,
      );
      continue;
    }

    const enabled = server.enabled !== false;
    if (typeof server.command === "string") {
      result.push({ name: serverName, type: "stdio", enabled });
    } else if (typeof server.url === "string") {
      const type =
        server.type === "sse" || server.transport === "sse" ? "sse" : "http";
      result.push({ name: serverName, type, enabled });
    }
  }
  return result;
}

function parsePluginState(config: Record<string, unknown>): Pick<
  ParsedCodexConfig,
  "pluginMcpOverrides" | "pluginOverrides"
> {
  const pluginMcpOverrides: CodexPluginMcpEnabledOverride[] = [];
  const pluginOverrides: CodexPluginEnabledOverride[] = [];
  const plugins = asRecord(config.plugins) ?? {};

  for (const [pluginId, rawPlugin] of Object.entries(plugins)) {
    const plugin = asRecord(rawPlugin);
    if (!plugin) continue;
    if (typeof plugin.enabled === "boolean") {
      pluginOverrides.push({ pluginId, enabled: plugin.enabled });
    }

    const mcpServers = asRecord(plugin.mcp_servers) ?? {};
    for (const [name, rawServer] of Object.entries(mcpServers)) {
      const enabled = asRecord(rawServer)?.enabled;
      if (typeof enabled === "boolean") {
        pluginMcpOverrides.push({ pluginId, name, enabled });
      }
    }
  }
  return { pluginMcpOverrides, pluginOverrides };
}

function parseSkillState(
  config: Record<string, unknown>,
): CodexSkillEnabledOverride[] {
  const skills = asRecord(config.skills);
  const rawEntries = skills?.config;
  if (!Array.isArray(rawEntries)) return [];

  return rawEntries.flatMap((rawEntry) => {
    const entry = asRecord(rawEntry);
    return entry &&
      typeof entry.path === "string" &&
      typeof entry.enabled === "boolean"
      ? [{ path: entry.path, enabled: entry.enabled }]
      : [];
  });
}

function parseConfig(config: Record<string, unknown> | null): ParsedCodexConfig {
  if (!config) return EMPTY_CODEX_CONFIG;
  const { pluginMcpOverrides, pluginOverrides } = parsePluginState(config);
  return {
    servers: parseServers(config),
    pluginMcpOverrides,
    pluginOverrides,
    skillOverrides: parseSkillState(config),
  };
}

function findProjectConfigPath(cwd: string): string | null {
  let currentPath = path.resolve(cwd);
  while (true) {
    const configPath = path.join(currentPath, ".codex", "config.toml");
    if (fs.existsSync(configPath)) return configPath;
    if (fs.existsSync(path.join(currentPath, ".git"))) return null;
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) return null;
    currentPath = parentPath;
  }
}

function isTrustedProject(
  globalConfig: Record<string, unknown> | null,
  projectConfigPath: string,
): boolean {
  const projects = asRecord(globalConfig?.projects) ?? {};
  const projectRoot = path.dirname(path.dirname(projectConfigPath));
  return asRecord(projects[projectRoot])?.trust_level === "trusted";
}

function mergeByKey<T>(
  first: readonly T[],
  second: readonly T[],
  getKey: (item: T) => string,
): T[] {
  return [
    ...new Map([...first, ...second].map((item) => [getKey(item), item])).values(),
  ];
}

function mergeConfigs(
  globalConfig: ParsedCodexConfig,
  projectConfig: ParsedCodexConfig,
): ParsedCodexConfig {
  return {
    servers: mergeByKey(
      globalConfig.servers,
      projectConfig.servers,
      (item) => item.name,
    ),
    pluginMcpOverrides: mergeByKey(
      globalConfig.pluginMcpOverrides,
      projectConfig.pluginMcpOverrides,
      (item) => `${item.pluginId}\0${item.name}`,
    ),
    pluginOverrides: mergeByKey(
      globalConfig.pluginOverrides,
      projectConfig.pluginOverrides,
      (item) => item.pluginId,
    ),
    skillOverrides: mergeByKey(
      globalConfig.skillOverrides,
      projectConfig.skillOverrides,
      (item) => path.resolve(item.path),
    ),
  };
}

function readParsedCodexConfig(cwd?: string): ParsedCodexConfig {
  const globalConfigPath = getCodexConfigPath();
  const normalizedCwd = cwd ? path.resolve(cwd) : "";
  const cacheKey = `${globalConfigPath}\0${normalizedCwd}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const globalRecord = readTomlRecord(globalConfigPath);
  let result = parseConfig(globalRecord);
  if (cwd) {
    const projectConfigPath = findProjectConfigPath(cwd);
    if (projectConfigPath && isTrustedProject(globalRecord, projectConfigPath)) {
      result = mergeConfigs(
        result,
        parseConfig(readTomlRecord(projectConfigPath)),
      );
    }
  }

  cache.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return result;
}

export function readCodexMcpServers(cwd?: string): CodexMcpServer[] {
  return readParsedCodexConfig(cwd).servers;
}

export function readCodexPluginMcpEnabledOverrides(
  cwd?: string,
): CodexPluginMcpEnabledOverride[] {
  return readParsedCodexConfig(cwd).pluginMcpOverrides;
}

export function readCodexPluginEnabledOverrides(
  cwd?: string,
): CodexPluginEnabledOverride[] {
  return readParsedCodexConfig(cwd).pluginOverrides;
}

export function readCodexSkillEnabledOverrides(
  cwd?: string,
): CodexSkillEnabledOverride[] {
  return readParsedCodexConfig(cwd).skillOverrides;
}

/** 僅供測試使用。 */
export function resetCodexMcpCache(): void {
  cache.clear();
}
