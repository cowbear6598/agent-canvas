import { logger } from "../../utils/logger.js";
import {
  readCodexMcpServers,
  readCodexPluginEnabledOverrides,
  readCodexPluginMcpEnabledOverrides,
} from "../mcp/codexMcpReader.js";
import {
  readCodexPluginMcps,
  type CodexPluginMcpDefinition,
} from "./codexPluginCacheReader.js";

export type CodexMcpSource = "official" | "user";

export interface CodexMcpRuntimeEntry {
  key: string;
  name: string;
  source: CodexMcpSource;
  transport: "stdio" | "http" | "sse";
  globallyEnabled: boolean;
  configTarget:
    | { kind: "user" }
    | { kind: "plugin"; pluginId: string };
}

type PluginMcpLoader = (cwd: string) => Promise<CodexPluginMcpDefinition[]>;

export function buildCodexUserMcpKey(name: string): string {
  return `user:${encodeURIComponent(name)}`;
}

export function buildCodexPluginMcpKey(pluginId: string, name: string): string {
  return `plugin:${encodeURIComponent(pluginId)}:${encodeURIComponent(name)}`;
}

/**
 * Codex CLI 的 `-c` dotted path 不支援 TOML quoted key，因此只接受可直接
 * 放入 path 的來源名稱。
 */
const CODEX_CONFIG_PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9_@:/-]+$/;

function isCodexConfigPathSegment(value: string): boolean {
  return CODEX_CONFIG_PATH_SEGMENT_PATTERN.test(value);
}

function pluginMcpId(pluginId: string, name: string): string {
  return `${pluginId}\0${name}`;
}

export class CodexMcpService {
  constructor(private readonly loadPluginMcps: PluginMcpLoader = readCodexPluginMcps) {}

  async list(cwd: string): Promise<CodexMcpRuntimeEntry[]> {
    const userEntries: CodexMcpRuntimeEntry[] = readCodexMcpServers(cwd)
      .filter((server) => {
        if (!isCodexConfigPathSegment(server.name)) {
          logger.warn(
            "McpServer",
            "Warn",
            `Codex MCP 名稱無法安全套用 runtime override，已略過：${server.name}`,
          );
          return false;
        }
        return true;
      })
      .map((server) => ({
        key: buildCodexUserMcpKey(server.name),
        name: server.name,
        source: "user",
        transport: server.type,
        globallyEnabled: server.enabled,
        configTarget: { kind: "user" },
      }));

    const pluginEnabledOverrides = new Map(
      readCodexPluginEnabledOverrides(cwd).map((entry) => [
        entry.pluginId,
        entry.enabled,
      ]),
    );
    const pluginMcpEnabledOverrides = new Map(
      readCodexPluginMcpEnabledOverrides(cwd).map((entry) => [
        pluginMcpId(entry.pluginId, entry.name),
        entry.enabled,
      ]),
    );
    const pluginEntries: CodexMcpRuntimeEntry[] = [];

    for (const definition of await this.loadPluginMcps(cwd)) {
      if (
        !isCodexConfigPathSegment(definition.pluginId) ||
        !isCodexConfigPathSegment(definition.name)
      ) {
        logger.warn(
          "McpServer",
          "Warn",
          `Codex Plugin MCP 名稱無法安全套用 runtime override，已略過（pluginId: ${definition.pluginId}）`,
        );
        continue;
      }

      pluginEntries.push({
        key: buildCodexPluginMcpKey(definition.pluginId, definition.name),
        name: definition.name,
        source: definition.source,
        transport: definition.transport,
        globallyEnabled:
          definition.enabled &&
          pluginEnabledOverrides.get(definition.pluginId) !== false &&
          pluginMcpEnabledOverrides.get(
            pluginMcpId(definition.pluginId, definition.name),
          ) !== false,
        configTarget: { kind: "plugin", pluginId: definition.pluginId },
      });
    }

    return [
      ...new Map(
        [...userEntries, ...pluginEntries].map((entry) => [entry.key, entry]),
      ).values(),
    ];
  }

  resolveSelectedKeys(
    currentKeys: readonly string[],
    entries: readonly CodexMcpRuntimeEntry[],
  ): string[] {
    const available = new Set(
      entries.filter((entry) => entry.globallyEnabled).map((entry) => entry.key),
    );
    return [...new Set(currentKeys)].filter((key) => available.has(key));
  }

  buildRuntimeConfigArgs(
    selectedKeys: readonly string[],
    entries: readonly CodexMcpRuntimeEntry[],
  ): string[] {
    const selected = new Set(selectedKeys);
    return entries.flatMap((entry) => {
      const enabled = entry.globallyEnabled && selected.has(entry.key);
      const configPath =
        entry.configTarget.kind === "user"
          ? `mcp_servers.${entry.name}.enabled=${enabled}`
          : `plugins.${entry.configTarget.pluginId}.mcp_servers.${entry.name}.enabled=${enabled}`;
      return ["-c", configPath];
    });
  }
}

export const codexMcpService = new CodexMcpService();
