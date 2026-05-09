import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useWorkflowClear } from "@/composables/pod/useWorkflowClear";
import { useCanvasStore } from "@/stores/canvasStore";

vi.mock("@/services/websocket", () => webSocketMockFactory());

describe("useWorkflowClear", () => {
  const podId = ref("pod-1");

  let mockClearMessagesByPodIds: ReturnType<typeof vi.fn>;
  let mockClearPodOutputsByIds: ReturnType<typeof vi.fn>;

  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  beforeEach(() => {
    mockClearMessagesByPodIds = vi.fn();
    mockClearPodOutputsByIds = vi.fn();
  });

  function buildStores() {
    return {
      chatStore: {
        clearMessagesByPodIds: mockClearMessagesByPodIds as (
          podIds: string[],
        ) => void,
      },
      podStore: {
        clearPodOutputsByIds: mockClearPodOutputsByIds as (
          podIds: string[],
        ) => void,
      },
    };
  }

  describe("handleClearWorkflow", () => {
    it("無 canvasId 時應直接 return，不進行 WebSocket 請求", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      const { handleClearWorkflow, showClearDialog } = useWorkflowClear(
        podId,
        buildStores(),
      );
      await handleClearWorkflow();

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(showClearDialog.value).toBe(false);
    });

    it("請求失敗時（回傳 null）不應顯示 dialog", async () => {
      mockCreateWebSocketRequest.mockResolvedValueOnce(null);

      const { handleClearWorkflow, showClearDialog } = useWorkflowClear(
        podId,
        buildStores(),
      );
      await handleClearWorkflow();

      expect(showClearDialog.value).toBe(false);
    });

    it("請求回傳無 pods 欄位時不應顯示 dialog", async () => {
      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const { handleClearWorkflow, showClearDialog } = useWorkflowClear(
        podId,
        buildStores(),
      );
      await handleClearWorkflow();

      expect(showClearDialog.value).toBe(false);
    });

    it("成功時應設定 downstreamPods 並顯示 dialog", async () => {
      const pods = [
        { id: "pod-2", name: "Pod 2" },
        { id: "pod-3", name: "Pod 3" },
      ];
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pods });

      const { handleClearWorkflow, showClearDialog, downstreamPods } =
        useWorkflowClear(podId, buildStores());
      await handleClearWorkflow();

      expect(downstreamPods.value).toEqual(pods);
      expect(showClearDialog.value).toBe(true);
    });

    it("請求進行中 isLoadingDownstream 應為 true，完成後為 false", async () => {
      let resolveRequest: (value: unknown) => void;
      const requestPromise = new Promise((resolve) => {
        resolveRequest = resolve;
      });
      mockCreateWebSocketRequest.mockReturnValueOnce(requestPromise);

      const { handleClearWorkflow, isLoadingDownstream } = useWorkflowClear(
        podId,
        buildStores(),
      );
      const clearPromise = handleClearWorkflow();

      expect(isLoadingDownstream.value).toBe(true);

      resolveRequest!({ pods: [] });
      await clearPromise;

      expect(isLoadingDownstream.value).toBe(false);
    });
  });

  describe("handleConfirmClear", () => {
    it("無 canvasId 時應直接 return", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      const { handleConfirmClear, showClearDialog } = useWorkflowClear(
        podId,
        buildStores(),
      );
      await handleConfirmClear();

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(showClearDialog.value).toBe(false);
    });

    it("清除成功後應呼叫 clearMessagesByPodIds", async () => {
      const clearedPodIds = ["pod-2", "pod-3"];
      mockCreateWebSocketRequest.mockResolvedValueOnce({ clearedPodIds });

      const { handleConfirmClear } = useWorkflowClear(podId, buildStores());
      await handleConfirmClear();

      expect(mockClearMessagesByPodIds).toHaveBeenCalledWith(clearedPodIds);
    });

    it("清除成功後應呼叫 clearPodOutputsByIds", async () => {
      const clearedPodIds = ["pod-2", "pod-3"];
      mockCreateWebSocketRequest.mockResolvedValueOnce({ clearedPodIds });

      const { handleConfirmClear } = useWorkflowClear(podId, buildStores());
      await handleConfirmClear();

      expect(mockClearPodOutputsByIds).toHaveBeenCalledWith(clearedPodIds);
    });

    it("清除成功後應關閉 dialog 並清空 downstreamPods", async () => {
      const pods = [{ id: "pod-2", name: "Pod 2" }];
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ pods })
        .mockResolvedValueOnce({ clearedPodIds: ["pod-2"] });

      const {
        handleClearWorkflow,
        handleConfirmClear,
        showClearDialog,
        downstreamPods,
      } = useWorkflowClear(podId, buildStores());

      await handleClearWorkflow();
      expect(showClearDialog.value).toBe(true);
      expect(downstreamPods.value).toEqual(pods);

      await handleConfirmClear();

      expect(showClearDialog.value).toBe(false);
      expect(downstreamPods.value).toEqual([]);
    });

    it("清除回傳 null 時不應呼叫後續的 store 方法", async () => {
      mockCreateWebSocketRequest.mockResolvedValueOnce(null);

      const { handleConfirmClear } = useWorkflowClear(podId, buildStores());
      await handleConfirmClear();

      expect(mockClearMessagesByPodIds).not.toHaveBeenCalled();
      expect(mockClearPodOutputsByIds).not.toHaveBeenCalled();
    });

    it("清除進行中 isClearing 應為 true，完成後為 false", async () => {
      let resolveRequest: (value: unknown) => void;
      const requestPromise = new Promise((resolve) => {
        resolveRequest = resolve;
      });
      mockCreateWebSocketRequest.mockReturnValueOnce(requestPromise);

      const { handleConfirmClear, isClearing } = useWorkflowClear(
        podId,
        buildStores(),
      );
      const confirmPromise = handleConfirmClear();

      expect(isClearing.value).toBe(true);

      resolveRequest!({ clearedPodIds: [] });
      await confirmPromise;

      expect(isClearing.value).toBe(false);
    });
  });

  describe("handleCancelClear", () => {
    it("應關閉 dialog 並清空 downstreamPods", async () => {
      const pods = [{ id: "pod-2", name: "Pod 2" }];
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pods });

      const {
        handleClearWorkflow,
        handleCancelClear,
        showClearDialog,
        downstreamPods,
      } = useWorkflowClear(podId, buildStores());

      await handleClearWorkflow();
      expect(showClearDialog.value).toBe(true);

      handleCancelClear();

      expect(showClearDialog.value).toBe(false);
      expect(downstreamPods.value).toEqual([]);
    });
  });
});
