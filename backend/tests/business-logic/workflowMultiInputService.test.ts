import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowMultiInputService } from "../../src/services/workflow/workflowMultiInputService.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { runStore } from "../../src/services/runStore.js";
import { runQueueService } from "../../src/services/workflow/runQueueService.js";
import { socketService } from "../../src/services/socketService.js";
import { logger } from "../../src/utils/logger.js";
import { resolvePendingKey } from "../../src/services/workflow/workflowHelpers.js";
import type { Connection, Pod } from "../../src/types/index.js";
import type {
  ExecutionServiceMethods,
  TriggerStrategy,
} from "../../src/services/workflow/types.js";
import type { RunContext } from "../../src/types/run.js";
import type { RunPodInstance } from "../../src/services/runStore.js";

const CANVAS_ID = "canvas-multi-input";
const TARGET_POD_ID = "target-pod";
const RUN_ID = "run-multi-input";

function makeConnection(overrides: Partial<Connection>): Connection {
  return {
    id: "conn-a",
    sourcePodId: "source-a",
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "auto",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    summaryProvider: null,
    ...overrides,
  } as Connection;
}

function makePod(id: string, name: string): Pod {
  return {
    id,
    name,
    provider: "claude",
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: `/tmp/${id}`,
    status: "idle",
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
  } as Pod;
}

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: RUN_ID,
    canvasId: CANVAS_ID,
    sourcePodId: "source-a",
    ...overrides,
  };
}

function makeRunningInstance(runContext: RunContext): RunPodInstance {
  return {
    id: "instance-target",
    runId: runContext.runId,
    podId: TARGET_POD_ID,
    status: "running",
    sessionId: null,
    errorMessage: null,
    lastResponseSummary: null,
    triggeredAt: null,
    completedAt: null,
    autoPathwaySettled: "pending",
    directPathwaySettled: "not-applicable",
    runRepoPath: null,
    workspacePath: null,
  };
}

function makeStrategy(mode: "auto" | "branch" | "direct"): TriggerStrategy {
  return {
    mode,
    decide: vi.fn(),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
  };
}

describe("WorkflowMultiInputService", () => {
  const connA = makeConnection({
    id: "conn-a",
    sourcePodId: "source-a",
    triggerMode: "auto",
  });
  const connB = makeConnection({
    id: "conn-b",
    sourcePodId: "source-b",
    triggerMode: "branch",
  });
  const groupConnections = [connA, connB];
  const runContext = makeRunContext();
  const executionService: ExecutionServiceMethods = {
    generateSummaryWithFallback: vi.fn(),
    triggerWorkflowWithSummary: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue(
      groupConnections,
    );
    vi.spyOn(podStore, "getById").mockImplementation(((_canvasId, podId) => {
      const pods: Record<string, Pod> = {
        "source-a": makePod("source-a", "來源 Pod A"),
        "source-b": makePod("source-b", "來源 Pod B"),
        [TARGET_POD_ID]: makePod(TARGET_POD_ID, "目標 Pod"),
      };
      return pods[podId];
    }) as typeof podStore.getById);
    vi.spyOn(podStore, "getByIds").mockImplementation(((_canvasId, podIds) => {
      const pods: Record<string, Pod> = {
        "source-a": makePod("source-a", "來源 Pod A"),
        "source-b": makePod("source-b", "來源 Pod B"),
        [TARGET_POD_ID]: makePod(TARGET_POD_ID, "目標 Pod"),
      };
      return new Map(
        podIds.flatMap((podId) => {
          const pod = pods[podId];
          return pod ? [[podId, pod] as const] : [];
        }),
      );
    }) as typeof podStore.getByIds);
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
    vi.spyOn(runQueueService, "enqueue").mockImplementation(() => {});
    vi.spyOn(runQueueService, "processNext").mockResolvedValue(undefined);
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});

    workflowMultiInputService.init({
      executionService,
      strategies: {
        auto: makeStrategy("auto"),
        direct: makeStrategy("direct"),
        branch: makeStrategy("branch"),
      },
    });

    vi.mocked(executionService.triggerWorkflowWithSummary).mockClear();
    pendingTargetStore.clearPendingTarget(
      resolvePendingKey(TARGET_POD_ID, runContext),
    );
  });

  afterEach(() => {
    pendingTargetStore.clearPendingTarget(
      resolvePendingKey(TARGET_POD_ID, runContext),
    );
    vi.restoreAllMocks();
  });

  it("Auto/Branch multi-input group ready 後只觸發單一 Goal round，並保留全部來源 metadata", async () => {
    await workflowMultiInputService.handleMultiInputForConnection({
      canvasId: CANVAS_ID,
      sourcePodId: "source-a",
      connection: connA,
      summary: "A 的摘要",
      triggerMode: "auto",
      runContext,
    });
    await workflowMultiInputService.handleMultiInputForConnection({
      canvasId: CANVAS_ID,
      sourcePodId: "source-b",
      connection: connB,
      summary: "B 的摘要",
      triggerMode: "branch",
      runContext,
    });
    await Promise.resolve();

    expect(executionService.triggerWorkflowWithSummary).toHaveBeenCalledTimes(
      1,
    );
    expect(executionService.triggerWorkflowWithSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        connectionId: "conn-b",
        participatingConnectionIds: ["conn-a", "conn-b"],
        sourcePodIds: ["source-a", "source-b"],
        sourcePodNames: ["來源 Pod A", "來源 Pod B"],
        runContext,
      }),
    );
  });

  it("目標 Pod 忙碌時只 enqueue 單一 multi-input item，且 queue metadata 包含全部來源 Pod", async () => {
    vi.mocked(runStore.getPodInstance).mockReturnValue(
      makeRunningInstance(runContext),
    );

    await workflowMultiInputService.handleMultiInputForConnection({
      canvasId: CANVAS_ID,
      sourcePodId: "source-a",
      connection: connA,
      summary: "A 的摘要",
      triggerMode: "auto",
      runContext,
    });
    await workflowMultiInputService.handleMultiInputForConnection({
      canvasId: CANVAS_ID,
      sourcePodId: "source-b",
      connection: connB,
      summary: "B 的摘要",
      triggerMode: "branch",
      runContext,
    });

    expect(executionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();
    expect(runQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(runQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-b",
        sourcePodId: "source-a",
        targetPodId: TARGET_POD_ID,
        triggerMode: "branch",
        participatingConnectionIds: ["conn-a", "conn-b"],
        sourcePodIds: ["source-a", "source-b"],
        sourcePodNames: ["來源 Pod A", "來源 Pod B"],
        runContext,
      }),
    );
  });
});
