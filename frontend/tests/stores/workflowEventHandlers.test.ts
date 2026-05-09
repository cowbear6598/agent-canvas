import { describe, it, expect, vi } from "vitest";
import { createWorkflowEventHandlers } from "@/stores/workflowEventHandlers";
import type { Connection } from "@/types/connection";

/**
 * 建立 mock WorkflowHandlerStore，用以驗證 handler 呼叫
 */
function createMockStore(connections: Connection[] = []) {
  return {
    connections,
    updateAutoGroupStatus: vi.fn(),
    setConnectionStatus: vi.fn(),
  };
}

function createMockConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-1",
    sourcePodId: "pod-source",
    sourceAnchor: "bottom",
    targetPodId: "pod-target",
    targetAnchor: "top",
    triggerMode: "auto",
    ...overrides,
  } as Connection;
}

describe("workflowEventHandlers", () => {
  describe("handleWorkflowAutoTriggered", () => {
    it("應呼叫 updateAutoGroupStatus 將 targetPodId 設為 active", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowAutoTriggered({
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
        transferredContent: "內容",
        isSummarized: false,
      });

      expect(store.updateAutoGroupStatus).toHaveBeenCalledWith(
        "pod-target",
        "active",
      );
    });
  });

  describe("handleWorkflowBranchTriggered", () => {
    it("應呼叫 updateAutoGroupStatus 將 targetPodId 設為 active", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowBranchTriggered({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
      });

      expect(store.updateAutoGroupStatus).toHaveBeenCalledWith(
        "pod-target",
        "active",
      );
    });
  });

  describe("handleWorkflowComplete", () => {
    it("triggerMode 為 auto 時應呼叫 updateAutoGroupStatus 設為 idle", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowComplete({
        connectionId: "conn-1",
        targetPodId: "pod-target",
        triggerMode: "auto",
        requestId: "req-1",
        success: true,
      });

      expect(store.updateAutoGroupStatus).toHaveBeenCalledWith(
        "pod-target",
        "idle",
      );
      expect(store.setConnectionStatus).not.toHaveBeenCalled();
    });

    it("triggerMode 為 ai-decide 時應呼叫 updateAutoGroupStatus 設為 idle", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowComplete({
        connectionId: "conn-1",
        targetPodId: "pod-target",
        triggerMode: "branch",
        requestId: "req-1",
        success: true,
      });

      expect(store.updateAutoGroupStatus).toHaveBeenCalledWith(
        "pod-target",
        "idle",
      );
      expect(store.setConnectionStatus).not.toHaveBeenCalled();
    });

    it("triggerMode 為 direct 時應呼叫 setConnectionStatus 設為 idle", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowComplete({
        connectionId: "conn-1",
        targetPodId: "pod-target",
        triggerMode: "direct",
        requestId: "req-1",
        success: true,
      });

      expect(store.setConnectionStatus).toHaveBeenCalledWith("conn-1", "idle");
      expect(store.updateAutoGroupStatus).not.toHaveBeenCalled();
    });

    it("triggerMode 為 undefined 時應呼叫 setConnectionStatus（非 auto-triggerable）", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowComplete({
        connectionId: "conn-1",
        targetPodId: "pod-target",
        requestId: "req-1",
        success: true,
      });

      expect(store.setConnectionStatus).toHaveBeenCalledWith("conn-1", "idle");
    });
  });

  describe("handleWorkflowDirectTriggered", () => {
    it("應呼叫 setConnectionStatus 設為 active", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowDirectTriggered({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
        transferredContent: "內容",
        isSummarized: false,
      });

      expect(store.setConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "active",
      );
    });
  });

  describe("handleWorkflowDirectWaiting", () => {
    it("應呼叫 setConnectionStatus 設為 waiting", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowDirectWaiting({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
      });

      expect(store.setConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "waiting",
      );
    });
  });

  describe("handleWorkflowQueued", () => {
    it("triggerMode 為 auto 時應呼叫 updateAutoGroupStatus 設為 queued", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowQueued({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
        position: 1,
        queueSize: 2,
        triggerMode: "auto",
      });

      expect(store.updateAutoGroupStatus).toHaveBeenCalledWith(
        "pod-target",
        "queued",
      );
    });

    it("triggerMode 為 direct 時應呼叫 setConnectionStatus 設為 queued", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowQueued({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
        position: 1,
        queueSize: 2,
        triggerMode: "direct",
      });

      expect(store.setConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "queued",
      );
    });
  });

  describe("handleWorkflowQueueProcessed", () => {
    it("triggerMode 為 auto 時應呼叫 updateAutoGroupStatus 設為 active", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowQueueProcessed({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
        remainingQueueSize: 0,
        triggerMode: "auto",
      });

      expect(store.updateAutoGroupStatus).toHaveBeenCalledWith(
        "pod-target",
        "active",
      );
    });

    it("triggerMode 為 direct 時應呼叫 setConnectionStatus 設為 active", () => {
      const store = createMockStore();
      const handlers = createWorkflowEventHandlers(store);

      handlers.handleWorkflowQueueProcessed({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
        remainingQueueSize: 0,
        triggerMode: "direct",
      });

      expect(store.setConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "active",
      );
    });
  });
});
