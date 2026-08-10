import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/index.js";
import {
  collectCyclicPodIds,
  resolveLoopSessionContinuity,
} from "../../src/services/workflow/workflowLoopPolicy.js";
import { completeWorkflowChatStage } from "../../src/services/workflow/workflowTriggerStages.js";
import type {
  TriggerStrategy,
} from "../../src/services/workflow/types.js";
import type { WorkflowStatusDelegate } from "../../src/services/workflow/workflowStatusDelegate.js";

function makeConnection(sourcePodId: string, targetPodId: string): Connection {
  return { sourcePodId, targetPodId } as Connection;
}

function makeStrategy(): TriggerStrategy {
  return {
    mode: "auto",
    decide: vi.fn().mockResolvedValue([]),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
  };
}

function makeDelegate(): WorkflowStatusDelegate {
  return {
    isRunMode: vi.fn().mockReturnValue(true),
    startPodExecution: vi.fn(),
    markSummarizing: vi.fn(),
    markDeciding: vi.fn(),
    markWaiting: vi.fn(),
    onSummaryComplete: vi.fn(),
    onSummaryFailed: vi.fn(),
    onChatComplete: vi.fn(),
    onChatError: vi.fn(),
    shouldEnqueue: vi.fn().mockReturnValue(true),
    isBusy: vi.fn().mockReturnValue(false),
    enqueue: vi.fn(),
    scheduleNextInQueue: vi.fn(),
    settleAndSkipPath: vi.fn(),
  };
}

describe("Workflow loop execution", () => {
  it("辨識雙向循環與 self-loop，但不把一般 DAG Pod 視為循環", () => {
    const cyclicPodIds = collectCyclicPodIds(
      ["pod-a", "pod-b", "pod-c", "pod-d"],
      [
        makeConnection("pod-a", "pod-b"),
        makeConnection("pod-b", "pod-a"),
        makeConnection("pod-b", "pod-c"),
        makeConnection("pod-d", "pod-d"),
      ],
    );

    expect([...cyclicPodIds].sort()).toEqual(["pod-a", "pod-b", "pod-d"]);
  });

  it("循環 Pod 預設使用新 session，非循環 Pod 維持 resume session", () => {
    expect(resolveLoopSessionContinuity(true)).toBe("new-session");
    expect(resolveLoopSessionContinuity(false)).toBe("resume-session");
  });

  it("Direct toggle 即使由 auto strategy 執行，完成時仍結算 direct pathway", async () => {
    const strategy = makeStrategy();
    const delegate = makeDelegate();
    const checkAndTriggerWorkflows = vi.fn().mockResolvedValue(undefined);

    await completeWorkflowChatStage({
      canvasId: "canvas-1",
      connectionId: "conn-direct",
      sourcePodId: "pod-source",
      targetPodId: "pod-target",
      triggerMode: "direct",
      participatingConnectionIds: ["conn-direct"],
      strategy,
      runContext: {
        runId: "run-1",
        canvasId: "canvas-1",
        sourcePodId: "pod-source",
      },
      delegate,
      checkAndTriggerWorkflows,
    });

    expect(strategy.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ triggerMode: "direct" }),
      true,
    );
    expect(delegate.onChatComplete).toHaveBeenCalledWith(
      "canvas-1",
      "pod-target",
      "direct",
    );
    expect(checkAndTriggerWorkflows).toHaveBeenCalledOnce();
  });
});
