import { describe, it, expect, vi } from "vitest";
import { setActivePinia } from "pinia";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { useCanvasStore } from "@/stores/canvasStore";
import { useRunStore } from "@/stores/run/runStore";
import {
  getRunEventListeners,
  getRunStandaloneListeners,
  handleRunMessage,
  handleRunChatComplete,
  handleRunToolUse,
  handleRunToolResult,
} from "@/composables/eventHandlers/runEventHandlers";
import type { WorkflowRun } from "@/types/run";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  tryResolvePendingRequest: vi.fn().mockReturnValue(false),
  createWebSocketRequest: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

function createMockRun(overrides?: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "pod-1",
    sourcePodName: "Pod 1",
    triggerMessage: "Hello",
    status: "running",
    podInstances: [
      {
        id: "pi-1",
        runId: "run-1",
        podId: "pod-1",
        podName: "Pod 1",
        status: "pending",
        autoPathwaySettled: "not-applicable",
        directPathwaySettled: "not-applicable",
      },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("runEventHandlers", () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  describe("getRunEventListeners", () => {
    it("應回傳 4 個 unified listener", () => {
      const result = getRunEventListeners();
      expect(result).toHaveLength(4);
    });

    it("應包含 run:created、run:status:changed、run:pod:status:changed、run:deleted", () => {
      const result = getRunEventListeners();
      const events = result.map((l) => l.event);
      expect(events).toContain("run:created");
      expect(events).toContain("run:status:changed");
      expect(events).toContain("run:pod:status:changed");
      expect(events).toContain("run:deleted");
    });
  });

  describe("getRunStandaloneListeners", () => {
    it("應回傳 4 個 standalone listener", () => {
      const result = getRunStandaloneListeners();
      expect(result).toHaveLength(4);
    });

    it("應包含 run:message、run:chat:complete、run:tool_use、run:tool_result", () => {
      const result = getRunStandaloneListeners();
      const events = result.map((l) => l.event);
      expect(events).toContain("run:message");
      expect(events).toContain("run:chat:complete");
      expect(events).toContain("run:tool_use");
      expect(events).toContain("run:tool_result");
    });
  });

  describe("unified handler - RUN_CREATED", () => {
    it("收到當前 canvas 的事件時應呼叫 addRun", () => {
      const runStore = useRunStore();
      const addRunSpy = vi.spyOn(runStore, "addRun");
      const run = createMockRun();

      const listeners = getRunEventListeners();
      const handler = listeners.find((l) => l.event === "run:created")!.handler;

      handler({ canvasId: "canvas-1", run });

      expect(addRunSpy).toHaveBeenCalledWith(run);
    });

    it("收到其他 canvas 的事件時應略過", () => {
      const runStore = useRunStore();
      const addRunSpy = vi.spyOn(runStore, "addRun");
      const run = createMockRun();

      const listeners = getRunEventListeners();
      const handler = listeners.find((l) => l.event === "run:created")!.handler;

      handler({ canvasId: "other-canvas", run });

      expect(addRunSpy).not.toHaveBeenCalled();
    });
  });

  describe("unified handler - RUN_STATUS_CHANGED", () => {
    it("收到當前 canvas 的事件時應呼叫 updateRunStatus", () => {
      const runStore = useRunStore();
      runStore.runs = [createMockRun()];
      const updateSpy = vi.spyOn(runStore, "updateRunStatus");

      const listeners = getRunEventListeners();
      const handler = listeners.find(
        (l) => l.event === "run:status:changed",
      )!.handler;

      handler({
        canvasId: "canvas-1",
        runId: "run-1",
        status: "completed",
        completedAt: "2024-01-01T00:00:00Z",
      });

      expect(updateSpy).toHaveBeenCalledWith(
        "run-1",
        "completed",
        "2024-01-01T00:00:00Z",
      );
    });

    it("收到其他 canvas 的事件時應略過", () => {
      const runStore = useRunStore();
      const updateSpy = vi.spyOn(runStore, "updateRunStatus");

      const listeners = getRunEventListeners();
      const handler = listeners.find(
        (l) => l.event === "run:status:changed",
      )!.handler;

      handler({
        canvasId: "other-canvas",
        runId: "run-1",
        status: "completed",
      });

      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe("unified handler - RUN_POD_STATUS_CHANGED", () => {
    it("收到當前 canvas 的事件時應呼叫 updatePodInstanceStatus", () => {
      const runStore = useRunStore();
      runStore.runs = [createMockRun()];
      const updateSpy = vi.spyOn(runStore, "updatePodInstanceStatus");

      const listeners = getRunEventListeners();
      const handler = listeners.find(
        (l) => l.event === "run:pod:status:changed",
      )!.handler;

      handler({
        canvasId: "canvas-1",
        runId: "run-1",
        podId: "pod-1",
        status: "running",
        lastResponseSummary: "摘要",
      });

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          podId: "pod-1",
          status: "running",
          lastResponseSummary: "摘要",
        }),
      );
    });
  });

  describe("unified handler - RUN_DELETED", () => {
    it("收到當前 canvas 的事件時應呼叫 removeRun（不發 WebSocket）", () => {
      const runStore = useRunStore();
      runStore.runs = [createMockRun()];
      const removeSpy = vi.spyOn(runStore, "removeRun");
      const deleteRunSpy = vi.spyOn(runStore, "deleteRun");

      const listeners = getRunEventListeners();
      const handler = listeners.find((l) => l.event === "run:deleted")!.handler;

      handler({ canvasId: "canvas-1", runId: "run-1" });

      expect(removeSpy).toHaveBeenCalledWith("run-1");
      expect(deleteRunSpy).not.toHaveBeenCalled();
    });

    it("收到其他 canvas 的事件時應略過", () => {
      const runStore = useRunStore();
      runStore.runs = [createMockRun()];
      const removeSpy = vi.spyOn(runStore, "removeRun");

      const listeners = getRunEventListeners();
      const handler = listeners.find((l) => l.event === "run:deleted")!.handler;

      handler({ canvasId: "other-canvas", runId: "run-1" });

      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe("standalone handler - handleRunMessage", () => {
    it("當前 canvas 且有開啟訊息 key 時應呼叫 appendRunChatMessage", () => {
      const runStore = useRunStore();
      const appendSpy = vi.spyOn(runStore, "appendRunChatMessage");

      handleRunMessage({
        canvasId: "canvas-1",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        content: "測試內容",
        isPartial: true,
        role: "assistant",
      });

      expect(appendSpy).toHaveBeenCalledWith(
        "run-1",
        "pod-1",
        "msg-1",
        "測試內容",
        true,
        "assistant",
        undefined,
      );
    });

    it("role 未提供時應 fallback 為 assistant", () => {
      const runStore = useRunStore();
      const appendSpy = vi.spyOn(runStore, "appendRunChatMessage");

      handleRunMessage({
        canvasId: "canvas-1",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        content: "測試",
        isPartial: false,
      });

      expect(appendSpy).toHaveBeenCalledWith(
        "run-1",
        "pod-1",
        "msg-1",
        "測試",
        false,
        "assistant",
        undefined,
      );
    });

    it("其他 canvas 的事件應略過", () => {
      const runStore = useRunStore();
      const appendSpy = vi.spyOn(runStore, "appendRunChatMessage");

      handleRunMessage({
        canvasId: "other-canvas",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        content: "測試",
        isPartial: false,
      });

      expect(appendSpy).not.toHaveBeenCalled();
    });
  });

  describe("standalone handler - handleRunChatComplete", () => {
    it("當前 canvas 時應呼叫 handleRunChatComplete", () => {
      const runStore = useRunStore();
      const completeSpy = vi.spyOn(runStore, "handleRunChatComplete");

      handleRunChatComplete({
        canvasId: "canvas-1",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "完整內容",
      });

      expect(completeSpy).toHaveBeenCalledWith(
        "run-1",
        "pod-1",
        "msg-1",
        "完整內容",
      );
    });

    it("其他 canvas 的事件應略過", () => {
      const runStore = useRunStore();
      const completeSpy = vi.spyOn(runStore, "handleRunChatComplete");

      handleRunChatComplete({
        canvasId: "other-canvas",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "完整內容",
      });

      expect(completeSpy).not.toHaveBeenCalled();
    });
  });

  describe("standalone handler - handleRunToolUse", () => {
    it("當前 canvas 時應呼叫 handleRunChatToolUse", () => {
      const runStore = useRunStore();
      const toolUseSpy = vi.spyOn(runStore, "handleRunChatToolUse");

      handleRunToolUse({
        canvasId: "canvas-1",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "echo test" },
      });

      expect(toolUseSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          podId: "pod-1",
          toolUseId: "tool-1",
          toolName: "Bash",
        }),
      );
    });

    it("其他 canvas 的事件應略過", () => {
      const runStore = useRunStore();
      const toolUseSpy = vi.spyOn(runStore, "handleRunChatToolUse");

      handleRunToolUse({
        canvasId: "other-canvas",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      expect(toolUseSpy).not.toHaveBeenCalled();
    });
  });

  describe("standalone handler - handleRunToolResult", () => {
    it("當前 canvas 時應呼叫 handleRunChatToolResult", () => {
      const runStore = useRunStore();
      const toolResultSpy = vi.spyOn(runStore, "handleRunChatToolResult");

      handleRunToolResult({
        canvasId: "canvas-1",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        output: "結果輸出",
      });

      expect(toolResultSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          podId: "pod-1",
          toolUseId: "tool-1",
          output: "結果輸出",
        }),
      );
    });

    it("其他 canvas 的事件應略過", () => {
      const runStore = useRunStore();
      const toolResultSpy = vi.spyOn(runStore, "handleRunChatToolResult");

      handleRunToolResult({
        canvasId: "other-canvas",
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        output: "結果輸出",
      });

      expect(toolResultSpy).not.toHaveBeenCalled();
    });
  });
});
