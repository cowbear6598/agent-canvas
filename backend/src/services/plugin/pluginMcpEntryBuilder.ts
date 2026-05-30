import path from "path";
import { fileURLToPath } from "url";

import type { PodMcpEntry } from "../mcp/managedMcpSurfaceService.js";

function getPluginMcpBridgePath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "pluginMcpBridge.ts",
  );
}

/**
 * 為指定 pod 建立 agent_canvas_plugin MCP entry（stdio 型）。
 *
 * 設計理由：無條件注入此 entry，由 pluginMcpBridge.ts 在啟動時讀 DB，
 * 依 pod_plugin_ids 決定 list_skills 回傳的範圍；pod 未勾選任何 skill bundle 時
 * bridge 仍啟動但回空陣列，保持 entry 名稱穩定以避免 provider session 重啟。
 */
export function buildPluginMcpEntry(podId: string): PodMcpEntry {
  return {
    name: "agent_canvas_plugin",
    transport: "stdio",
    command: process.execPath || "bun",
    args: [getPluginMcpBridgePath()],
    env: { AGENT_CANVAS_PLUGIN_MCP_POD_ID: podId },
    cwd: null,
    proxied: false,
  };
}
