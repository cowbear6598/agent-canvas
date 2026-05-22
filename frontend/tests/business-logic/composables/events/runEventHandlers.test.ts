import { describe, expect, it, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { webSocketMockFactory } from "@tests/helpers/mockWebSocket";
import { useCanvasStore } from "@/stores/canvasStore";
import { useRunStore } from "@/stores/run/runStore";
import {
  getRunEventListeners,
  handleRunChatComplete,
  handleRunMessage,
  handleRunToolResult,
  handleRunToolUse,
} from "@/composables/eventHandlers/runEventHandlers";
import { WebSocketResponseEvents } from "@/services/websocket";

vi.mock("@/services/websocket", () => webSocketMockFactory());

describe("runEventHandlers", () => {
  setupStoreTest();

  it("未開啟的 run chat 不應持續累積 transcript", () => {
    const canvasStore = useCanvasStore();
    const runStore = useRunStore();
    canvasStore.activeCanvasId = "canvas-1";

    handleRunMessage({
      canvasId: "canvas-1",
      runId: "run-2",
      podId: "pod-2",
      messageId: "msg-1",
      content: "ignored",
      isPartial: true,
      role: "assistant",
    });

    handleRunToolUse({
      canvasId: "canvas-1",
      runId: "run-2",
      podId: "pod-2",
      messageId: "msg-1",
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
    });

    handleRunToolResult({
      canvasId: "canvas-1",
      runId: "run-2",
      podId: "pod-2",
      messageId: "msg-1",
      toolUseId: "tool-1",
      toolName: "Bash",
      output: "ignored",
    });

    handleRunChatComplete({
      canvasId: "canvas-1",
      runId: "run-2",
      podId: "pod-2",
      messageId: "msg-1",
      fullContent: "ignored",
    });

    expect(runStore.runChatMessages.size).toBe(0);
  });

  it("目前開啟的 run chat 仍應收到即時串流與 tool 事件", () => {
    const canvasStore = useCanvasStore();
    const runStore = useRunStore();
    canvasStore.activeCanvasId = "canvas-1";
    runStore.activeRunChatModal = { runId: "run-1", podId: "pod-1" };

    handleRunMessage({
      canvasId: "canvas-1",
      runId: "run-1",
      podId: "pod-1",
      messageId: "msg-1",
      content: "Hello",
      isPartial: true,
      role: "assistant",
    });

    handleRunToolUse({
      canvasId: "canvas-1",
      runId: "run-1",
      podId: "pod-1",
      messageId: "msg-1",
      toolUseId: "tool-1",
      toolName: "Bash",
      input: { command: "ls" },
    });

    handleRunToolResult({
      canvasId: "canvas-1",
      runId: "run-1",
      podId: "pod-1",
      messageId: "msg-1",
      toolUseId: "tool-1",
      toolName: "Bash",
      output: "file-a",
    });

    handleRunChatComplete({
      canvasId: "canvas-1",
      runId: "run-1",
      podId: "pod-1",
      messageId: "msg-1",
      fullContent: "Hello",
    });

    const messages = runStore.runChatMessages.get("run-1")?.get("pod-1");
    expect(messages).toHaveLength(1);
    expect(messages?.[0]?.content).toBe("Hello");
    expect(messages?.[0]?.toolUse?.[0]).toMatchObject({
      toolUseId: "tool-1",
      toolName: "Bash",
      output: "file-a",
      status: "completed",
    });
  });

  it("RUN_DELETED 錯誤回應不應誤刪本地 run", () => {
    const canvasStore = useCanvasStore();
    const runStore = useRunStore();
    canvasStore.activeCanvasId = "canvas-1";
    runStore.runsById.set("run-1", {
      id: "run-1",
      canvasId: "canvas-1",
      sourcePodId: "pod-1",
      sourcePodName: "Pod 1",
      triggerMessage: "Hello",
      status: "completed",
      podInstances: [],
      createdAt: new Date().toISOString(),
    });

    const deleteHandler = getRunEventListeners().find(
      (listener) => listener.event === WebSocketResponseEvents.RUN_DELETED,
    )?.handler;

    deleteHandler?.({
      canvasId: "canvas-1",
      requestId: "req-1",
      success: false,
      error: "delete failed",
    });

    expect(runStore.runsById.has("run-1")).toBe(true);
  });
});
