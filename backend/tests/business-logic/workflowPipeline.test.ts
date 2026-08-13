import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowPipeline } from "../../src/services/workflow/workflowPipeline.js";
import { podStore } from "../../src/services/podStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { configStore } from "../../src/services/configStore.js";
import { socketService } from "../../src/services/socketService.js";
import { runStore } from "../../src/services/runStore.js";
import { logger } from "../../src/utils/logger.js";
import { createStatusDelegate } from "../../src/services/workflow/workflowStatusDelegate.js";
import { runQueueService } from "../../src/services/workflow/runQueueService.js";
import { buildRunQueueKey } from "../../src/services/workflow/workflowHelpers.js";
import type {
  PipelineContext,
  TriggerStrategy,
} from "../../src/services/workflow/types.js";
import type { Connection } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";
import type { RunPodInstance } from "../../src/services/runStore.js";
import type { Pod } from "../../src/types/index.js";
import path from "path";
import { config } from "../../src/config/index.js";
import { runWorkflowSnapshotStore } from "../../src/services/workflow/runWorkflowSnapshotStore.js";

// ─── 常數（取代 TEST_IDS 工廠引用）─────────────────────────────────────────

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";
const CONNECTION_ID = "conn-1";

// ─── 工廠函式 ────────────────────────────────────────────────────────────────

function makePod(overrides?: Partial<Pod>): Pod {
  return {
    id: "test-pod",
    name: "Test Pod",
    provider: "claude" as const,
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: path.join(config.canvasRoot, CANVAS_ID, "pod-test"),
    status: "idle" as const,
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
    ...overrides,
  } as Pod;
}

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: CONNECTION_ID,
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "auto",
    summaryModel: "sonnet",
    aiDecideModel: "sonnet",
    ...overrides,
  } as Connection;
}

function makeStrategy(
  mode: "auto" | "direct" | "branch",
  overrides?: Partial<TriggerStrategy>,
): TriggerStrategy {
  const base: Partial<TriggerStrategy> = {
    mode,
    decide: vi.fn().mockResolvedValue([]),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
    ...overrides,
  };

  if (mode === "direct" && !overrides?.collectSources) {
    base.collectSources = vi.fn();
  }

  return base as TriggerStrategy;
}

// ─── テスト ──────────────────────────────────────────────────────────────────

describe("WorkflowPipeline", () => {
  const mockConnection: Connection = makeConnection({
    id: CONNECTION_ID,
    sourcePodId: SOURCE_POD_ID,
    targetPodId: TARGET_POD_ID,
    triggerMode: "auto",
  });

  // 所有測試皆在 run mode 下執行（runContext 為必填）
  const baseRunContext: RunContext = {
    runId: "base-run",
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
  };

  const baseContext: PipelineContext = {
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    connection: mockConnection,
    triggerMode: "auto",
    decideResult: { connectionId: CONNECTION_ID, approved: true, reason: null },
    runContext: baseRunContext,
    delegate: createStatusDelegate(baseRunContext),
  };

  const mockExecutionService = {
    isCyclicPod: vi.fn().mockReturnValue(false),
    generateSummaryWithFallback: vi.fn(),
    triggerWorkflowWithSummary: vi.fn(),
  };

  const mockMultiInputService = {
    handleMultiInputForConnection: vi.fn(),
  };

  const mockQueuedPodInstance = vi.fn();
  const mockHasActiveStream = vi.fn().mockReturnValue(false);

  const mockTargetPod = makePod({
    id: TARGET_POD_ID,
    name: "Target Pod",
    providerConfig: { model: "claude-sonnet-4-5-20250929" } as any,
    status: "idle" as const,
  });

  function mockSnapshotConnectionLineConfig(
    connectionLineConfig: ReturnType<
      typeof configStore.getConnectionLineModelConfig
    >,
  ): void {
    vi.mocked(runWorkflowSnapshotStore.getRequired).mockReturnValue({
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      connectionLineConfig,
      pods: new Map(),
      connections: new Map([[mockConnection.id, mockConnection]]),
    });
  }

  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});

    vi.spyOn(podStore, "getById").mockReturnValue(mockTargetPod);
    vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
      mockConnection,
    ]);
    vi.spyOn(connectionStore, "update").mockReturnValue(undefined);
    vi.spyOn(configStore, "getConnectionLineModelConfig").mockReturnValue({
      connectionLineProvider: "claude",
      connectionLineModel: "sonnet",
      connectionLineThinkingLevel: null,
    });
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    vi.spyOn(runWorkflowSnapshotStore, "getPod").mockImplementation(
      (_runId, podId) =>
        podId === TARGET_POD_ID
          ? mockTargetPod
          : makePod({ id: podId, name: "Source Pod" }),
    );
    vi.spyOn(runWorkflowSnapshotStore, "getRequired").mockReturnValue({
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      connectionLineConfig: {
        connectionLineProvider: "claude",
        connectionLineModel: "sonnet",
        connectionLineThinkingLevel: null,
      },
      pods: new Map(),
      connections: new Map([[mockConnection.id, mockConnection]]),
    });
    vi.spyOn(
      runWorkflowSnapshotStore,
      "findConnectionsByTargetPodId",
    ).mockImplementation((_runId, targetPodId) =>
      connectionStore.findByTargetPodId(CANVAS_ID, targetPodId),
    );
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: baseRunContext.runId,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "測試",
      status: "running",
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    mockExecutionService.isCyclicPod.mockReturnValue(false);
    mockQueuedPodInstance.mockClear();
    mockHasActiveStream.mockReturnValue(false);

    workflowPipeline.init({
      executionService: mockExecutionService,
      multiInputService: mockMultiInputService,
    });
    runQueueService.init({
      executionService: mockExecutionService,
      strategies: {
        auto: makeStrategy("auto"),
        direct: makeStrategy("direct"),
        branch: makeStrategy("branch"),
      },
      queuedPodInstance: mockQueuedPodInstance,
      hasActiveStream: mockHasActiveStream,
    });

    (mockExecutionService.generateSummaryWithFallback as any).mockResolvedValue(
      {
        content: "摘要",
        isSummarized: true,
      },
    );
    (mockExecutionService.triggerWorkflowWithSummary as any).mockResolvedValue(
      undefined,
    );
    (
      mockMultiInputService.handleMultiInputForConnection as any
    ).mockResolvedValue(undefined);
    mockExecutionService.generateSummaryWithFallback.mockClear();
    mockExecutionService.triggerWorkflowWithSummary.mockClear();
    mockMultiInputService.handleMultiInputForConnection.mockClear();
    const baseQueueKey = buildRunQueueKey(baseRunContext.runId, TARGET_POD_ID);
    while (runQueueService.getQueueSize(baseQueueKey) > 0) {
      runQueueService.dequeue(baseQueueKey);
    }

    (mockExecutionService.generateSummaryWithFallback as any).mockResolvedValue(
      {
        content: "摘要",
        isSummarized: true,
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("single-input workflow transfer rules", () => {
    it("ready source content is summarized and transferred to the target pod", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
        }),
      });
      const evaluateRunSpy = vi
        .spyOn(baseContext.delegate, "evaluateRun")
        .mockImplementation(() => {});

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        null,
        baseRunContext,
        "auto",
        expect.any(Object),
      );

      expect(mockStrategy.collectSources).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "摘要",
        runContext: baseRunContext,
      });
      expect(
        vi.mocked(mockExecutionService.triggerWorkflowWithSummary).mock
          .invocationCallOrder[0] ?? 0,
      ).toBeLessThan(evaluateRunSpy.mock.invocationCallOrder[0] ?? 0);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: CONNECTION_ID,
          summary: "摘要",
          isSummarized: true,
          triggerMode: "auto",
          participatingConnectionIds: undefined,
          strategy: mockStrategy,
          runContext: baseRunContext,
          delegate: expect.any(Object),
        }),
      );
    });
  });

  describe("source readiness rules", () => {
    it("workflow 執行缺少 RunContext 時不會建立 noop status delegate", () => {
      expect(() =>
        createStatusDelegate(undefined as unknown as RunContext),
      ).toThrow("Workflow 執行缺少 RunContext");
    });

    it("workflow stays paused when source collection is not ready", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: false,
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
      expect(
        runQueueService.getQueueSize(
          buildRunQueueKey(baseRunContext.runId, TARGET_POD_ID),
        ),
      ).toBe(0);
    });

    it("single-input connections can proceed without strategy-specific source collection", async () => {
      const mockStrategy = makeStrategy("auto");

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(connectionStore.findByTargetPodId).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: CONNECTION_ID,
          summary: "摘要",
          isSummarized: true,
          triggerMode: "auto",
          participatingConnectionIds: undefined,
          strategy: mockStrategy,
          runContext: baseRunContext,
          delegate: expect.any(Object),
        }),
      );
    });

    it("multi-input target waits for the other required sources instead of starting chat", async () => {
      const mockStrategy = makeStrategy("auto");

      // 兩條 auto 連線 → isMultiInput = true
      const connA = makeConnection({
        id: "conn-a",
        sourcePodId: "pod-a",
        targetPodId: TARGET_POD_ID,
        triggerMode: "auto",
      });
      const connB = makeConnection({
        id: "conn-b",
        sourcePodId: "pod-b",
        targetPodId: TARGET_POD_ID,
        triggerMode: "auto",
      });
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        connA,
        connB,
      ]);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockMultiInputService.handleMultiInputForConnection,
      ).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "摘要",
        triggerMode: "auto",
        runContext: baseRunContext,
      });

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("merged multi-source content replaces the generated summary", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: "合併內容",
          isSummarized: true,
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: CONNECTION_ID,
          summary: "合併內容",
          isSummarized: true,
          triggerMode: "auto",
          participatingConnectionIds: undefined,
          strategy: mockStrategy,
          runContext: baseRunContext,
          delegate: expect.any(Object),
        }),
      );

      const call = (mockExecutionService.triggerWorkflowWithSummary as any).mock
        .calls[0][0];
      expect(call.summary).toBe("合併內容");
      expect(call.isSummarized).toBe(true);
    });
  });

  describe("summary failure rules", () => {
    it("workflow does not start target chat when summary content is unavailable", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
        }),
      });

      (
        mockExecutionService.generateSummaryWithFallback as any
      ).mockResolvedValue(null);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
      expect(mockStrategy.collectSources).not.toHaveBeenCalled();
    });
  });

  describe("merged content defaults", () => {
    it("merged content is treated as summarized unless the strategy says otherwise", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: "合併內容但未指定 isSummarized",
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: CONNECTION_ID,
          summary: "合併內容但未指定 isSummarized",
          isSummarized: true,
          triggerMode: "auto",
          participatingConnectionIds: undefined,
          strategy: mockStrategy,
          runContext: baseRunContext,
          delegate: expect.any(Object),
        }),
      );
    });
  });

  describe("trigger mode lifecycle rules", () => {
    it("branch mode preserves its strategy lifecycle when target chat starts", async () => {
      const branchContext: PipelineContext = {
        ...baseContext,
        triggerMode: "branch",
        connection: makeConnection({
          ...mockConnection,
          triggerMode: "branch",
        }),
      };

      const mockStrategy = makeStrategy("branch", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: "合併內容",
          isSummarized: true,
        }),
      });

      await workflowPipeline.execute(branchContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: CONNECTION_ID,
          summary: "合併內容",
          isSummarized: true,
          triggerMode: "branch",
          participatingConnectionIds: undefined,
          strategy: mockStrategy,
          runContext: baseRunContext,
          delegate: expect.any(Object),
        }),
      );
    });

    it("direct mode preserves its strategy lifecycle when target chat starts", async () => {
      const directContext: PipelineContext = {
        ...baseContext,
        triggerMode: "direct",
        connection: makeConnection({
          ...mockConnection,
          triggerMode: "direct",
        }),
      };

      const mockStrategy = makeStrategy("direct", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: "合併內容",
          isSummarized: true,
        }),
      });

      await workflowPipeline.execute(directContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: CONNECTION_ID,
          summary: "合併內容",
          isSummarized: true,
          triggerMode: "direct",
          participatingConnectionIds: undefined,
          strategy: mockStrategy,
          runContext: baseRunContext,
          delegate: expect.any(Object),
        }),
      );
    });
  });

  describe("target availability rules", () => {
    it("workflow does not start when the target pod no longer exists", async () => {
      const mockStrategy = makeStrategy("auto");

      vi.mocked(runWorkflowSnapshotStore.getPod).mockReturnValueOnce(undefined);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
      expect(
        runQueueService.getQueueSize(
          buildRunQueueKey(baseRunContext.runId, TARGET_POD_ID),
        ),
      ).toBe(0);
    });
  });

  describe("run target queue FIFO rules", () => {
    function makeQueuedContext(connectionId: string): PipelineContext {
      return {
        ...baseContext,
        sourcePodId: `${SOURCE_POD_ID}-${connectionId}`,
        connection: makeConnection({
          id: connectionId,
          sourcePodId: `${SOURCE_POD_ID}-${connectionId}`,
          targetPodId: TARGET_POD_ID,
          triggerMode: "direct",
        }),
        triggerMode: "direct",
        decideResult: { connectionId, approved: true, reason: null },
        delegate: createStatusDelegate(baseRunContext),
      };
    }

    it("同一 target Pod 的第二與第三個 connection item 都會進入 FIFO 佇列", async () => {
      const mockStrategy = makeStrategy("direct", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
        }),
      });
      const hasActiveItemSpy = vi
        .spyOn(runQueueService, "hasActiveItem")
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      const enqueueSpy = vi
        .spyOn(runQueueService, "enqueue")
        .mockImplementation(() => {});
      const processNextSpy = vi
        .spyOn(runQueueService, "processNext")
        .mockResolvedValue(undefined);

      await workflowPipeline.execute(makeQueuedContext("conn-1"), mockStrategy);
      await workflowPipeline.execute(makeQueuedContext("conn-2"), mockStrategy);
      await workflowPipeline.execute(makeQueuedContext("conn-3"), mockStrategy);

      expect(hasActiveItemSpy).toHaveBeenCalledTimes(3);
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledTimes(1);
      expect(enqueueSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ connectionId: "conn-2" }),
      );
      expect(enqueueSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ connectionId: "conn-3" }),
      );
      expect(processNextSpy).toHaveBeenCalledTimes(2);
    });

    it("Direct queue item 保留每條 connection 的來源 metadata", async () => {
      const mockStrategy = makeStrategy("direct", {
        collectSources: vi.fn().mockImplementation(({ connection }: any) =>
          Promise.resolve({
            ready: true,
            participatingConnectionIds: [connection.id],
          }),
        ),
      });
      vi.spyOn(runQueueService, "hasActiveItem")
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      const enqueueSpy = vi
        .spyOn(runQueueService, "enqueue")
        .mockImplementation(() => {});
      vi.spyOn(runQueueService, "processNext").mockResolvedValue(undefined);

      await workflowPipeline.execute(makeQueuedContext("conn-1"), mockStrategy);
      await workflowPipeline.execute(makeQueuedContext("conn-2"), mockStrategy);
      await workflowPipeline.execute(makeQueuedContext("conn-3"), mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: "conn-1",
          summary: "摘要",
          isSummarized: true,
          participatingConnectionIds: ["conn-1"],
          runContext: baseRunContext,
        }),
      );
      expect(enqueueSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          connectionId: "conn-2",
          sourcePodId: "source-pod-conn-2",
          summary: "摘要",
          isSummarized: true,
          triggerMode: "direct",
          participatingConnectionIds: ["conn-2"],
          runContext: baseRunContext,
        }),
      );
      expect(enqueueSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          connectionId: "conn-3",
          sourcePodId: "source-pod-conn-3",
          summary: "摘要",
          isSummarized: true,
          triggerMode: "direct",
          participatingConnectionIds: ["conn-3"],
          runContext: baseRunContext,
        }),
      );
    });
  });

  describe("run instance triggerability rules", () => {
    const runContext: RunContext = {
      runId: "run-1",
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
    };
    const runContextPipelineBase: PipelineContext = {
      ...baseContext,
      runContext,
      delegate: createStatusDelegate(runContext),
    };

    function makeRunInstance(status: RunPodInstance["status"]): RunPodInstance {
      return {
        id: "inst-1",
        runId: "run-1",
        podId: TARGET_POD_ID,
        status,
        sessionId: null,
        errorMessage: null,
        triggeredAt: null,
        completedAt: null,
        autoPathwaySettled: "not-applicable" as const,
        directPathwaySettled: "not-applicable" as const,
        runRepoPath: null,
        workspacePath: null,
      };
    }

    it("completed target instances are not triggered again", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("completed"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).not.toHaveBeenCalled();
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("循環 target 即使上一輪為 completed 仍可重新觸發", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("completed"),
      );
      mockExecutionService.isCyclicPod.mockReturnValue(true);

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("循環 target 在 summarizing 時仍會進入後續 queue 流程", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("summarizing"),
      );
      mockExecutionService.isCyclicPod.mockReturnValue(true);

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("skipped target instances are not triggered again", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("skipped"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).not.toHaveBeenCalled();
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("循環來源後續選中的 skipped branch target 可重新觸發", async () => {
      const mockStrategy = makeStrategy("branch");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("skipped"),
      );
      mockExecutionService.isCyclicPod.mockImplementation(
        (_runContext: RunContext, podId: string) => podId === SOURCE_POD_ID,
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("errored target instances are not triggered again", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("error"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).not.toHaveBeenCalled();
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("pending target instances remain triggerable", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("pending"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("deciding target instances remain triggerable", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("deciding"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("queued target instances remain triggerable", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("queued"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("waiting target instances remain triggerable", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("waiting"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });
  });

  describe("summary unified model rules", () => {
    it("resolved summary model no longer rewrites a single connection model", async () => {
      const mockStrategy = makeStrategy("auto");
      (
        mockExecutionService.generateSummaryWithFallback as any
      ).mockResolvedValue({
        content: "摘要",
        isSummarized: true,
        resolvedModel: "gpt-5.5",
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(connectionStore.update).not.toHaveBeenCalled();
      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it("valid saved summary model is left unchanged", async () => {
      const mockStrategy = makeStrategy("auto");

      // connection.summaryModel 預設為 "sonnet"，resolvedModel 也回傳 "sonnet"
      (
        mockExecutionService.generateSummaryWithFallback as any
      ).mockResolvedValue({
        content: "摘要",
        isSummarized: true,
        resolvedModel: "sonnet",
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(connectionStore.update).not.toHaveBeenCalled();
      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it("codex source still uses the unified Connection Line model config", async () => {
      const mockStrategy = makeStrategy("auto");
      mockSnapshotConnectionLineConfig({
        connectionLineProvider: "codex",
        connectionLineModel: "gpt-5.5",
        connectionLineThinkingLevel: "medium",
      });

      // 建立 Codex 上游 Pod
      const mockCodexSourcePod = makePod({
        id: SOURCE_POD_ID,
        name: "Codex Source Pod",
        provider: "codex",
        providerConfig: { model: "gpt-5.5" } as any,
        status: "idle" as const,
      });

      // connection.summaryModel 使用 "sonnet"（不合法 for codex）
      const codexConnection = makeConnection({
        id: CONNECTION_ID,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        triggerMode: "auto",
        summaryModel: "sonnet",
      });
      const codexBaseContext: PipelineContext = {
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: codexConnection,
        triggerMode: "auto",
        decideResult: {
          connectionId: CONNECTION_ID,
          approved: true,
          reason: null,
        },
        runContext: baseRunContext,
        delegate: createStatusDelegate(baseRunContext),
      };

      // podStore.getById：source pod 回 Codex pod，target pod 回原本的 mockTargetPod
      vi.spyOn(podStore, "getById").mockImplementation(
        (_cId: string, podId: string) => {
          if (podId === SOURCE_POD_ID) return mockCodexSourcePod as any;
          return mockTargetPod as any;
        },
      );
      // connectionStore.findByTargetPodId 回一條 connection（非 multi-input）
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        codexConnection,
      ]);

      // summaryService 回傳 resolvedModel="gpt-5.5"（fallback 修正結果）
      (
        mockExecutionService.generateSummaryWithFallback as any
      ).mockResolvedValue({
        content: "codex 摘要",
        isSummarized: true,
        resolvedModel: "gpt-5.5",
      });

      await workflowPipeline.execute(codexBaseContext, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "codex",
        "gpt-5.5",
        "medium",
        baseRunContext,
        "auto",
        expect.any(Object),
      );
      expect(connectionStore.update).not.toHaveBeenCalled();
      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it("fallback summary content does not rewrite the saved model", async () => {
      const mockStrategy = makeStrategy("auto");

      // fallback 路徑：resolvedModel 未定義
      (
        mockExecutionService.generateSummaryWithFallback as any
      ).mockResolvedValue({
        content: "fallback 內容",
        isSummarized: false,
        resolvedModel: undefined,
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(connectionStore.update).not.toHaveBeenCalled();
      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // B8：Connection Line unified config 傳入 generateSummaryWithFallback
  // ----------------------------------------------------------------
  describe("summary provider selection rules", () => {
    it("summary execution ignores connection summary fields and uses unified Connection Line config", async () => {
      const mockStrategy = makeStrategy("auto");
      mockSnapshotConnectionLineConfig({
        connectionLineProvider: "claude",
        connectionLineModel: "sonnet",
        connectionLineThinkingLevel: "low",
      });

      const codexSourcePod = makePod({
        id: SOURCE_POD_ID,
        provider: "codex" as const,
        providerConfig: { model: "gpt-5.5" } as any,
      });
      const connectionWithOwnSummaryConfig = makeConnection({
        summaryProvider: "codex" as any,
        summaryModel: "gpt-5.5",
        summaryThinkingLevel: "medium",
      });
      const context: PipelineContext = {
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: connectionWithOwnSummaryConfig,
        triggerMode: "auto",
        decideResult: {
          connectionId: CONNECTION_ID,
          approved: true,
          reason: null,
        },
        runContext: baseRunContext,
        delegate: createStatusDelegate(baseRunContext),
      };

      vi.spyOn(podStore, "getById").mockImplementation(
        (_cId: string, podId: string) => {
          if (podId === SOURCE_POD_ID) return codexSourcePod as any;
          return mockTargetPod as any;
        },
      );
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        connectionWithOwnSummaryConfig,
      ]);

      await workflowPipeline.execute(context, mockStrategy);

      expect(configStore.getConnectionLineModelConfig).not.toHaveBeenCalled();
      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        "low",
        baseRunContext,
        "auto",
        expect.any(Object),
      );
    });

    it("unified Connection Line provider overrides source pod and connection summary provider", async () => {
      const mockStrategy = makeStrategy("auto");
      mockSnapshotConnectionLineConfig({
        connectionLineProvider: "codex",
        connectionLineModel: "gpt-5.5",
        connectionLineThinkingLevel: "medium",
      });

      // sourcePod 為 claude provider
      const claudeSourcePod = makePod({
        id: SOURCE_POD_ID,
        provider: "claude" as const,
        providerConfig: { model: "sonnet" } as any,
      });
      // connection 明確指定 summaryProvider=codex（cross-provider）
      const codexSummaryConnection = makeConnection({
        summaryProvider: "codex" as any, // 明確指定 codex provider 做摘要
        summaryModel: "gpt-5.5",
      });
      const codexSummaryContext: PipelineContext = {
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: codexSummaryConnection,
        triggerMode: "auto",
        decideResult: {
          connectionId: CONNECTION_ID,
          approved: true,
          reason: null,
        },
        runContext: baseRunContext,
        delegate: createStatusDelegate(baseRunContext),
      };

      vi.spyOn(podStore, "getById").mockImplementation(
        (_cId: string, podId: string) => {
          if (podId === SOURCE_POD_ID) return claudeSourcePod as any;
          return mockTargetPod as any;
        },
      );
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        codexSummaryConnection,
      ]);

      await workflowPipeline.execute(codexSummaryContext, mockStrategy);

      // 驗證 provider/model 參數來自 Connection Line 統一設定。
      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "codex",
        "gpt-5.5",
        "medium",
        baseRunContext,
        expect.any(String), // pathway
        expect.any(Object), // delegate
      );
    });
  });
});
