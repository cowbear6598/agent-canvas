import { describe, it, expect, vi, beforeEach } from "vitest";

// --- assertCapability 所需 mock ---
const mockEmitError = vi.fn();
const mockGetProvider = vi.fn();

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: mockEmitError,
  emitNotFound: vi.fn(),
  emitSuccess: vi.fn(),
}));

vi.mock("../../src/services/provider/index.js", () => ({
  getProvider: mockGetProvider,
}));

// --- getPodDisplayName 所需 mock ---
const mockGetById = vi.fn();

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getById: mockGetById,
  },
}));

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: { getActiveCanvas: vi.fn() },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: { emitToCanvas: vi.fn(), emitToAll: vi.fn() },
}));

const { getPodDisplayName, assertCapability } =
  await import("../../src/utils/handlerHelpers.js");

describe("getPodDisplayName", () => {
  beforeEach(() => {
    mockGetById.mockReset();
  });

  it("Pod 存在時應回傳 Pod 名稱", () => {
    mockGetById.mockReturnValue({ id: "pod-1", name: "My Pod" });

    const result = getPodDisplayName("canvas-1", "pod-1");

    expect(result).toBe("My Pod");
  });

  it("Pod 不存在時應回傳 podId 作為 fallback", () => {
    mockGetById.mockReturnValue(undefined);

    const result = getPodDisplayName("canvas-1", "pod-1");

    expect(result).toBe("pod-1");
  });
});

describe("assertCapability", () => {
  const CONNECTION_ID = "conn-1";
  const REQUEST_ID = "req-1";
  const CANVAS_ID = "canvas-1";
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
