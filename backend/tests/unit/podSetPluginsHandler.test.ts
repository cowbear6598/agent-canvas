import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock 函式 ---
const mockValidatePod = vi.fn();
const mockPodStoreUpdate = vi.fn();
const mockEmitError = vi.fn();
const mockEmitToCanvas = vi.fn();

// --- vi.mock ---

vi.mock("../../src/utils/handlerHelpers.js", () => ({
  withCanvasId:
    (
      _event: unknown,
      handler: (
        connectionId: string,
        canvasId: string,
        payload: unknown,
        requestId: string,
      ) => Promise<void>,
    ) =>
    (connectionId: string, payload: unknown, requestId: string) =>
      handler(connectionId, "canvas-1", payload, requestId),
  validatePod: (...args: unknown[]) => mockValidatePod(...args),
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    update: (...args: unknown[]) => mockPodStoreUpdate(...args),
  },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: (...args: unknown[]) => mockEmitError(...args),
  emitSuccess: vi.fn(),
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: (...args: unknown[]) => mockEmitToCanvas(...args),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    POD_PLUGINS_SET: "pod:plugins:set",
    POD_CREATED: "pod:created",
    POD_LIST_RESULT: "pod:list:result",
    POD_GET_RESULT: "pod:get:result",
    POD_RENAMED: "pod:renamed",
    POD_DELETED: "pod:deleted",
    POD_MOVED: "pod:moved",
    POD_MODEL_SET: "pod:model:set",
    POD_SCHEDULE_SET: "pod:schedule:set",
    POD_DIRECTORY_OPENED: "pod:directory:opened",
    POD_MULTI_INSTANCE_SET: "pod:multi-instance:set",
  },
}));

vi.mock("../../src/services/podService.js", () => ({
  createPodWithWorkspace: vi.fn(),
  deletePodWithCleanup: vi.fn(),
}));

vi.mock("../../src/services/repositoryService.js", () => ({
  repositoryService: { getById: vi.fn() },
}));

const { handlePodSetPlugins } =
  await import("../../src/handlers/podHandlers.js");

const CONNECTION_ID = "conn-1";
const POD_ID = "pod-uuid-1";
const CANVAS_ID = "canvas-1";
const REQUEST_ID = "req-1";

function makePod(overrides: Record<string, unknown> = {}) {
  return {
    id: POD_ID,
    name: "測試 Pod",
    pluginIds: [],
    ...overrides,
  };
}

describe("handlePodSetPlugins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("設定 Pod Plugin 成功，應廣播 POD_PLUGINS_SET 事件", async () => {
    const existingPod = makePod();
    const updatedPod = makePod({ pluginIds: ["plugin-1", "plugin-2"] });

    mockValidatePod.mockReturnValue(existingPod);
    mockPodStoreUpdate.mockReturnValue({ pod: updatedPod });

    await handlePodSetPlugins(
      CONNECTION_ID,
      {
        canvasId: CANVAS_ID,
        podId: POD_ID,
        pluginIds: ["plugin-1", "plugin-2"],
      },
      REQUEST_ID,
    );

    expect(mockPodStoreUpdate).toHaveBeenCalledWith(CANVAS_ID, POD_ID, {
      pluginIds: ["plugin-1", "plugin-2"],
    });

    expect(mockEmitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      "pod:plugins:set",
      expect.objectContaining({
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        success: true,
        pod: updatedPod,
      }),
    );
  });

  it("Pod 不存在時應回傳錯誤", async () => {
    mockValidatePod.mockReturnValue(undefined);

    await handlePodSetPlugins(
      CONNECTION_ID,
      { canvasId: CANVAS_ID, podId: POD_ID, pluginIds: [] },
      REQUEST_ID,
    );

    expect(mockPodStoreUpdate).not.toHaveBeenCalled();
    expect(mockEmitToCanvas).not.toHaveBeenCalled();
  });

  it("podStore.update 失敗時應回傳 INTERNAL_ERROR", async () => {
    const existingPod = makePod();
    mockValidatePod.mockReturnValue(existingPod);
    mockPodStoreUpdate.mockReturnValue(null);

    await handlePodSetPlugins(
      CONNECTION_ID,
      { canvasId: CANVAS_ID, podId: POD_ID, pluginIds: ["plugin-1"] },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:plugins:set",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "INTERNAL_ERROR",
    );
    expect(mockEmitToCanvas).not.toHaveBeenCalled();
  });
});
