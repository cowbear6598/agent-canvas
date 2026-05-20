import type { Config, McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk";
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
 * 組裝 opencode transient server 的完整 config（mcp + permission）。
 *
 * permission 欄位之所以要顯式設定為 "allow"：
 *   - `external_directory` 預設為 "ask"，當 agent 用 Read 工具開 workspace 以外的路徑
 *     （例如 plugin skill catalog 指向 ~/.claude/plugins/cache/... 的 SKILL.md）時，
 *     opencode 會發出 permission.updated 等待使用者批准；但我們 transient server 的
 *     stdin 是 pipe，沒有任何 UI 可以回應 → 整個 session 卡住。設 "allow" 跳過 prompt。
 *   - `edit` / `bash` 一併設 "allow"，因為 Pod 是託管環境（agent 已運作於 sandboxed
 *     workspace 內），不預期每個工具呼叫都要使用者逐次同意；Claude provider 用的
 *     `bypassPermissions` 是同樣語意。
 *   - `webfetch` 保持預設（未顯式設定），讓 opencode 自行決定是否需要批准。
 */
export function buildOpencodeTransientServerConfig(
  entries: PodMcpEntry[],
): Pick<Config, "mcp" | "permission"> {
  return {
    mcp: buildOpencodeMcpConfig(entries),
    permission: {
      external_directory: "allow",
      edit: "allow",
      bash: "allow",
    },
  };
}
