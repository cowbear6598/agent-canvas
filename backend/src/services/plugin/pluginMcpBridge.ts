/**
 * Plugin MCP Bridge。
 *
 * 對 agent 端開 stdio MCP server，提供 1 個工具：
 *   - list_skills：列出該 Pod 啟用的所有 plugin 中可用的 skill 清單，
 *     每筆含 pluginId / skillName / description / skillMdPath / skillDir（絕對路徑）。
 *
 * 為什麼只有 list_skills？
 *   - 我們已在 fresh session 首輪把同一份 catalog 直接注入 prompt（progressive disclosure
 *     的 catalog 部分），但 catalog 可能因 context compaction 在後續 turn 失效；
 *     list_skills 提供 agent 重新查詢的後備路徑。
 *   - 不再提供 read_skill / read_plugin_file / exec_plugin_script，因為 agent 已具備
 *     原生 Read / Bash 工具，且 catalog 已暴露絕對路徑，無須 MCP 代執行。
 *
 * 啟動時讀取 AGENT_CANVAS_PLUGIN_MCP_POD_ID env，
 * 從 canvas.db 查詢該 Pod 啟用的 plugin 清單作為 scope。
 */

import path from "path";
import { Database } from "bun:sqlite";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveAppDataPaths } from "../../config/appDataPath.js";
import { listSkillsForPlugin } from "./pluginScanFs.js";

// ─── DB 型別（最小介面，供 resolvePodPluginScope 注入） ──────────────────────

export interface MinimalDatabase {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
  };
  query(sql: string): {
    all(...params: unknown[]): unknown[];
  };
}

// ─── resolvePodPluginScope ───────────────────────────────────────────────────

/**
 * 查詢指定 Pod 已啟用的 plugin 清單，
 * 回傳 `Map<pluginId, installPath>`。
 *
 * 純函式設計，可在測試中 inject in-memory db。
 */
export function resolvePodPluginScope(
  db: MinimalDatabase,
  podId: string,
): Map<string, string> {
  // 1. 取得該 Pod 啟用的 plugin_id 清單
  const pluginIdRows = db
    .prepare("SELECT plugin_id FROM pod_plugin_ids WHERE pod_id = ?")
    .all(podId) as Array<{ plugin_id: string }>;

  if (pluginIdRows.length === 0) {
    return new Map();
  }

  const pluginIds = pluginIdRows.map((r) => r.plugin_id);

  // 2. 查詢對應的 install_path
  const placeholders = pluginIds.map(() => "?").join(", ");
  const pluginRows = db
    .prepare(
      `SELECT id, install_path FROM managed_plugins WHERE id IN (${placeholders})`,
    )
    .all(...pluginIds) as Array<{ id: string; install_path: string }>;

  const scope = new Map<string, string>();
  for (const row of pluginRows) {
    scope.set(row.id, row.install_path);
  }

  return scope;
}

// ─── 工具結果包裝 ────────────────────────────────────────────────────────────

function successResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data),
      },
    ],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function resolvePluginBridgeDbPath(
  options?: Parameters<typeof resolveAppDataPaths>[0],
): string {
  return resolveAppDataPaths(options).canvasDbPath;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const podId = process.env.AGENT_CANVAS_PLUGIN_MCP_POD_ID;
  if (!podId) {
    throw new Error(
      "Plugin MCP bridge 缺少必要環境變數：AGENT_CANVAS_PLUGIN_MCP_POD_ID",
    );
  }

  const dbPath = resolvePluginBridgeDbPath();
  const db = new Database(dbPath, { readonly: true });

  const podScope = resolvePodPluginScope(db, podId);

  const server = new Server(
    {
      name: "agent-canvas-plugin-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    },
  );

  // ─── list_skills ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_skills",
        description:
          "列出目前 Pod 啟用的所有 plugin 中可用的 skill 清單，每筆含 pluginId、skillName、description、skillMdPath（SKILL.md 絕對路徑）、skillDir（SKILL.md 所在目錄絕對路徑）。要讀取 skill 內容請用原生 Read 工具開 skillMdPath；要執行 skill 目錄下的腳本請用原生 Bash 工具搭配 skillDir 解析相對路徑。",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  // ─── tool call handler ────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === "list_skills") {
      const results: Array<{
        pluginId: string;
        skillName: string;
        description: string;
        skillMdPath: string;
        skillDir: string;
      }> = [];

      for (const [pluginId, installPath] of podScope.entries()) {
        try {
          const skills = await listSkillsForPlugin(installPath);
          for (const skill of skills) {
            const skillDir =
              skill.skillName === ""
                ? installPath
                : path.join(installPath, skill.skillName);
            results.push({
              pluginId,
              skillName: skill.skillName,
              description: skill.description,
              skillMdPath: path.join(skillDir, "SKILL.md"),
              skillDir,
            });
          }
        } catch (error) {
          // 單個 plugin 讀取失敗不中斷整體，跳過
          console.error(
            `[plugin-mcp-bridge] 掃描 plugin 技能失敗，pluginId: ${pluginId}，installPath: ${installPath}，原因: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return successResult(results);
    }

    return errorResult(`未知的工具：${name}`);
  });

  // ─── 啟動 stdio transport ─────────────────────────────────────────────────

  const stdio = new StdioServerTransport();

  const cleanup = async (): Promise<void> => {
    await Promise.allSettled([server.close()]);
    db.close();
  };

  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });

  await server.connect(stdio);
}

// 僅在直接執行（非 import）時啟動 bridge，避免測試 import 時觸發 process.exit
if (import.meta.main) {
  void main().catch((error) => {
    console.error(
      `[plugin-mcp-bridge] bridge 啟動失敗：${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
