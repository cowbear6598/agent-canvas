import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pod } from "../../src/types/index.js";

const mockValidatePod = vi.fn();
const mockEmitPodUpdated = vi.fn();
const mockSetMultiInstance = vi.fn();
const mockEmitError = vi.fn();
// assertCapability：預設回傳 true（能力支援），可在個別測試覆寫為 false
const mockAssertCapability = vi.fn().mockReturnValue(true);

vi.mock("../../src/utils/handlerHelpers.js", () => ({
  validatePod: mockValidatePod,
  emitPodUpdated: mockEmitPodUpdated,
  assertCapability: mockAssertCapability,
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
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    setMultiInstance: mockSetMultiInstance,
  },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: mockEmitError,
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    POD_MULTI_INSTANCE_SET: "pod:multiInstanceSet",
  },
}));

const { handlePodSetMultiInstance } =
  await import("../../src/handlers/multiInstanceHandlers.js");

const CONNECTION_ID = "conn-1";
const CANVAS_ID = "canvas-1";
const POD_ID = "pod-1";
const REQUEST_ID = "req-1";

const mockPod: Pod = {
  id: POD_ID,
  name: "Test Pod",
  status: "idle",
  x: 0,
  y: 0,
  rotation: 0,
  workspacePath: "/tmp",
  sessionId: null,
  repositoryId: null,
  commandId: null,
  multiInstance: false,
  skillIds: [],

  mcpServerIds: [],
  provider: "claude",
  providerConfig: { model: "opus" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handlePodSetMultiInstance", () => {
  describe("成功路徑", () => {
    it("multiInstance: true 時應呼叫 podStore.setMultiInstance 並廣播更新", async () => {
      mockValidatePod.mockReturnValue(mockPod);

      await handlePodSetMultiInstance(
        CONNECTION_ID,
        { podId: POD_ID, multiInstance: true },
        REQUEST_ID,
      );

      expect(mockSetMultiInstance).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        true,
      );
      expect(mockEmitPodUpdated).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        REQUEST_ID,
        "pod:multiInstanceSet",
      );
    });

    it("multiInstance: false 時應正確傳遞 false 給 podStore.setMultiInstance", async () => {
      mockValidatePod.mockReturnValue(mockPod);

      await handlePodSetMultiInstance(
        CONNECTION_ID,
        { podId: POD_ID, multiInstance: false },
        REQUEST_ID,
      );

      expect(mockSetMultiInstance).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        false,
      );
      expect(mockEmitPodUpdated).toHaveBeenCalledOnce();
    });
  });

  describe("Pod 不存在時", () => {
    it("validatePod 回傳 undefined 時應提前 return，不呼叫 setMultiInstance", async () => {
      mockValidatePod.mockReturnValue(undefined);

      await handlePodSetMultiInstance(
        CONNECTION_ID,
        { podId: POD_ID, multiInstance: true },
        REQUEST_ID,
      );

      expect(mockSetMultiInstance).not.toHaveBeenCalled();
    });

    it("validatePod 回傳 undefined 時不應呼叫 emitPodUpdated", async () => {
      mockValidatePod.mockReturnValue(undefined);

      await handlePodSetMultiInstance(
        CONNECTION_ID,
        { podId: POD_ID, multiInstance: true },
        REQUEST_ID,
      );

      expect(mockEmitPodUpdated).not.toHaveBeenCalled();
    });
  });

  describe("Capability 守門", () => {
    it("multiInstance: true 且 assertCapability 回傳 false 時應提前 return，不呼叫 setMultiInstance", async () => {
      mockValidatePod.mockReturnValue(mockPod);
      // 模擬不支援 runMode 的 provider（如 codex）
      mockAssertCapability.mockReturnValue(false);

      await handlePodSetMultiInstance(
        CONNECTION_ID,
        { podId: POD_ID, multiInstance: true },
        REQUEST_ID,
      );

      expect(mockSetMultiInstance).not.toHaveBeenCalled();
      expect(mockEmitPodUpdated).not.toHaveBeenCalled();
    });

    it("multiInstance: false 時即使 assertCapability 未被呼叫也應正常執行（關閉方向不擋）", async () => {
      mockValidatePod.mockReturnValue(mockPod);

      await handlePodSetMultiInstance(
        CONNECTION_ID,
        { podId: POD_ID, multiInstance: false },
        REQUEST_ID,
      );

      // 關閉方向不應觸發 capability 守門
      expect(mockAssertCapability).not.toHaveBeenCalled();
      expect(mockSetMultiInstance).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        false,
      );
    });

    it("multiInstance: true 且 assertCapability 回傳 true 時應正常呼叫 setMultiInstance", async () => {
      mockValidatePod.mockReturnValue(mockPod);
      mockAssertCapability.mockReturnValue(true);

      await handlePodSetMultiInstance(
        CONNECTION_ID,
        { podId: POD_ID, multiInstance: true },
        REQUEST_ID,
      );

      expect(mockAssertCapability).toHaveBeenCalledWith(
        CONNECTION_ID,
        mockPod,
        "runMode",
        "pod:multiInstanceSet",
        REQUEST_ID,
      );
      expect(mockSetMultiInstance).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        true,
      );
    });
  });
});
