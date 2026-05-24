import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { createChatEmitStrategy } from "../../src/services/chatEmitStrategy.js";
import { socketService } from "../../src/services/socketService.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";

interface CapturedCanvasEvent {
  canvasId: string;
  eventName: string;
  payload: Record<string, unknown>;
}

describe("chat message merge business logic", () => {
  const canvasId = "test-canvas";
  const podId = "test-pod";
  const messageId = "msg-001";
  const runId = "test-run";
  const capturedEvents: CapturedCanvasEvent[] = [];

  beforeEach(() => {
    capturedEvents.length = 0;
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(
      (targetCanvasId, eventName, payload) => {
        capturedEvents.push({
          canvasId: targetCanvasId,
          eventName,
          payload: payload as Record<string, unknown>,
        });
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assistant text chunks are exposed as partial run messages scoped to the run", () => {
    const strategy = createChatEmitStrategy(runId);

    strategy.emitText({
      canvasId,
      podId,
      messageId,
      content: "Run 訊息",
      delta: "訊息",
    });

    expect(capturedEvents).toEqual([
      {
        canvasId,
        eventName: WebSocketResponseEvents.RUN_MESSAGE,
        payload: {
          runId,
          canvasId,
          podId,
          messageId,
          content: "Run 訊息",
          delta: "訊息",
          isPartial: true,
          role: "assistant",
        },
      },
    ]);
  });

  it("tool use and tool result events keep the same run, pod, message, and tool identity", () => {
    const strategy = createChatEmitStrategy(runId);

    strategy.emitToolUse({
      canvasId,
      podId,
      messageId,
      toolUseId: "tool-run-1",
      toolName: "Write",
      input: { content: "test" },
    });
    strategy.emitToolResult({
      canvasId,
      podId,
      messageId,
      toolUseId: "tool-run-1",
      toolName: "Write",
      output: "成功寫入",
    });

    expect(capturedEvents).toEqual([
      {
        canvasId,
        eventName: WebSocketResponseEvents.RUN_CHAT_TOOL_USE,
        payload: expect.objectContaining({
          runId,
          canvasId,
          podId,
          messageId,
          toolUseId: "tool-run-1",
          toolName: "Write",
          input: { content: "test" },
        }),
      },
      {
        canvasId,
        eventName: WebSocketResponseEvents.RUN_CHAT_TOOL_RESULT,
        payload: expect.objectContaining({
          runId,
          canvasId,
          podId,
          messageId,
          toolUseId: "tool-run-1",
          toolName: "Write",
          output: "成功寫入",
        }),
      },
    ]);
  });

  it("business rule: completion event carries the final merged assistant content for the same run message", () => {
    const strategy = createChatEmitStrategy(runId);

    strategy.emitText({
      canvasId,
      podId,
      messageId,
      content: "Run ",
      delta: "Run ",
    });
    strategy.emitText({
      canvasId,
      podId,
      messageId,
      content: "Run 完整內容",
      delta: "完整內容",
    });
    strategy.emitComplete({
      canvasId,
      podId,
      messageId,
      fullContent: "Run 完整內容",
    });

    expect(capturedEvents.at(-1)).toEqual({
      canvasId,
      eventName: WebSocketResponseEvents.RUN_CHAT_COMPLETE,
      payload: {
        runId,
        canvasId,
        podId,
        messageId,
        fullContent: "Run 完整內容",
      },
    });
    expect(
      capturedEvents
        .filter((event) => event.eventName === WebSocketResponseEvents.RUN_MESSAGE)
        .map((event) => event.payload.delta)
        .join(""),
    ).toBe("Run 完整內容");
  });

  it("goal round divider event carries run-scoped source and connection metadata", () => {
    const strategy = createChatEmitStrategy(runId);

    strategy.emitGoalRoundDivider({
      canvasId,
      divider: {
        type: "goal-round-divider",
        id: "divider-1",
        runId,
        podId,
        sourcePodIds: ["source-1"],
        sourcePodNames: ["來源 Pod"],
        status: "completed",
        blockedReason: null,
        completedAt: "2026-05-24T10:00:00.000Z",
        connectionIds: ["conn-1"],
      },
    });

    expect(capturedEvents).toEqual([
      {
        canvasId,
        eventName: WebSocketResponseEvents.RUN_GOAL_ROUND_DIVIDER,
        payload: {
          type: "goal-round-divider",
          id: "divider-1",
          runId,
          canvasId,
          podId,
          sourcePodIds: ["source-1"],
          sourcePodNames: ["來源 Pod"],
          status: "completed",
          blockedReason: null,
          completedAt: "2026-05-24T10:00:00.000Z",
          connectionIds: ["conn-1"],
        },
      },
    ]);
  });
});
