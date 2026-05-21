import type {
  Config,
  McpLocalConfig,
  McpRemoteConfig,
} from "@opencode-ai/sdk/v2";
import type { PodMcpEntry } from "../mcp/managedMcpSurfaceService.js";

/**
 * 將 PodMcpEntry[] 轉成 opencode transient server 的 mcp config dict。
 *
 * - stdio entry → McpLocalConfig（`{ type: "local", command: [cmd, ...args], environment, enabled }`）
 * - http / sse entry → McpRemoteConfig（`{ type: "remote", url, enabled }`，opencode 原生支援遠端 MCP）
 *
 * 注意：entries 內永遠含有 `agent_canvas_plugin` 這個 system-managed stdio entry，
 * 由 managedMcpSurfaceService.buildPodMcpEntries 無條件注入（pod 未勾選任何 plugin 時
 * bridge 仍存在但 list_skills 回空陣列）。caller 不需要特別處理，此函式統一當 stdio entry 轉換即可。
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

/**
 * 組裝 opencode server 的完整權限 config。
 *
 * permission 直接設為全域 `allow`，避免 stdio MCP / plugin skill /
 * workspace 外路徑等能力在 headless 模式下卡住 approval prompt。
 *
 * 注意：這只會放寬「批准」類流程，不保證 opencode 不會發出 `question.asked`。
 * 若模型主動進入互動問答流程，provider 端仍會 fail-fast 回報明確錯誤，因為 backend
 * 目前沒有回覆這類問題的通道。
 */
export function buildOpencodeTransientServerConfig(
  entries: PodMcpEntry[],
): Pick<Config, "mcp" | "permission"> {
  return {
    mcp: buildOpencodeMcpConfig(entries),
    permission: "allow",
  };
}

export function buildOpencodeFullAccessServerConfig(): Pick<
  Config,
  "mcp" | "permission"
> {
  return {
    mcp: {},
    permission: "allow",
  };
}
