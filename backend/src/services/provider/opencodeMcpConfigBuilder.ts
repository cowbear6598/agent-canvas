import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk";
import type { PodMcpEntry } from "../mcp/managedMcpSurfaceService.js";

/**
 * 將 PodMcpEntry[] 轉成 opencode transient server 的 mcp config dict。
 *
 * - stdio entry → McpLocalConfig（`{ type: "local", command: [cmd, ...args], environment, enabled }`）
 * - http / sse entry → McpRemoteConfig（`{ type: "remote", url, enabled }`，opencode 原生支援遠端 MCP）
 */
export function buildOpencodeMcpConfig(
  entries: PodMcpEntry[],
): Record<string, McpLocalConfig | McpRemoteConfig> {
  const mcp: Record<string, McpLocalConfig | McpRemoteConfig> = {};
  for (const entry of entries) {
    if (entry.transport === "stdio") {
      mcp[entry.name] = {
        type: "local",
        command: [entry.command, ...entry.args],
        environment: entry.env,
        enabled: true,
      };
    } else {
      mcp[entry.name] = {
        type: "remote",
        url: entry.url,
        enabled: true,
      };
    }
  }
  return mcp;
}

/**
 * Run 期間 transient server 快取的 key 組合方式。
 */
export function buildServerCacheKey(runId: string, podId: string): string {
  return `${runId}:${podId}`;
}
