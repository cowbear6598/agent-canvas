/**
 * mcpHandlers 整合測試：Gemini 分支
 *
 * 涵蓋範圍：
 *   handleMcpList  — A1（handler group smoke test）、B1（3 筆）、B2（settings.json 不存在）
 *   handlePodSetMcpServerNames — B1（2 筆合法）、B2（self-healing 過濾）、B3（pod busy 拒絕）
 *                                B4（清空 mcpServerNames）、B5（Codex 迴歸）
 *
 * Mock 邊界：
 *   必須 mock：socketService（WebSocket boundary）、canvasStore（getActiveCanvas）、logger
 *   不可 mock：geminiMcpReader（走真實 fixture 路徑，驗證整鏈路）
 *             podStore（真實 in-memory store）
 *             schema validation（A1 透過 createValidatedHandler 走真實 zod parse）
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

const { mockEmitToCanvas, mockEmitToConnection } = vi.hoisted(() => ({
  mockEmitToCanvas: vi.fn(),
  mockEmitToConnection: vi.fn(),
}));

// canvasStore：讓 getCanvasId 能從 connectionId 取得 CANVAS_ID
vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => CANVAS_ID),
    getCanvasDir: vi.fn(() => "/tmp/test-canvas"),
    getById: vi.fn((id: string) => ({
      id,
      name: "test-canvas",
      sortIndex: 0,
    })),
    list: vi.fn(() => [{ id: CANVAS_ID, name: "test-canvas", sortIndex: 0 }]),
  },
}));

// socketService：WebSocket boundary
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: mockEmitToCanvas,
    emitToConnection: mockEmitToConnection,
    emitToAll: vi.fn(),
  },
}));

// websocketResponse：避免真實 WebSocket emit，但保留 emitError 邏輯供 handler 使用
vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(
    (
      connectionId: string,
      event: string,
      error: unknown,
      canvasId: unknown,
      requestId: string,
      podId: unknown,
      code: string,
    ) => {
      // 將 emitError 轉為 emitToConnection 以利測試捕捉
      mockEmitToConnection(connectionId, event, {
        success: false,
        error,
        code,
        requestId,
        canvasId,
        podId,
      });
    },
  ),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

// logger：side-effect only，避免測試雜訊
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── imports ──────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createTmpDir,
  cleanupTmpDir,
  overrideEnv,
} from "../helpers/tmpDirHelper.js";

import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";
import {
  handleMcpList,
  handlePodSetMcpServerNames,
} from "../../src/handlers/mcpHandlers.js";
import { mcpHandlerGroup } from "../../src/handlers/groups/mcpHandlerGroup.js";
import { resetGeminiMcpCache } from "../../src/services/mcp/geminiMcpReader.js";
import { resetCodexMcpCache } from "../../src/services/mcp/codexMcpReader.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas/index.js";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

// DB / 連線 ID 無 UUID 限制，可使用易讀字串
const CANVAS_ID = "canvas-mcp-handler-test";
const CONNECTION_ID = "conn-mcp-handler-test";
const REQUEST_ID = "req-mcp-handler-test";

// A1 用：透過 createValidatedHandler 走 zod parse，requestId 須為合法 UUID
// 格式：{8hex}-{4hex}-{1-8}{3hex}-{89abAB}{3hex}-{12hex}
const REQUEST_ID_UUID = "00000000-0000-4000-8000-000000000001";

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function clearPodStoreCache(): void {
  podStore.__clearCacheForTesting();
}

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "MCP Handler Test Canvas", 0);
}

/**
 * 直接用 SQL 插入指定 provider 的 Pod。
 * 回傳 podId。
 */
function insertPodViaSQL(
  opts: {
    provider?: "gemini" | "claude" | "codex";
    status?: string;
    workspacePath?: string;
  } = {},
): string {
  const podId = `pod-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const provider = opts.provider ?? "gemini";
  const status = opts.status ?? "idle";
  const workspacePath = opts.workspacePath ?? `/tmp/mcp-pod-${podId}`;

  getDb()
    .prepare(
      `INSERT INTO pods (id, canvas_id, name, status, x, y, rotation, workspace_path,
       session_id, repository_id, command_id, multi_instance,
       schedule_json, provider, provider_config_json)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?, NULL, NULL, NULL, 0, NULL, ?,
       '{"model":"gemini-2.5-pro"}')`,
    )
    .run(
      podId,
      CANVAS_ID,
      `pod-${podId.slice(-8)}`,
      status,
      workspacePath,
      provider,
    );

  return podId;
}

/**
 * 建立 Gemini settings.json fixture，寫入 tmpDir。
 * 回傳 settings.json 的完整路徑。
 */
async function writeGeminiSettingsJson(
  tmpDir: string,
  mcpServers: Record<string, unknown>,
): Promise<string> {
  const settingsPath = join(tmpDir, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ mcpServers }));
  return settingsPath;
}

/**
 * 建立 Codex config.toml fixture，寫入 tmpDir。
 * 回傳 config.toml 的完整路徑。
 * serverNames 陣列中每個名稱都會建立一個 stdio 類型的 entry（含 command 欄位）。
 */
async function writeCodexConfigToml(
  tmpDir: string,
  serverNames: string[],
): Promise<string> {
  const configPath = join(tmpDir, "config.toml");
  const entries = serverNames
    .map((name) => `[mcp_servers.${name}]\ncommand = "npx"`)
    .join("\n\n");
  await writeFile(configPath, entries);
  return configPath;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

let tmpDir: string;
let restoreEnv: () => void;

beforeEach(async () => {
  // 初始化 DB
  closeDb();
  clearPodStoreCache();
  resetStatements();
  initTestDb();
  insertCanvas();

  // 建立 tmp 目錄作為 Gemini settings fixture 的存放位置
  tmpDir = await createTmpDir("ccc-mcp-handler-test-");

  // 清除 geminiMcpReader / codexMcpReader 的 TTL 快取，確保每個測試從乾淨狀態開始
  resetGeminiMcpCache();
  resetCodexMcpCache();

  vi.clearAllMocks();
});

afterEach(async () => {
  // 還原 env
  if (restoreEnv) {
    restoreEnv();
  }
  // 清除 geminiMcpReader / codexMcpReader 的 TTL 快取，避免 fixture 污染後續測試
  resetGeminiMcpCache();
  resetCodexMcpCache();
  closeDb();
  clearPodStoreCache();
  await cleanupTmpDir(tmpDir);
});

// ─── handleMcpList — Gemini 分支 ──────────────────────────────────────────────

describe("handleMcpList — Gemini 分支", () => {
  /**
   * A1：透過 handler group 派發，走真實 zod parse pipeline。
   * 驗證 MCP_LIST 事件對應的 handler 存在且能正確回傳 MCP_LIST_RESULT。
   */
  it("A1（wire-up smoke）：透過 handler group 派發 MCP_LIST（provider=gemini），回應 MCP_LIST_RESULT 含 items 陣列", async () => {
    // 準備含 1 筆 server 的 fixture（stdio 類型）
    const settingsPath = await writeGeminiSettingsJson(tmpDir, {
      "test-server": { command: "npx", args: ["-y", "some-mcp"] },
    });
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: settingsPath });
    resetGeminiMcpCache();

    // 找出 MCP_LIST handler definition，透過 createValidatedHandler 走真實 zod parse
    const handlerDef = mcpHandlerGroup.handlers.find(
      (h) => h.event === WebSocketRequestEvents.MCP_LIST,
    );
    expect(handlerDef).toBeDefined();

    // 建立包含 schema 驗證的 validated handler
    const { createValidatedHandler } =
      await import("../../src/middleware/wsMiddleware.js");
    const validatedHandler = createValidatedHandler(
      handlerDef!.schema,
      handlerDef!.handler as Parameters<typeof createValidatedHandler>[1],
      handlerDef!.responseEvent,
    );

    // 傳入合法 payload（requestId 須為合法 UUID，schema 才能通過 z.uuid() 驗證）
    await validatedHandler(
      CONNECTION_ID,
      { requestId: REQUEST_ID_UUID, provider: "gemini" },
      REQUEST_ID_UUID,
    );

    // 驗證 emitToConnection 被呼叫，且回應含 items 陣列
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.MCP_LIST_RESULT);
    expect(payload).toMatchObject({
      requestId: REQUEST_ID_UUID,
      success: true,
      provider: "gemini",
    });
    expect(Array.isArray(payload.items)).toBe(true);
  });

  /**
   * B1：reader 回傳 3 筆 → items 含 { name, type } 三筆。
   */
  it("B1：provider=gemini 且 reader 回傳 3 筆 → 回應 items 含 { name, type } 三筆", async () => {
    const settingsPath = await writeGeminiSettingsJson(tmpDir, {
      figma: { httpUrl: "https://mcp.figma.com/mcp" },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      "my-sse-server": { url: "https://example.com/sse" },
    });
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: settingsPath });
    resetGeminiMcpCache();

    await handleMcpList(
      CONNECTION_ID,
      { requestId: REQUEST_ID, provider: "gemini" },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, , payload] = mockEmitToConnection.mock.calls[0];
    expect(payload.success).toBe(true);
    expect(payload.provider).toBe("gemini");
    expect(payload.items).toHaveLength(3);

    // 驗證每筆含 name 與 type
    const names = payload.items.map((i: { name: string }) => i.name);
    expect(names).toContain("figma");
    expect(names).toContain("context7");
    expect(names).toContain("my-sse-server");

    const figma = payload.items.find(
      (i: { name: string }) => i.name === "figma",
    );
    const context7 = payload.items.find(
      (i: { name: string }) => i.name === "context7",
    );
    const sse = payload.items.find(
      (i: { name: string }) => i.name === "my-sse-server",
    );

    expect(figma?.type).toBe("http");
    expect(context7?.type).toBe("stdio");
    expect(sse?.type).toBe("sse");
  });

  /**
   * B2：settings.json 不存在 → items 為 []（不報錯）。
   * 對應 userflow「使用者尚未設定任何 MCP server 就打開面板」。
   */
  it("B2：settings.json 不存在 → 回應 items 為空陣列，不報錯", async () => {
    // 指向一個不存在的路徑
    const nonExistentPath = join(tmpDir, "no-such-settings.json");
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: nonExistentPath });
    resetGeminiMcpCache();

    await handleMcpList(
      CONNECTION_ID,
      { requestId: REQUEST_ID, provider: "gemini" },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.MCP_LIST_RESULT);
    expect(payload.success).toBe(true);
    expect(payload.items).toEqual([]);
  });
});

// ─── handlePodSetMcpServerNames — Gemini 分支 ─────────────────────────────────

describe("handlePodSetMcpServerNames — Gemini 分支", () => {
  /**
   * B1：Gemini Pod 設定 2 個合法 name → podStore 寫入成功，
   * 廣播 POD_MCP_SERVER_NAMES_UPDATED 含 mcpServerNames 與空 ignoredNames。
   */
  it("B1：Gemini Pod 設定 2 個合法 name → 廣播含 mcpServerNames 與空 ignoredNames", async () => {
    const settingsPath = await writeGeminiSettingsJson(tmpDir, {
      figma: { httpUrl: "https://mcp.figma.com/mcp" },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      "extra-server": { url: "https://extra.example.com/sse" },
    });
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: settingsPath });
    resetGeminiMcpCache();

    const podId = insertPodViaSQL({ provider: "gemini" });

    await handlePodSetMcpServerNames(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        podId,
        mcpServerNames: ["figma", "context7"],
      },
      REQUEST_ID,
    );

    // 驗證廣播
    expect(mockEmitToCanvas).toHaveBeenCalledOnce();
    const [canvasId, event, payload] = mockEmitToCanvas.mock.calls[0];
    expect(canvasId).toBe(CANVAS_ID);
    expect(event).toBe(WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED);
    expect(payload.success).toBe(true);
    expect(payload.podId).toBe(podId);
    expect(payload.mcpServerNames).toEqual(["figma", "context7"]);
    expect(payload.ignoredNames).toEqual([]);

    // 驗證 podStore 寫入
    const pod = podStore.getById(CANVAS_ID, podId);
    expect(pod?.mcpServerNames).toEqual(
      expect.arrayContaining(["figma", "context7"]),
    );
    expect(pod?.mcpServerNames).toHaveLength(2);
  });

  /**
   * B2：Gemini Pod 設定包含 1 個不存在於 settings.json 的 name
   * → self-healing 過濾，廣播 ignoredNames 含該筆。
   */
  it("B2：包含 1 個不存在於 settings.json 的 name → self-healing 過濾，ignoredNames 含該筆", async () => {
    const settingsPath = await writeGeminiSettingsJson(tmpDir, {
      figma: { httpUrl: "https://mcp.figma.com/mcp" },
    });
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: settingsPath });
    resetGeminiMcpCache();

    const podId = insertPodViaSQL({ provider: "gemini" });

    await handlePodSetMcpServerNames(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        podId,
        mcpServerNames: ["figma", "deleted-server"],
      },
      REQUEST_ID,
    );

    expect(mockEmitToCanvas).toHaveBeenCalledOnce();
    const [, , payload] = mockEmitToCanvas.mock.calls[0];
    expect(payload.success).toBe(true);
    // 只有合法的 figma 保留
    expect(payload.mcpServerNames).toEqual(["figma"]);
    // deleted-server 應被過濾且列入 ignoredNames
    expect(payload.ignoredNames).toEqual(["deleted-server"]);

    // podStore 只寫入合法的 name
    const pod = podStore.getById(CANVAS_ID, podId);
    expect(pod?.mcpServerNames).toEqual(["figma"]);
  });

  /**
   * B3：Gemini Pod 為 busy 狀態 → 拒絕並 emit POD_BUSY i18nError。
   */
  it("B3：Gemini Pod 為 busy（chatting）狀態 → 拒絕並 emit POD_BUSY i18nError", async () => {
    const settingsPath = await writeGeminiSettingsJson(tmpDir, {
      figma: { httpUrl: "https://mcp.figma.com/mcp" },
    });
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: settingsPath });
    resetGeminiMcpCache();

    const podId = insertPodViaSQL({ provider: "gemini", status: "chatting" });

    await handlePodSetMcpServerNames(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        podId,
        mcpServerNames: ["figma"],
      },
      REQUEST_ID,
    );

    // 應拒絕：不廣播到 canvas
    expect(mockEmitToCanvas).not.toHaveBeenCalled();

    // 應透過 emitToConnection 傳回 POD_BUSY 錯誤
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, , errorPayload] = mockEmitToConnection.mock.calls[0];
    expect(errorPayload.success).toBe(false);
    expect(errorPayload.code).toBe("POD_BUSY");
  });

  /**
   * B4：Gemini Pod 設定 0 筆 name（清空）
   * → podStore 寫入空陣列，廣播 mcpServerNames: []。
   */
  it("B4：設定 0 筆 name（清空）→ podStore 寫入空陣列，廣播 mcpServerNames: []", async () => {
    const settingsPath = await writeGeminiSettingsJson(tmpDir, {
      figma: { httpUrl: "https://mcp.figma.com/mcp" },
    });
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: settingsPath });
    resetGeminiMcpCache();

    const podId = insertPodViaSQL({ provider: "gemini" });

    // 先設定 1 筆
    await handlePodSetMcpServerNames(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        podId,
        mcpServerNames: ["figma"],
      },
      REQUEST_ID,
    );

    vi.clearAllMocks();

    // 再清空
    await handlePodSetMcpServerNames(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        podId,
        mcpServerNames: [],
      },
      REQUEST_ID,
    );

    expect(mockEmitToCanvas).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToCanvas.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED);
    expect(payload.success).toBe(true);
    expect(payload.mcpServerNames).toEqual([]);
    expect(payload.ignoredNames).toEqual([]);

    // podStore 確認清空
    const pod = podStore.getById(CANVAS_ID, podId);
    expect(pod?.mcpServerNames).toEqual([]);
  });

  /**
   * B5（回歸）：Codex provider 設定 mcpServerNames → self-healing 過濾，與 Gemini 行為一致。
   * fixture 含 "valid-server"；傳入 "valid-server"（合法）+ "ghost-server"（不存在）。
   * 預期：mcpServerNames 只含 "valid-server"，"ghost-server" 進入 ignoredNames。
   */
  it("B5（回歸）：Codex Pod 設定 mcpServerNames → self-healing 過濾，與 Gemini 行為一致", async () => {
    // 建立 Codex config.toml fixture，僅包含 "valid-server"
    const configPath = await writeCodexConfigToml(tmpDir, ["valid-server"]);
    restoreEnv = overrideEnv({
      CODEX_CONFIG_PATH: configPath,
      GEMINI_SETTINGS_PATH: join(tmpDir, "nonexistent.json"),
    });
    resetCodexMcpCache();
    resetGeminiMcpCache();

    const podId = insertPodViaSQL({ provider: "codex" });

    await handlePodSetMcpServerNames(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        podId,
        // "valid-server" 存在於 fixture；"ghost-server" 不存在
        mcpServerNames: ["valid-server", "ghost-server"],
      },
      REQUEST_ID,
    );

    expect(mockEmitToCanvas).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToCanvas.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED);
    expect(payload.success).toBe(true);
    // self-healing：只有 fixture 中存在的 name 被寫入
    expect(payload.mcpServerNames).toEqual(["valid-server"]);
    // fixture 中不存在的 name 進入 ignoredNames
    expect(payload.ignoredNames).toEqual(["ghost-server"]);

    // 確認 podStore 也只寫入合法的 name
    const pod = podStore.getById(CANVAS_ID, podId);
    expect(pod?.mcpServerNames).toEqual(["valid-server"]);
  });
});
