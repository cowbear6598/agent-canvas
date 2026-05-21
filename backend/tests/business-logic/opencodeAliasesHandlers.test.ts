/**
 * opencode aliases handlers 整合測試
 *
 * 涵蓋範圍：
 *   handleOpencodeAliasesList     - B1（list 空陣列）
 *   handleOpencodeAliasesCreate   - A1（wire-up smoke）、B1（create 後 list 查得到）、
 *                                   B2（UNIQUE 違反錯誤）、B6（廣播被呼叫一次）
 *   handleOpencodeAliasesUpdate   - B3（update 後 list 顯示新值）、B6（廣播被呼叫）
 *   handleOpencodeAliasesDelete   - B4（delete 後 list 少一筆）、B6（廣播被呼叫）
 *   handleOpencodeAliasesReorder  - B5（reorder 後 list 順序對應）、B6（廣播被呼叫）
 *
 * Mock 邊界：
 *   必須 mock：socketService（WebSocket boundary）、providerListBroadcaster（廣播函式）
 *   不可 mock：DB（用真實 SQLite 記憶體資料庫）、statements、schema validation
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

const {
  mockEmitToConnection,
  mockEmitToAll,
  mockBroadcastOpencodeAliasesUpdated,
  mockBroadcastProviderList,
} = vi.hoisted(() => ({
  mockEmitToConnection: vi.fn(),
  mockEmitToAll: vi.fn(),
  mockBroadcastOpencodeAliasesUpdated: vi.fn().mockResolvedValue(undefined),
  mockBroadcastProviderList: vi.fn().mockResolvedValue(undefined),
}));

// socketService：WebSocket boundary
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
    emitToAll: mockEmitToAll,
    emitToCanvas: vi.fn(),
  },
}));

// providerListBroadcaster：廣播函式 mock（不觸發真實廣播）
vi.mock("../../src/services/provider/providerListBroadcaster.js", () => ({
  broadcastOpencodeAliasesUpdated: mockBroadcastOpencodeAliasesUpdated,
  broadcastProviderList: mockBroadcastProviderList,
}));

// ─── imports ──────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, closeDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import {
  handleOpencodeAliasesList,
  handleOpencodeAliasesCreate,
  handleOpencodeAliasesUpdate,
  handleOpencodeAliasesDelete,
  handleOpencodeAliasesReorder,
} from "../../src/handlers/opencodeSettingsHandlers.js";
import { opencodeSettingsHandlerGroup } from "../../src/handlers/groups/opencodeSettingsHandlerGroup.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas/index.js";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CONNECTION_ID = "conn-aliases-test";
const REQUEST_ID = "req-aliases-test";

// A1 wire-up smoke test 用：requestId 須為合法 UUID 才能通過 z.uuid() 驗證
const REQUEST_ID_UUID = "00000000-0000-4000-8000-000000000099";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetStatements();
  initTestDb();
});

afterEach(() => {
  closeDb();
});

// ─── opencode:aliases:list ────────────────────────────────────────────────────

describe("handleOpencodeAliasesList", () => {
  it("B1：無任何 alias 時回傳空陣列（F8 placeholder 情境）", async () => {
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_LIST_RESULT);
    expect(payload.success).toBe(true);
    expect(payload.items).toEqual([]);
  });
});

// ─── opencode:aliases:create ──────────────────────────────────────────────────

describe("handleOpencodeAliasesCreate", () => {
  /**
   * A1：wire-up smoke test。
   * 透過 handler group 找到 definition，使用 createValidatedHandler 走真實 zod parse，
   * 確認 OPENCODE_ALIASES_CREATE 事件有正確對應的 handler 並能回傳 OPENCODE_ALIASES_CREATE_RESULT。
   */
  it("A1（wire-up smoke）：透過 handler group 派發 OPENCODE_ALIASES_CREATE，回應 OPENCODE_ALIASES_CREATE_RESULT success=true", async () => {
    const handlerDef = opencodeSettingsHandlerGroup.handlers.find(
      (h) => h.event === WebSocketRequestEvents.OPENCODE_ALIASES_CREATE,
    );
    expect(handlerDef).toBeDefined();

    const { createValidatedHandler } =
      await import("../../src/middleware/wsMiddleware.js");
    const validatedHandler = createValidatedHandler(
      handlerDef!.schema,
      handlerDef!.handler as Parameters<typeof createValidatedHandler>[1],
      handlerDef!.responseEvent,
    );

    await validatedHandler(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID_UUID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
      REQUEST_ID_UUID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT);
    expect(payload.success).toBe(true);
  });

  it("B1：create 後 list 查得到新 row 且 orderIdx 為當前 max+1（首筆為 0）", async () => {
    // 新增第一筆
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
      REQUEST_ID,
    );

    // 新增第二筆
    vi.clearAllMocks();
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-opus-4",
        alias: "Opus",
      },
      REQUEST_ID,
    );

    const [, , createPayload] = mockEmitToConnection.mock.calls[0];
    expect(createPayload.success).toBe(true);
    expect(createPayload.item.orderIdx).toBe(1); // 第二筆 orderIdx=1

    // list 驗證
    vi.clearAllMocks();
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , listPayload] = mockEmitToConnection.mock.calls[0];
    expect(listPayload.success).toBe(true);
    expect(listPayload.items).toHaveLength(2);
    expect(listPayload.items[0].orderIdx).toBe(0);
    expect(listPayload.items[0].alias).toBe("Sonnet");
    expect(listPayload.items[1].orderIdx).toBe(1);
    expect(listPayload.items[1].alias).toBe("Opus");
  });

  it("B2（業務規則）：同 provider 同 alias 第二次 create 回傳 alias_duplicate 結構化錯誤", async () => {
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "DupAlias",
      },
      REQUEST_ID,
    );

    // 第二次同 provider（real_provider=anthropic）+ 同 alias 應回傳結構化錯誤（不 throw）
    vi.clearAllMocks();
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-opus-4",
        alias: "DupAlias",
      },
      REQUEST_ID,
    );

    const [, , dupPayload] = mockEmitToConnection.mock.calls[0];
    expect(dupPayload.success).toBe(false);
    expect(dupPayload.error.code).toBe("alias_duplicate");
  });

  it("B6：create 完成後 broadcastOpencodeAliasesUpdated 與 broadcastProviderList 各被呼叫一次", async () => {
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
      REQUEST_ID,
    );

    expect(mockBroadcastOpencodeAliasesUpdated).toHaveBeenCalledOnce();
    expect(mockBroadcastProviderList).toHaveBeenCalledOnce();
  });
});

// ─── opencode:aliases:update ──────────────────────────────────────────────────

describe("handleOpencodeAliasesUpdate", () => {
  it("B3：update 後 list 顯示新 alias 與 modelID（order_idx 保持不變）", async () => {
    // 先建立一筆
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "OldAlias",
      },
      REQUEST_ID,
    );

    const [, , createPayload] = mockEmitToConnection.mock.calls[0];
    const createdId: string = createPayload.item.id;
    const originalOrderIdx: number = createPayload.item.orderIdx;

    // 更新 alias 與 modelID
    vi.clearAllMocks();
    await handleOpencodeAliasesUpdate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        id: createdId,
        modelID: "claude-3-5-haiku",
        alias: "NewAlias",
      },
      REQUEST_ID,
    );

    const [, event, updatePayload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT);
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.item.alias).toBe("NewAlias");
    expect(updatePayload.item.modelID).toBe("claude-3-5-haiku");
    expect(updatePayload.item.orderIdx).toBe(originalOrderIdx);

    // 驗證 list 也反映更新
    vi.clearAllMocks();
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , listPayload] = mockEmitToConnection.mock.calls[0];
    expect(listPayload.items[0].alias).toBe("NewAlias");
    expect(listPayload.items[0].modelID).toBe("claude-3-5-haiku");
    expect(listPayload.items[0].orderIdx).toBe(originalOrderIdx);
  });

  it("B6：update 完成後廣播被呼叫一次", async () => {
    // 先建立一筆
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
      REQUEST_ID,
    );
    const [, , createPayload] = mockEmitToConnection.mock.calls[0];
    const createdId: string = createPayload.item.id;

    vi.clearAllMocks();
    await handleOpencodeAliasesUpdate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        id: createdId,
        modelID: "claude-3-5-sonnet",
        alias: "Updated",
      },
      REQUEST_ID,
    );

    expect(mockBroadcastOpencodeAliasesUpdated).toHaveBeenCalledOnce();
    expect(mockBroadcastProviderList).toHaveBeenCalledOnce();
  });
});

// ─── opencode:aliases:delete ──────────────────────────────────────────────────

describe("handleOpencodeAliasesDelete", () => {
  it("B4：delete 後 list 少一筆", async () => {
    // 建立兩筆
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
      REQUEST_ID,
    );
    const [, , firstCreate] = mockEmitToConnection.mock.calls[0];
    const firstId: string = firstCreate.item.id;

    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-opus-4",
        alias: "Opus",
      },
      REQUEST_ID,
    );

    // 刪除第一筆
    vi.clearAllMocks();
    await handleOpencodeAliasesDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: firstId },
      REQUEST_ID,
    );

    const [, event, deletePayload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT);
    expect(deletePayload.success).toBe(true);
    expect(deletePayload.id).toBe(firstId);

    // list 只剩一筆
    vi.clearAllMocks();
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , listPayload] = mockEmitToConnection.mock.calls[0];
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items[0].alias).toBe("Opus");
  });

  it("B6：delete 完成後廣播被呼叫一次", async () => {
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
      REQUEST_ID,
    );
    const [, , createPayload] = mockEmitToConnection.mock.calls[0];
    const createdId: string = createPayload.item.id;

    vi.clearAllMocks();
    await handleOpencodeAliasesDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: createdId },
      REQUEST_ID,
    );

    expect(mockBroadcastOpencodeAliasesUpdated).toHaveBeenCalledOnce();
    expect(mockBroadcastProviderList).toHaveBeenCalledOnce();
  });
});

// ─── opencode:aliases:reorder ─────────────────────────────────────────────────

describe("handleOpencodeAliasesReorder", () => {
  it("B5：reorder 後 list 順序與 orderedIds 對應", async () => {
    // 建立三筆（順序 A=0、B=1、C=2）
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "model-a",
        alias: "AliasA",
      },
      REQUEST_ID,
    );
    const idA: string =
      mockEmitToConnection.mock.calls[
        mockEmitToConnection.mock.calls.length - 1
      ][2].item.id;

    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "model-b",
        alias: "AliasB",
      },
      REQUEST_ID,
    );
    const idB: string =
      mockEmitToConnection.mock.calls[
        mockEmitToConnection.mock.calls.length - 1
      ][2].item.id;

    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "model-c",
        alias: "AliasC",
      },
      REQUEST_ID,
    );
    const idC: string =
      mockEmitToConnection.mock.calls[
        mockEmitToConnection.mock.calls.length - 1
      ][2].item.id;

    // 重排為 C、A、B（orderedIds 的 index 即為新 order_idx）
    vi.clearAllMocks();
    await handleOpencodeAliasesReorder(
      CONNECTION_ID,
      { requestId: REQUEST_ID, orderedIds: [idC, idA, idB] },
      REQUEST_ID,
    );

    const [, event, reorderPayload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT);
    expect(reorderPayload.success).toBe(true);
    // #2：reorder 成功時回傳完整 items
    expect(reorderPayload.items).toHaveLength(3);
    expect(reorderPayload.items[0].id).toBe(idC);
    expect(reorderPayload.items[1].id).toBe(idA);
    expect(reorderPayload.items[2].id).toBe(idB);

    // list 驗證：order_idx 0=C、1=A、2=B
    vi.clearAllMocks();
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , listPayload] = mockEmitToConnection.mock.calls[0];
    expect(listPayload.items).toHaveLength(3);
    expect(listPayload.items[0].id).toBe(idC);
    expect(listPayload.items[0].orderIdx).toBe(0);
    expect(listPayload.items[1].id).toBe(idA);
    expect(listPayload.items[1].orderIdx).toBe(1);
    expect(listPayload.items[2].id).toBe(idB);
    expect(listPayload.items[2].orderIdx).toBe(2);
  });

  it("B6：reorder 完成後廣播被呼叫一次", async () => {
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "model-a",
        alias: "AliasA",
      },
      REQUEST_ID,
    );
    const idA: string = mockEmitToConnection.mock.calls[0][2].item.id;

    vi.clearAllMocks();
    await handleOpencodeAliasesReorder(
      CONNECTION_ID,
      { requestId: REQUEST_ID, orderedIds: [idA] },
      REQUEST_ID,
    );

    expect(mockBroadcastOpencodeAliasesUpdated).toHaveBeenCalledOnce();
    expect(mockBroadcastProviderList).toHaveBeenCalledOnce();
  });
});
