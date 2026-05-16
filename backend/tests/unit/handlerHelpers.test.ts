/**
 * handlerHelpers 單元測試
 *
 * 保留合理 boundary mock：
 *   - getProvider（SDK boundary：assertCapability 直接呼叫；podStore.getById 透過 buildPodFromRow 需要 metadata）
 *   - emitError / socketService（WebSocket 邊界）
 * 移除 podStore.getById 自家 mock，改用 initTestDb + 真實 store。
 */

// vi.hoisted 讓這些 fn 在 vi.mock 工廠被提升後仍可存取
const { mockGetProvider, mockEmitError } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(() => ({
    metadata: {
      capabilities: { chat: true, plugin: true, mcp: false, repository: false },
      availableModelValues: new Set(["sonnet", "opus", "haiku"]),
      availableModels: [
        { label: "Sonnet", value: "sonnet" },
        { label: "Opus", value: "opus" },
      ],
      defaultOptions: { model: "sonnet" },
    },
  })),
  mockEmitError: vi.fn(),
}));

// getProvider 是 SDK boundary — assertCapability 直接讀取 metadata.capabilities
// 同時 podStore.getById → buildPodFromRow → resolveProviderConfig 也需要 metadata
vi.mock("../../src/services/provider/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/services/provider/index.js")
    >();
  return { ...actual, getProvider: mockGetProvider };
});

// emitError 是 WebSocket boundary — 保留 mock 以驗證呼叫參數
vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: mockEmitError,
  emitNotFound: vi.fn(),
  emitSuccess: vi.fn(),
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: { emitToCanvas: vi.fn(), emitToAll: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPodDisplayName,
  assertCapability,
} from "../../src/utils/handlerHelpers.js";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

const CANVAS_ID = "canvas-handler-test";
const POD_ID = "pod-handler-test";

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "Handler Test Canvas", 0);
}

function insertPod(name: string): void {
  getDb()
    .prepare(
      `INSERT INTO pods
             (id, canvas_id, name, x, y, rotation, workspace_path,
              session_id, repository_id, goal_json,
              schedule_json, provider, provider_config_json)
             VALUES (?, ?, ?, 0, 0, 0, '/tmp/handler-pod', NULL, NULL, NULL, NULL, 'claude',
             '{"model":"sonnet"}')`,
    )
    .run(POD_ID, CANVAS_ID, name);
}

describe("getPodDisplayName", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    insertCanvas();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  it("Pod 存在時應回傳 Pod 名稱", () => {
    insertPod("My Pod");

    const result = getPodDisplayName(CANVAS_ID, POD_ID);

    expect(result).toBe("My Pod");
  });

  it("Pod 不存在時應回傳 podId 作為 fallback", () => {
    // 不插入 pod，模擬找不到情況
    const result = getPodDisplayName(CANVAS_ID, "non-existent-pod");

    expect(result).toBe("non-existent-pod");
  });
});

describe("assertCapability", () => {
  const CONNECTION_ID = "conn-1";
  const REQUEST_ID = "req-1";
  const RESPONSE_EVENT = "pod:integrationBound" as any;

  function makePod(provider = "claude") {
    return { id: "pod-1", name: "Test Pod", provider } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("capability 支援時，回傳 true 且不呼叫 emitError", () => {
    mockGetProvider.mockReturnValue({
      metadata: {
        capabilities: { chat: true, plugin: true },
        availableModelValues: new Set(["sonnet"]),
        availableModels: [],
        defaultOptions: { model: "sonnet" },
      },
    });

    const result = assertCapability(
      CONNECTION_ID,
      makePod("claude"),
      "chat",
      RESPONSE_EVENT,
      REQUEST_ID,
      CANVAS_ID,
    );

    expect(result).toBe(true);
    expect(mockEmitError).not.toHaveBeenCalled();
  });

  it("capability 不支援時，呼叫 emitError 帶 CAPABILITY_NOT_SUPPORTED code，並回傳 false", () => {
    mockGetProvider.mockReturnValue({
      metadata: {
        capabilities: { chat: false, plugin: false },
        availableModelValues: new Set(["sonnet"]),
        availableModels: [],
        defaultOptions: { model: "sonnet" },
      },
    });

    const result = assertCapability(
      CONNECTION_ID,
      makePod("claude"),
      "plugin",
      RESPONSE_EVENT,
      REQUEST_ID,
      CANVAS_ID,
    );

    expect(result).toBe(false);
    expect(mockEmitError).toHaveBeenCalledOnce();
    const [, , , , , , errorCode] = mockEmitError.mock.calls[0];
    expect(errorCode).toBe("CAPABILITY_NOT_SUPPORTED");
  });

  it("capability 不支援時，emitError 收到的 canvasId 為 null（無 canvas 範疇）", () => {
    mockGetProvider.mockReturnValue({
      metadata: {
        capabilities: { mcp: false },
        availableModelValues: new Set(["sonnet"]),
        availableModels: [],
        defaultOptions: { model: "sonnet" },
      },
    });

    assertCapability(
      CONNECTION_ID,
      makePod("codex"),
      "mcp",
      RESPONSE_EVENT,
      REQUEST_ID,
      null,
    );

    const [, , , passedCanvasId] = mockEmitError.mock.calls[0];
    expect(passedCanvasId).toBeNull();
  });

  it("capability 不支援時，emitError 收到的 canvasId 是 caller 帶入的字串值", () => {
    mockGetProvider.mockReturnValue({
      metadata: {
        capabilities: { repository: false },
        availableModelValues: new Set(["sonnet"]),
        availableModels: [],
        defaultOptions: { model: "sonnet" },
      },
    });

    assertCapability(
      CONNECTION_ID,
      makePod("claude"),
      "repository",
      RESPONSE_EVENT,
      REQUEST_ID,
      "canvas-abc",
    );

    const [, , , passedCanvasId] = mockEmitError.mock.calls[0];
    expect(passedCanvasId).toBe("canvas-abc");
  });
});
