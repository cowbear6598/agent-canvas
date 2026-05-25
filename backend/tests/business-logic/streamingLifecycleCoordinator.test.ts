import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatExecutionStrategy } from "../../src/services/executionStrategy.js";
import type { PersistedMessage } from "../../src/types/persistence.js";
import type { RunContext } from "../../src/types/run.js";

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getByIdGlobal: vi.fn(),
  },
}));

vi.mock("../../src/services/goalRuntime.js", () => ({
  consumeGoalRuntimeToolResult: vi.fn(),
}));

import { podStore } from "../../src/services/podStore.js";
import { consumeGoalRuntimeToolResult } from "../../src/services/goalRuntime.js";
import { createStreamingLifecycleCoordinator } from "../../src/services/claude/streamingLifecycleCoordinator.js";

function makeStrategy(
  order: string[],
  runContext?: RunContext,
): ChatExecutionStrategy {
  return {
    createEmitStrategy: vi.fn(() => ({
      emitText: ({ content }: { content: string }) => {
        order.push(`emit:text:${content}`);
      },
      emitToolUse: ({ toolName }: { toolName: string }) => {
        order.push(`emit:tool_use:${toolName}`);
      },
      emitToolResult: ({ toolUseId }: { toolUseId: string }) => {
        order.push(`emit:tool_result:${toolUseId}`);
      },
      emitComplete: ({ fullContent }: { fullContent: string }) => {
        order.push(`emit:complete:${fullContent}`);
      },
      emitSystemMessage: ({ content }: { content: string }) => {
        order.push(`emit:system:${content}`);
      },
      emitGoalRoundDivider: vi.fn(),
    })),
    persistMessage: vi.fn((_podId: string, message: PersistedMessage) => {
      order.push(`persist:${message.role}:${message.content}`);
    }),
    updateLastResponseSummary: vi.fn((_podId: string, summary: string | null) => {
      order.push(`summary:${summary ?? ""}`);
    }),
    onStreamComplete: vi.fn((_podId: string, sessionId?: string) => {
      order.push(`stream:complete:${sessionId ?? ""}`);
    }),
    onStreamAbort: vi.fn(),
    onStreamError: vi.fn(),
    getRunContext: vi.fn(() => runContext),
  } as unknown as ChatExecutionStrategy;
}

describe("StreamingLifecycleCoordinator", () => {
  beforeEach(() => {
    vi.mocked(podStore.getByIdGlobal).mockReset();
    vi.mocked(consumeGoalRuntimeToolResult).mockReset();
  });

  it("依序 dispatch 串流事件、節流持久化，並在 finalize 強制落盤", () => {
    const order: string[] = [];
    const lifecycle = createStreamingLifecycleCoordinator({
      canvasId: "canvas-1",
      podId: "pod-1",
      messageId: "message-1",
      strategy: makeStrategy(order),
      throttleMs: 0,
    });

    lifecycle.processNormalizedEvent({ type: "text", content: "A" });
    lifecycle.processNormalizedEvent({
      type: "tool_call_start",
      toolUseId: "tool-1",
      toolName: "Read",
      input: { path: "README.md" },
    });
    lifecycle.processNormalizedEvent({
      type: "tool_call_result",
      toolUseId: "tool-1",
      toolName: "Read",
      output: "ok",
    });
    lifecycle.processNormalizedEvent({ type: "turn_complete" });
    lifecycle.finalizeAfterStream();

    expect(order).toEqual([
      "emit:text:A",
      "persist:assistant:A",
      "emit:tool_use:Read",
      "persist:assistant:A",
      "emit:tool_result:tool-1",
      "persist:assistant:A",
      "emit:complete:A",
      "persist:assistant:A",
      "summary:A",
      "stream:complete:",
    ]);
  });

  it("Goal tool result 先更新 runtime，再 dispatch 給前端與 persist", () => {
    const order: string[] = [];
    const runContext: RunContext = {
      runId: "run-1",
      canvasId: "canvas-1",
      sourcePodId: "source-1",
    };
    vi.mocked(podStore.getByIdGlobal).mockReturnValue({
      pod: { id: "pod-1" },
    } as ReturnType<typeof podStore.getByIdGlobal>);
    vi.mocked(consumeGoalRuntimeToolResult).mockImplementation(() => {
      order.push("goal:consume");
    });

    const lifecycle = createStreamingLifecycleCoordinator({
      canvasId: "canvas-1",
      podId: "pod-1",
      messageId: "message-1",
      strategy: makeStrategy(order, runContext),
      throttleMs: 0,
    });

    lifecycle.processNormalizedEvent({
      type: "tool_call_result",
      toolUseId: "goal-tool",
      toolName: "mcp__goal__complete_goal_todo",
      output: "{}",
    });

    expect(order).toEqual([
      "goal:consume",
      "emit:tool_result:goal-tool",
      "persist:assistant:",
    ]);
    expect(consumeGoalRuntimeToolResult).toHaveBeenCalledWith(
      runContext,
      expect.objectContaining({ id: "pod-1" }),
      "mcp__goal__complete_goal_todo",
      "{}",
    );
  });
});
