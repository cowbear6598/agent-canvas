/**
 * opencodeSettingsHandlers 測試
 *
 * 涵蓋範圍：
 *   handleOpencodeProviderList
 *     - A1（wire-up smoke test）：透過 handler group 派發，走真實 zod parse pipeline
 *     - B1（happy path）：state ready + mocked client.provider.list 回傳資料，ok=true 原樣回傳
 *     - B2（sad case）：state failed → ok=false / error.code=opencode_server_not_ready
 *
 * Mock 邊界：
 *   必須 mock：socketService、@opencode-ai/sdk/v2（client boundary）、opencodeServer state
 *   不可 mock：schema validation（A1 透過 createValidatedHandler 走真實 zod parse）
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

const {
  mockEmitToConnection,
  mockGetOpencodeServerState,
  mockRestartOpencodeServer,
  mockProviderList,
} = vi.hoisted(() => ({
  mockEmitToConnection: vi.fn(),
  mockGetOpencodeServerState: vi.fn(),
  mockRestartOpencodeServer: vi.fn(),
  mockProviderList: vi.fn(),
}));

// socketService：WebSocket boundary
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
    emitToCanvas: vi.fn(),
    emitToAll: vi.fn(),
  },
}));

// opencodeServer state：允許各測試案例控制 status
vi.mock("../../src/services/provider/opencodeServer.js", () => ({
  getOpencodeServerState: mockGetOpencodeServerState,
  restartOpencodeServer: mockRestartOpencodeServer,
}));

// opencode SDK v2：mock createOpencodeClient，避免真實 HTTP 呼叫
vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: vi.fn(() => ({
    provider: {
      list: mockProviderList,
    },
  })),
}));

// ─── imports ──────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  handleOpencodeProviderList,
  handleOpencodeServerRestart,
} from "../../src/handlers/opencodeSettingsHandlers.js";
import { opencodeSettingsHandlerGroup } from "../../src/handlers/groups/opencodeSettingsHandlerGroup.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas/index.js";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CONNECTION_ID = "conn-opencode-settings-test";
const REQUEST_ID = "req-opencode-settings-test";

// A1 用：requestId 須為合法 UUID 才能通過 z.uuid() 驗證
const REQUEST_ID_UUID = "00000000-0000-4000-8000-000000000002";

// ─── 預設 ready state ─────────────────────────────────────────────────────────

const READY_STATE = {
  status: "ready" as const,
  baseUrl: "http://localhost:12345",
  failureReason: null,
  server: {},
};

const FAILED_STATE = {
  status: "failed" as const,
  baseUrl: null,
  failureReason: "opencode binary 不存在",
  server: null,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // 預設為 ready state，各測試可視需要覆寫
  mockGetOpencodeServerState.mockReturnValue(READY_STATE);
  // 預設 restartOpencodeServer resolve（無回傳值）
  mockRestartOpencodeServer.mockResolvedValue(undefined);
});

// ─── opencode:provider:list handler ──────────────────────────────────────────

describe("handleOpencodeProviderList", () => {
  /**
   * A1：wire-up smoke test。
   * 透過 handler group 找到 definition，使用 createValidatedHandler 走真實 zod parse，
   * 確認 OPENCODE_PROVIDER_LIST 事件有正確對應的 handler 並能回傳 OPENCODE_PROVIDER_LIST_RESULT。
   */
  it("A1（wire-up smoke）：透過 handler group 派發 OPENCODE_PROVIDER_LIST，回應 OPENCODE_PROVIDER_LIST_RESULT ok=true", async () => {
    mockProviderList.mockResolvedValue({
      data: {
        all: [{ id: "anthropic", name: "Anthropic" }],
        default: { anthropic: "claude-sonnet-4-5" },
        connected: ["anthropic"],
      },
    });

    // 找出 OPENCODE_PROVIDER_LIST handler definition
    const handlerDef = opencodeSettingsHandlerGroup.handlers.find(
      (h) => h.event === WebSocketRequestEvents.OPENCODE_PROVIDER_LIST,
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

    // 傳入合法 payload（requestId 須為合法 UUID）
    await validatedHandler(
      CONNECTION_ID,
      { requestId: REQUEST_ID_UUID },
      REQUEST_ID_UUID,
    );

    // 驗證 emitToConnection 被呼叫，且回應 event 正確
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT);
    expect(payload.ok).toBe(true);
  });

  /**
   * B1（happy path）：state ready + client.provider.list 回傳資料
   * → ok=true，all / default / connected 原樣回傳。
   */
  it("B1：state ready 時 mocked client.provider.list 回傳資料，ok=true 且資料原樣回傳", async () => {
    const mockAll = [
      { id: "anthropic", name: "Anthropic" },
      { id: "openai", name: "OpenAI" },
    ];
    const mockDefault = { anthropic: "claude-sonnet-4-5" };
    const mockConnected = ["anthropic"];

    mockProviderList.mockResolvedValue({
      data: {
        all: mockAll,
        default: mockDefault,
        connected: mockConnected,
      },
    });

    await handleOpencodeProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT);
    expect(payload.ok).toBe(true);
    expect(payload.requestId).toBe(REQUEST_ID);
    expect(payload.all).toEqual(mockAll);
    expect(payload.default).toEqual(mockDefault);
    expect(payload.connected).toEqual(mockConnected);
  });

  /**
   * B2（sad case）：state failed → ok=false / error.code=opencode_server_not_ready。
   * 對應 F12 / F13 情境：opencode binary 未安裝或 server 啟動失敗。
   */
  it("B2：state failed 時 ok=false 且 error.code=opencode_server_not_ready", async () => {
    // 覆寫為 failed state
    mockGetOpencodeServerState.mockReturnValue(FAILED_STATE);

    await handleOpencodeProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT);
    expect(payload.ok).toBe(false);
    expect(payload.requestId).toBe(REQUEST_ID);
    expect(payload.error).toBeDefined();
    expect(payload.error.code).toBe("opencode_server_not_ready");
    // client.provider.list 不應被呼叫
    expect(mockProviderList).not.toHaveBeenCalled();
  });
});

// ─── opencode:server:restart handler ─────────────────────────────────────────

describe("handleOpencodeServerRestart", () => {
  /**
   * A1（wire-up smoke）：透過 handler group 找到 OPENCODE_SERVER_RESTART definition，
   * 使用 createValidatedHandler 走真實 zod parse pipeline，
   * 確認事件有正確對應的 handler 並能回傳 OPENCODE_SERVER_RESTART_RESULT ok=true。
   */
  it("A1（wire-up smoke）：透過 handler group 派發 OPENCODE_SERVER_RESTART，回應 OPENCODE_SERVER_RESTART_RESULT ok=true", async () => {
    // 找出 OPENCODE_SERVER_RESTART handler definition
    const handlerDef = opencodeSettingsHandlerGroup.handlers.find(
      (h) => h.event === WebSocketRequestEvents.OPENCODE_SERVER_RESTART,
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

    // 傳入合法 payload（requestId 須為合法 UUID）
    await validatedHandler(
      CONNECTION_ID,
      { requestId: REQUEST_ID_UUID },
      REQUEST_ID_UUID,
    );

    // 驗證 emitToConnection 被呼叫一次且 event 為 OPENCODE_SERVER_RESTART_RESULT
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT);
    expect(payload.ok).toBe(true);
  });

  /**
   * B1（happy path）：restartOpencodeServer resolve、getOpencodeServerState 回傳 status="ready"
   * → ok=true，payload 形狀為 { requestId, ok: true }（不含 error 欄位）。
   */
  it("B1：restart 後 state ready 時 payload 形狀為 { requestId, ok: true }", async () => {
    // getOpencodeServerState 預設已回傳 READY_STATE（由 beforeEach 設定）

    await handleOpencodeServerRestart(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT);
    expect(payload).toEqual({ requestId: REQUEST_ID, ok: true });
  });

  /**
   * B2（sad path）：restartOpencodeServer resolve、getOpencodeServerState 回傳 status="failed"
   * 且含 failureReason → ok=false，error.code=opencode_restart_failed，
   * error.message 與 failureReason 一致。
   */
  it("B2：restart 後 state failed 時 payload 形狀為 { requestId, ok: false, error: { code, message } }", async () => {
    // 覆寫為 failed state（含 failureReason）
    mockGetOpencodeServerState.mockReturnValue(FAILED_STATE);

    await handleOpencodeServerRestart(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT);
    expect(payload).toEqual({
      requestId: REQUEST_ID,
      ok: false,
      error: {
        code: "opencode_restart_failed",
        message: "opencode binary 不存在",
      },
    });
  });
});
