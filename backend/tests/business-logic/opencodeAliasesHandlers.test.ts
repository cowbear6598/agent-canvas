/**
 * opencode aliases handlers 整合測試
 *
 * 涵蓋範圍：
 *   handleOpencodeAliasesList
 *   handleOpencodeAliasesCreate
 *   handleOpencodeAliasesUpdate
 *   handleOpencodeAliasesDelete
 *   handleOpencodeAliasesReorder
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
  mockCreateOpencodeClient,
  mockOpencodeProviderList,
} = vi.hoisted(() => ({
  mockEmitToConnection: vi.fn(),
  mockEmitToAll: vi.fn(),
  mockBroadcastOpencodeAliasesUpdated: vi.fn().mockResolvedValue(undefined),
  mockBroadcastProviderList: vi.fn().mockResolvedValue(undefined),
  mockCreateOpencodeClient: vi.fn(),
  mockOpencodeProviderList: vi.fn(),
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

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: mockCreateOpencodeClient,
}));

vi.mock("../../src/services/auth/authGuard.js", () => ({
  authGuard: {
    assertAccess: vi.fn(),
  },
}));

// ─── imports ──────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { HandlerRegistry } from "../../src/handlers/registry.js";
import { eventRouter } from "../../src/services/eventRouter.js";
import {
  handleOpencodeAliasesList,
  handleOpencodeAliasesCreate,
  handleOpencodeAliasesUpdate,
  handleOpencodeAliasesRefreshPresets,
  handleOpencodeAliasesDelete,
  handleOpencodeAliasesReorder,
  resetOpencodeThinkingPresetSnapshotFetcher,
  setOpencodeThinkingPresetSnapshotFetcher,
} from "../../src/handlers/opencodeSettingsHandlers.js";
import { opencodeSettingsHandlerGroup } from "../../src/handlers/groups/opencodeSettingsHandlerGroup.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas/index.js";
import {
  resetOpencodeServerLauncher,
  setOpencodeServerLauncher,
  startOpencodeServer,
  stopOpencodeServer,
} from "../../src/services/provider/opencodeServer.js";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CONNECTION_ID = "conn-aliases-test";
const REQUEST_ID = "req-aliases-test";

// requestId 須為合法 UUID 才能通過 z.uuid() 驗證
const REQUEST_ID_UUID = "00000000-0000-4000-8000-000000000099";

const USED_PROVIDER_ID = "anthropic";
const USED_MODEL_ID = "claude-3-5-sonnet";
const USED_MODEL_VALUE = `${USED_PROVIDER_ID}/${USED_MODEL_ID}`;

let settingsRegistryRegistered = false;

function ensureSettingsRegistryRegistered(): void {
  if (settingsRegistryRegistered) return;

  const registry = new HandlerRegistry();
  registry.registerGroup(opencodeSettingsHandlerGroup);
  registry.registerToRouter();
  settingsRegistryRegistered = true;
}

async function dispatchViaSettingsRegistry(
  event: WebSocketRequestEvents,
  payload: Record<string, unknown>,
  requestId = REQUEST_ID_UUID,
): Promise<void> {
  ensureSettingsRegistryRegistered();
  await eventRouter.route(CONNECTION_ID, {
    type: event,
    requestId,
    payload,
  });
}

function createFakeOpencodeProviderData(): {
  all: unknown[];
  default: Record<string, string>;
  connected: string[];
} {
  return {
    all: [
      {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-3-5-sonnet": {
            id: "claude-3-5-sonnet",
            name: "Claude Sonnet",
            capabilities: { reasoning: true },
            variants: { medium: {} },
            options: { variant: "medium" },
          },
          "claude-opus-4": {
            id: "claude-opus-4",
            name: "Claude Opus",
            capabilities: { reasoning: false },
          },
          "claude-3-5-haiku": {
            id: "claude-3-5-haiku",
            name: "Claude Haiku",
            capabilities: { reasoning: false },
          },
        },
      },
      {
        id: "google",
        name: "Google",
        models: {
          "gemini-3.5-flash-lite": {
            id: "gemini-3.5-flash-lite",
            name: "Gemini Flash Lite",
            capabilities: { reasoning: false },
          },
        },
      },
      null,
      { id: "", name: "Invalid", models: [] },
    ],
    default: { anthropic: "claude-3-5-sonnet" },
    connected: ["anthropic", 123 as unknown as string, "google"],
  };
}

function setupFakeOpencodeProviderList(data = createFakeOpencodeProviderData()): void {
  mockOpencodeProviderList.mockResolvedValue({
    data,
    error: null,
  });
  mockCreateOpencodeClient.mockReturnValue({
    provider: {
      list: mockOpencodeProviderList,
    },
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetStatements();
  initTestDb();
  setupFakeOpencodeProviderList();
  setOpencodeThinkingPresetSnapshotFetcher(async (providerID, modelID) => ({
    ok: true,
    snapshot: {
      levels: [
        {
          id: "balanced",
          label: "Balanced",
          options: { variant: "medium", reasoningEffort: "medium" },
        },
      ],
      defaultLevel: "balanced",
      fetchedAt: 1234567890,
      metadata: { providerID, modelID },
    },
  }));
});

afterEach(() => {
  resetOpencodeThinkingPresetSnapshotFetcher();
  stopOpencodeServer();
  resetOpencodeServerLauncher();
  closeDb();
});

async function markOpencodeServerReady(): Promise<void> {
  setOpencodeServerLauncher(async () => ({
    url: "http://127.0.0.1:40999",
    close: vi.fn(),
  }));
  await startOpencodeServer();
}

async function createUsedAlias(): Promise<string> {
  await handleOpencodeAliasesCreate(
    CONNECTION_ID,
    {
      requestId: REQUEST_ID,
      providerID: USED_PROVIDER_ID,
      modelID: USED_MODEL_ID,
      alias: "UsedAlias",
    },
    REQUEST_ID,
  );

  return mockEmitToConnection.mock.calls[0][2].item.id;
}

function insertCanvas(id = "canvas-alias-usage", name = "模型使用測試畫布"): void {
  getDb()
    .prepare(
      "INSERT INTO canvases (id, name, sort_index) VALUES ($id, $name, $sortIndex)",
    )
    .run({ $id: id, $name: name, $sortIndex: 0 });
}

function insertPod(params: {
  id: string;
  canvasId?: string;
  name: string;
  provider: string;
  model?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO pods (
        id, canvas_id, name, x, y, rotation, workspace_path,
        session_id, repository_id, goal_json, schedule_json,
        provider, provider_config_json
      ) VALUES (
        $id, $canvasId, $name, 0, 0, 0, $workspacePath,
        NULL, NULL, NULL, NULL,
        $provider, $providerConfigJson
      )`,
    )
    .run({
      $id: params.id,
      $canvasId: params.canvasId ?? "canvas-alias-usage",
      $name: params.name,
      $workspacePath: `/tmp/${params.id}`,
      $provider: params.provider,
      $providerConfigJson: params.model
        ? JSON.stringify({ model: params.model })
        : null,
    });
}

function insertConnection(params: {
  id: string;
  canvasId?: string;
  sourcePodId: string;
  targetPodId: string;
  triggerMode?: string;
  summaryProvider?: string | null;
  summaryModel?: string;
  label?: string;
  branchProvider?: string | null;
  branchModel?: string | null;
}): void {
  const effectiveSummaryProvider =
    params.summaryProvider ?? params.branchProvider ?? null;
  const effectiveSummaryModel =
    params.summaryModel ?? params.branchModel ?? "sonnet";

  getDb()
    .prepare(
      `INSERT INTO connections (
        id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor,
        trigger_mode, decide_status, decide_reason, connection_status,
        summary_model, summary_provider, summary_thinking_level,
        label, description
      ) VALUES (
        $id, $canvasId, $sourcePodId, 'right', $targetPodId, 'left',
        $triggerMode, 'none', NULL, 'idle',
        $summaryModel, $summaryProvider, NULL,
        $label, NULL
      )`,
    )
    .run({
      $id: params.id,
      $canvasId: params.canvasId ?? "canvas-alias-usage",
      $sourcePodId: params.sourcePodId,
      $targetPodId: params.targetPodId,
      $triggerMode: params.triggerMode ?? "auto",
      $summaryModel: effectiveSummaryModel,
      $summaryProvider: effectiveSummaryProvider,
      $label: params.label ?? "",
    });
}

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

// ─── opencode:provider:list ──────────────────────────────────────────────────

describe("handleOpencodeProviderList", () => {
  it("透過真 handler registry 與 fake opencode client 回傳 sanitize 後的 provider list payload", async () => {
    await markOpencodeServerReady();

    await dispatchViaSettingsRegistry(
      WebSocketRequestEvents.OPENCODE_PROVIDER_LIST,
      { requestId: REQUEST_ID_UUID },
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT);
    expect(payload).toMatchObject({
      requestId: REQUEST_ID_UUID,
      success: true,
      default: { anthropic: "claude-3-5-sonnet" },
      connected: ["anthropic", "google"],
    });
    expect(payload.all).toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        models: [
          { id: "claude-3-5-sonnet", name: "Claude Sonnet" },
          { id: "claude-opus-4", name: "Claude Opus" },
          { id: "claude-3-5-haiku", name: "Claude Haiku" },
        ],
      },
      {
        id: "google",
        name: "Google",
        models: [
          { id: "gemini-3.5-flash-lite", name: "Gemini Flash Lite" },
        ],
      },
    ]);
  });
});

// ─── opencode:aliases:create ──────────────────────────────────────────────────

describe("handleOpencodeAliasesCreate", () => {
  it("A1（wire-up smoke）：透過真 handler registry 派發 OPENCODE_ALIASES_CREATE，回應使用者可見 payload", async () => {
    resetOpencodeThinkingPresetSnapshotFetcher();
    await markOpencodeServerReady();

    await dispatchViaSettingsRegistry(
      WebSocketRequestEvents.OPENCODE_ALIASES_CREATE,
      {
        requestId: REQUEST_ID_UUID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT);
    expect(payload.success).toBe(true);
    expect(payload.requestId).toBe(REQUEST_ID_UUID);
    expect(payload.item).toMatchObject({
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet",
      alias: "Sonnet",
      thinkingLevels: ["medium"],
      thinkingLevelLabels: { medium: "Medium" },
      defaultThinkingLevel: "medium",
    });
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://127.0.0.1:40999" }),
    );
  });

  it("A2（validation smoke）：create 非法 payload 會經過 validated handler 回傳 VALIDATION_ERROR", async () => {
    await dispatchViaSettingsRegistry(
      WebSocketRequestEvents.OPENCODE_ALIASES_CREATE,
      {
        requestId: REQUEST_ID_UUID,
        providerID: "../anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
      },
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("VALIDATION_ERROR");
  });

  it("B1：create 後 list 查得到新 row 且 orderIdx 為當前 max+1（首筆為 0）", async () => {
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
    expect(createPayload.item.orderIdx).toBe(1);

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

  it("同一 real model 已有 alias 時不允許再建立第二筆 alias", async () => {
    await createUsedAlias();

    vi.clearAllMocks();
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: USED_PROVIDER_ID,
        modelID: USED_MODEL_ID,
        alias: "ReplacementAlias",
      },
      REQUEST_ID,
    );

    const [, event, createPayload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT);
    expect(createPayload.success).toBe(false);
    expect(createPayload.error.code).toBe("alias_model_duplicate");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
    expect(mockBroadcastProviderList).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , listPayload] = mockEmitToConnection.mock.calls[0];
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items[0]).toMatchObject({
      providerID: USED_PROVIDER_ID,
      modelID: USED_MODEL_ID,
      alias: "UsedAlias",
    });
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

  it("B7：無 thinking levels 的 model 仍可新增 alias", async () => {
    setOpencodeThinkingPresetSnapshotFetcher(async (providerID, modelID) => ({
      ok: true,
      snapshot: {
        levels: [],
        defaultLevel: null,
        fetchedAt: 1234567891,
        metadata: { providerID, modelID, reason: "reasoning_not_supported" },
      },
    }));

    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "google",
        modelID: "gemini-3.5-flash-lite",
        alias: "GeminiLite",
      },
      REQUEST_ID,
    );

    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT);
    expect(payload.success).toBe(true);
    expect(payload.item).toMatchObject({
      providerID: "google",
      modelID: "gemini-3.5-flash-lite",
      alias: "GeminiLite",
      thinkingLevels: [],
      defaultThinkingLevel: null,
      thinkingMetadataFetchedAt: 1234567891,
    });
  });
});

// ─── opencode:aliases:update ──────────────────────────────────────────────────

describe("handleOpencodeAliasesUpdate", () => {
  it("A2（validation smoke）：update 非法 payload 會經過 validated handler 回傳 VALIDATION_ERROR", async () => {
    const handlerDef = opencodeSettingsHandlerGroup.handlers.find(
      (handler) =>
        handler.event === WebSocketRequestEvents.OPENCODE_ALIASES_UPDATE,
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
        id: "alias-id",
        modelID: "claude-3-5-sonnet",
        alias: "Bad\u0000Alias",
      },
      REQUEST_ID_UUID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("VALIDATION_ERROR");
  });

  it("B3：update 後 list 顯示新 alias 與 modelID（order_idx 保持不變）", async () => {
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

  it("同 provider 同 alias update 回傳 alias_duplicate 結構化錯誤", async () => {
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "AliasA",
      },
      REQUEST_ID,
    );
    const [, , firstCreatePayload] = mockEmitToConnection.mock.calls[0];
    const firstId: string = firstCreatePayload.item.id;

    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-opus-4",
        alias: "AliasB",
      },
      REQUEST_ID,
    );

    vi.clearAllMocks();
    await handleOpencodeAliasesUpdate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        id: firstId,
        modelID: "claude-3-5-sonnet",
        alias: "AliasB",
      },
      REQUEST_ID,
    );

    const [, , updatePayload] = mockEmitToConnection.mock.calls[0];
    expect(updatePayload.success).toBe(false);
    expect(updatePayload.error.code).toBe("alias_duplicate");
    expect(updatePayload.error.message).toBe("alias 已存在");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
  });

  it("update 到另一筆已使用 real model 時回傳 alias_model_duplicate 且原資料不變", async () => {
    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "AliasA",
      },
      REQUEST_ID,
    );
    const [, , firstCreatePayload] = mockEmitToConnection.mock.calls[0];
    const firstId: string = firstCreatePayload.item.id;

    await handleOpencodeAliasesCreate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        providerID: "anthropic",
        modelID: "claude-opus-4",
        alias: "AliasB",
      },
      REQUEST_ID,
    );
    const [, , secondCreatePayload] = mockEmitToConnection.mock.calls[1];
    const secondId: string = secondCreatePayload.item.id;

    vi.clearAllMocks();
    await handleOpencodeAliasesUpdate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        id: firstId,
        modelID: "claude-opus-4",
        alias: "AliasAUpdated",
      },
      REQUEST_ID,
    );

    const [, event, updatePayload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT);
    expect(updatePayload.success).toBe(false);
    expect(updatePayload.error.code).toBe("alias_model_duplicate");
    expect(updatePayload.error.message).toBe("此 model 已有 alias");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
    expect(mockBroadcastProviderList).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , listPayload] = mockEmitToConnection.mock.calls[0];
    expect(listPayload.items).toHaveLength(2);
    expect(listPayload.items[0]).toMatchObject({
      id: firstId,
      modelID: "claude-3-5-sonnet",
      alias: "AliasA",
    });
    expect(listPayload.items[1]).toMatchObject({
      id: secondId,
      modelID: "claude-opus-4",
      alias: "AliasB",
    });
  });
});

// ─── opencode:aliases:refresh-presets ───────────────────────────────────────

describe("handleOpencodeAliasesRefreshPresets", () => {
  it("success：刷新後回傳最新 thinking preset 並廣播更新", async () => {
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

    setOpencodeThinkingPresetSnapshotFetcher(async (providerID, modelID) => ({
      ok: true,
      snapshot: {
        levels: [
          {
            id: "deep",
            label: "Deep",
            options: { variant: "high", reasoningEffort: "high" },
          },
        ],
        defaultLevel: "deep",
        fetchedAt: 2233445566,
        metadata: { providerID, modelID, source: "refresh" },
      },
    }));

    vi.clearAllMocks();
    await handleOpencodeAliasesRefreshPresets(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: createdId },
      REQUEST_ID,
    );

    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(
      WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
    );
    expect(payload.success).toBe(true);
    expect(payload.item).toMatchObject({
      id: createdId,
      thinkingLevels: ["deep"],
      thinkingLevelLabels: { deep: "Deep" },
      defaultThinkingLevel: "deep",
      thinkingMetadataFetchedAt: 2233445566,
    });
    expect(mockBroadcastOpencodeAliasesUpdated).toHaveBeenCalledOnce();
    expect(mockBroadcastProviderList).toHaveBeenCalledOnce();
  });

  it("alias_not_found：找不到 alias 時回傳結構化錯誤", async () => {
    await handleOpencodeAliasesRefreshPresets(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: "missing-alias" },
      REQUEST_ID,
    );

    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(
      WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
    );
    expect(payload.success).toBe(false);
    expect(payload.error).toMatchObject({
      code: "alias_not_found",
      message: "找不到指定的 alias，無法刷新 thinking presets",
    });
  });

  it("fetch_failed：抓取官方 preset 失敗時回傳 service 錯誤且不廣播", async () => {
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

    setOpencodeThinkingPresetSnapshotFetcher(async () => ({
      ok: false,
      code: "fetch_failed",
      message: "抓取 thinking presets 失敗，請稍後再試",
    }));

    vi.clearAllMocks();
    await handleOpencodeAliasesRefreshPresets(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: createdId },
      REQUEST_ID,
    );

    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(
      WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
    );
    expect(payload.success).toBe(false);
    expect(payload.error).toMatchObject({
      code: "fetch_failed",
      message: "抓取 thinking presets 失敗，請稍後再試",
    });
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
    expect(mockBroadcastProviderList).not.toHaveBeenCalled();
  });
});

// ─── opencode:aliases:delete ──────────────────────────────────────────────────

describe("handleOpencodeAliasesDelete", () => {
  it("B4：delete 後 list 少一筆", async () => {
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

  it("不可刪除目前被 Pod 使用中的 opencode alias model", async () => {
    const aliasId = await createUsedAlias();
    insertCanvas();
    insertPod({
      id: "pod-uses-alias",
      name: "使用 alias 的 Pod",
      provider: "opencode",
      model: USED_MODEL_VALUE,
    });

    vi.clearAllMocks();
    await handleOpencodeAliasesDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: aliasId },
      REQUEST_ID,
    );

    const [, event, deletePayload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT);
    expect(deletePayload.success).toBe(false);
    expect(deletePayload.error.code).toBe("alias_in_use");
    expect(deletePayload.error.message).not.toContain("模型使用測試畫布");
    expect(deletePayload.error.message).not.toContain("使用 alias 的 Pod");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await handleOpencodeAliasesList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );
    expect(mockEmitToConnection.mock.calls[0][2].items).toHaveLength(1);
  });

  it("不可刪除目前被 Branch connection 使用中的 opencode alias model", async () => {
    const aliasId = await createUsedAlias();
    insertCanvas();
    insertPod({
      id: "source-pod",
      name: "來源 Pod",
      provider: "claude",
      model: "sonnet",
    });
    insertPod({
      id: "target-pod",
      name: "目標 Pod",
      provider: "claude",
      model: "sonnet",
    });
    insertConnection({
      id: "branch-conn",
      sourcePodId: "source-pod",
      targetPodId: "target-pod",
      triggerMode: "branch",
      label: "需要判斷",
      branchProvider: "opencode",
      branchModel: USED_MODEL_VALUE,
    });

    vi.clearAllMocks();
    await handleOpencodeAliasesDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: aliasId },
      REQUEST_ID,
    );

    const [, , deletePayload] = mockEmitToConnection.mock.calls[0];
    expect(deletePayload.success).toBe(false);
    expect(deletePayload.error.code).toBe("alias_in_use");
    expect(deletePayload.error.message).not.toContain("來源 Pod → 目標 Pod");
    expect(deletePayload.error.message).not.toContain("Branch");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
  });

  it("不可刪除目前被 Summary connection 使用中的 opencode alias model", async () => {
    const aliasId = await createUsedAlias();
    insertCanvas();
    insertPod({
      id: "summary-source-pod",
      name: "摘要來源 Pod",
      provider: "claude",
      model: "sonnet",
    });
    insertPod({
      id: "summary-target-pod",
      name: "摘要目標 Pod",
      provider: "claude",
      model: "sonnet",
    });
    insertConnection({
      id: "summary-conn",
      sourcePodId: "summary-source-pod",
      targetPodId: "summary-target-pod",
      summaryProvider: "opencode",
      summaryModel: USED_MODEL_VALUE,
    });

    vi.clearAllMocks();
    await handleOpencodeAliasesDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: aliasId },
      REQUEST_ID,
    );

    const [, , deletePayload] = mockEmitToConnection.mock.calls[0];
    expect(deletePayload.success).toBe(false);
    expect(deletePayload.error.code).toBe("alias_in_use");
    expect(deletePayload.error.message).not.toContain("摘要來源 Pod → 摘要目標 Pod");
    expect(deletePayload.error.message).not.toContain("Summary");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
  });

  it("provider NULL 的 Summary connection 會 fallback source Pod provider 並阻擋刪除/更新", async () => {
    const aliasId = await createUsedAlias();
    insertCanvas();
    insertPod({
      id: "summary-fallback-source",
      name: "Summary fallback source",
      provider: "opencode",
      model: USED_MODEL_VALUE,
    });
    insertPod({
      id: "summary-fallback-target",
      name: "Summary fallback target",
      provider: "claude",
      model: "sonnet",
    });
    insertConnection({
      id: "summary-fallback-conn",
      sourcePodId: "summary-fallback-source",
      targetPodId: "summary-fallback-target",
      summaryProvider: null,
      summaryModel: USED_MODEL_VALUE,
    });

    vi.clearAllMocks();
    await handleOpencodeAliasesDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: aliasId },
      REQUEST_ID,
    );

    let [, , payload] = mockEmitToConnection.mock.calls[0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("alias_in_use");
    expect(payload.error.message).not.toContain("Summary fallback source");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await handleOpencodeAliasesUpdate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        id: aliasId,
        modelID: "claude-3-5-haiku",
        alias: "UpdatedAlias",
      },
      REQUEST_ID,
    );

    [, , payload] = mockEmitToConnection.mock.calls[0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("alias_in_use");
    expect(payload.error.message).not.toContain("Summary fallback source");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
  });

  it("provider/model NULL 的 Branch connection 會 fallback source Pod provider/model 並阻擋刪除/更新", async () => {
    const aliasId = await createUsedAlias();
    insertCanvas();
    insertPod({
      id: "branch-fallback-source",
      name: "Branch fallback source",
      provider: "opencode",
      model: USED_MODEL_VALUE,
    });
    insertPod({
      id: "branch-fallback-target",
      name: "Branch fallback target",
      provider: "claude",
      model: "sonnet",
    });
    insertConnection({
      id: "branch-fallback-conn",
      sourcePodId: "branch-fallback-source",
      targetPodId: "branch-fallback-target",
      triggerMode: "branch",
      branchProvider: null,
      branchModel: null,
    });

    vi.clearAllMocks();
    await handleOpencodeAliasesDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, id: aliasId },
      REQUEST_ID,
    );

    let [, , payload] = mockEmitToConnection.mock.calls[0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("alias_in_use");
    expect(payload.error.message).not.toContain("Branch fallback source");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await handleOpencodeAliasesUpdate(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        id: aliasId,
        modelID: "claude-3-5-haiku",
        alias: "UpdatedAlias",
      },
      REQUEST_ID,
    );

    [, , payload] = mockEmitToConnection.mock.calls[0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("alias_in_use");
    expect(payload.error.message).not.toContain("Branch fallback source");
    expect(mockBroadcastOpencodeAliasesUpdated).not.toHaveBeenCalled();
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
