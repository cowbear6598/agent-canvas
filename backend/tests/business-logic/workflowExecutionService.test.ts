import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowExecutionService } from "../../src/services/workflow";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { runStore } from "../../src/services/runStore.js";
import { summaryService } from "../../src/services/summaryService.js";
import { workflowEventEmitter } from "../../src/services/workflow";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { logger } from "../../src/utils/logger.js";
import * as streamingChatExecutor from "../../src/services/claude/streamingChatExecutor.js";
import type { Connection } from "../../src/types";
import type { TriggerStrategy } from "../../src/services/workflow/types.js";
import type { RunContext } from "../../src/types/run.js";
import path from "path";
import { config } from "../../src/config/index.js";
import * as runChatHelpers from "../../src/utils/runChatHelpers.js";

// ─── 常數 ────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";

// ─── 工廠函式 ─────────────────────────────────────────────────────────────────

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-1",
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "auto",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    label: "Checklist",
    description: undefined,
    branchProvider: "claude",
    branchModel: "sonnet",
    ...overrides,
  } as Connection;
}

function makePod(id: string, status: "idle" | "chatting" = "idle") {
  return {
    id,
    name: `Pod ${id}`,
    provider: "claude" as const,
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: path.join(config.canvasRoot, CANVAS_ID, `pod-${id}`),
    status,
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
  };
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

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "run-1",
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    ...overrides,
  };
}

// ─── 共用 spy setup ───────────────────────────────────────────────────────────

function setupBasicSpies() {
  vi.spyOn(logger, "log").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
  vi.spyOn(summaryService, "generateSummaryForTarget").mockResolvedValue({
    success: true,
    summary: "Test summary",
    targetPodId: TARGET_POD_ID,
  });
  vi.spyOn(runStore, "getRun").mockImplementation(((runId: string) => ({
    id: runId,
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    triggerMessage: "測試",
    status: "running",
    createdAt: new Date().toISOString(),
    completedAt: null,
  })) as typeof runStore.getRun);
  vi.spyOn(workflowExecutionService, "isCyclicPod").mockReturnValue(false);
  vi.spyOn(runChatHelpers, "injectRunUserMessage").mockResolvedValue(undefined);
  vi.spyOn(podStore, "getById").mockImplementation(((
    _cId: string,
    podId: string,
  ) => {
    if (podId === SOURCE_POD_ID) return makePod(SOURCE_POD_ID);
    return makePod(podId);
  }) as any);
  vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
  vi.spyOn(connectionStore, "getById").mockReturnValue(undefined);
  vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);
  vi.spyOn(connectionStore, "updateConnectionStatus").mockReturnValue(
    undefined,
  );
  vi.spyOn(connectionStore, "updateDecideStatus").mockReturnValue(undefined);
  vi.spyOn(workflowEventEmitter, "emitWorkflowQueued").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowComplete").mockImplementation(
    () => {},
  );
  vi.spyOn(
    workflowEventEmitter,
    "emitWorkflowAutoTriggered",
  ).mockImplementation(() => {});
  vi.spyOn(workflowEventEmitter, "emitBranchTriggered").mockImplementation(
    () => {},
  );
}

// ─── 測試 ─────────────────────────────────────────────────────────────────────

describe("WorkflowExecutionService", () => {
  beforeEach(() => {
    setupBasicSpies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // triggerWorkflowWithSummary - run mode business rules
  // ============================================================
  describe("triggerWorkflowWithSummary - run mode business rules", () => {
    it("run mode uses connection templates without mutating global active state", async () => {
      const runContext = makeRunContext();
      const autoConn = makeConnection({
        id: "conn-auto-1",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext,
        skipBusyCheck: true,
      });

      // run mode：connection 是模板，不應設為 active
      const activeCalls = (
        connectionStore.updateConnectionStatus as any
      ).mock.calls.filter((call: any[]) => call[2] === "active");
      expect(activeCalls).toHaveLength(0);
      expect(mockStrategy.onTrigger).toHaveBeenCalled();
    });

    it("run mode 啟動查詢時只標記 pod 執行中，active stream 由 streaming strategy 管理", async () => {
      const runContext = makeRunContext();
      const autoConn = makeConnection({
        id: "conn-auto-active-stream",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");
      const registerActiveStreamSpy = vi
        .spyOn(runExecutionService, "registerActiveStream")
        .mockImplementation(() => {});
      vi.spyOn(streamingChatExecutor, "executeStreamingChat").mockResolvedValue({
        messageId: "message-1",
        content: "完成",
        hasContent: true,
        aborted: false,
      });
      const delegate = {
        isRunMode: vi.fn().mockReturnValue(true),
        startPodExecution: vi.fn(),
        markSummarizing: vi.fn(),
        markDeciding: vi.fn(),
        markWaiting: vi.fn(),
        onSummaryComplete: vi.fn(),
        onSummaryFailed: vi.fn(),
        onChatComplete: vi.fn(),
        onChatError: vi.fn(),
        evaluateRun: vi.fn(),
        shouldEnqueue: vi.fn().mockReturnValue(true),
        isBusy: vi.fn().mockReturnValue(false),
        enqueue: vi.fn(),
        scheduleNextInQueue: vi.fn(),
        settleAndSkipPath: vi.fn(),
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext,
        delegate,
        skipBusyCheck: true,
      });

      expect(delegate.startPodExecution).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
      );
      expect(registerActiveStreamSpy).not.toHaveBeenCalled();
    });

    it("run mode 目標 pod 已為 blocked 終態時，不應重新觸發 workflow", async () => {
      const runContext = makeRunContext({ runId: "run-blocked-terminal" });
      const autoConn = makeConnection({
        id: "conn-auto-blocked-terminal",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");
      const delegate = {
        isRunMode: vi.fn().mockReturnValue(true),
        startPodExecution: vi.fn(),
        markSummarizing: vi.fn(),
        markDeciding: vi.fn(),
        markWaiting: vi.fn(),
        onSummaryComplete: vi.fn(),
        onSummaryFailed: vi.fn(),
        onChatComplete: vi.fn(),
        onChatError: vi.fn(),
        evaluateRun: vi.fn(),
        shouldEnqueue: vi.fn().mockReturnValue(true),
        isBusy: vi.fn().mockReturnValue(false),
        enqueue: vi.fn(),
        scheduleNextInQueue: vi.fn(),
        settleAndSkipPath: vi.fn(),
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);
      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        id: "instance-blocked",
        runId: runContext.runId,
        podId: TARGET_POD_ID,
        status: "blocked",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      } as any);
      const executeStreamingChatSpy = vi.spyOn(
        streamingChatExecutor,
        "executeStreamingChat",
      );

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext,
        delegate,
        skipBusyCheck: true,
      });

      expect(delegate.startPodExecution).not.toHaveBeenCalled();
      expect(mockStrategy.onTrigger).not.toHaveBeenCalled();
      expect(executeStreamingChatSpy).not.toHaveBeenCalled();
    });

    it("stream 完成後排程下一筆佇列時不應殘留 active stream", async () => {
      const runContext = makeRunContext({
        runId: "run-active-stream-release",
      });
      const autoConn = makeConnection({
        id: "conn-auto-release-before-queue",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");
      const delegate = {
        isRunMode: vi.fn().mockReturnValue(true),
        startPodExecution: vi.fn(),
        markSummarizing: vi.fn(),
        markDeciding: vi.fn(),
        markWaiting: vi.fn(),
        onSummaryComplete: vi.fn(),
        onSummaryFailed: vi.fn(),
        onChatComplete: vi.fn(),
        onChatError: vi.fn(),
        evaluateRun: vi.fn(),
        shouldEnqueue: vi.fn().mockReturnValue(true),
        isBusy: vi.fn().mockReturnValue(false),
        enqueue: vi.fn(),
        scheduleNextInQueue: vi.fn(() => {
          expect(
            runExecutionService.hasActiveStream(
              runContext.runId,
              TARGET_POD_ID,
            ),
          ).toBe(false);
        }),
        settleAndSkipPath: vi.fn(),
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);
      vi.spyOn(streamingChatExecutor, "executeStreamingChat").mockImplementation(
        async (options, callbacks) => {
          options.strategy.onStreamStart(TARGET_POD_ID);
          options.strategy.onStreamComplete(TARGET_POD_ID, undefined);
          await callbacks?.onComplete?.(CANVAS_ID, TARGET_POD_ID);
          return {
            messageId: "message-1",
            content: "完成",
            hasContent: true,
            aborted: false,
          };
        },
      );

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext,
        delegate,
        skipBusyCheck: true,
      });

      await vi.waitFor(() => {
        expect(delegate.scheduleNextInQueue).toHaveBeenCalledWith(
          CANVAS_ID,
          TARGET_POD_ID,
        );
      });
    });

    it("run mode 真正啟動前若目標 Pod 已忙碌，應改加入佇列避免同 key 查詢互相 abort", async () => {
      const runContext = makeRunContext();
      const autoConn = makeConnection({
        id: "conn-auto-busy-guard",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");
      const registerActiveStreamSpy = vi
        .spyOn(runExecutionService, "registerActiveStream")
        .mockImplementation(() => {});
      const executeStreamingChatSpy = vi
        .spyOn(streamingChatExecutor, "executeStreamingChat")
        .mockResolvedValue({
          messageId: "message-1",
          content: "完成",
          hasContent: true,
          aborted: false,
        });
      const delegate = {
        isRunMode: vi.fn().mockReturnValue(true),
        startPodExecution: vi.fn(),
        markSummarizing: vi.fn(),
        markDeciding: vi.fn(),
        markWaiting: vi.fn(),
        onSummaryComplete: vi.fn(),
        onSummaryFailed: vi.fn(),
        onChatComplete: vi.fn(),
        onChatError: vi.fn(),
        evaluateRun: vi.fn(),
        shouldEnqueue: vi.fn().mockReturnValue(true),
        isBusy: vi.fn().mockReturnValue(true),
        enqueue: vi.fn(),
        scheduleNextInQueue: vi.fn(),
        settleAndSkipPath: vi.fn(),
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext,
        delegate,
      });

      expect(delegate.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: autoConn.id,
          targetPodId: TARGET_POD_ID,
          summary: "Test summary",
          triggerMode: "auto",
          runContext,
        }),
      );
      expect(delegate.scheduleNextInQueue).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
      );
      expect(registerActiveStreamSpy).not.toHaveBeenCalled();
      expect(executeStreamingChatSpy).not.toHaveBeenCalled();
    });

    it("run queue dispatch 時可略過 busy guard，避免 dequeue 出來的 item 被自己的 processing key 重排", async () => {
      const runContext = makeRunContext();
      const autoConn = makeConnection({
        id: "conn-auto-skip-busy",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");
      const executeStreamingChatSpy = vi
        .spyOn(streamingChatExecutor, "executeStreamingChat")
        .mockResolvedValue({
          messageId: "message-1",
          content: "完成",
          hasContent: true,
          aborted: false,
        });
      const delegate = {
        isRunMode: vi.fn().mockReturnValue(true),
        startPodExecution: vi.fn(),
        markSummarizing: vi.fn(),
        markDeciding: vi.fn(),
        markWaiting: vi.fn(),
        onSummaryComplete: vi.fn(),
        onSummaryFailed: vi.fn(),
        onChatComplete: vi.fn(),
        onChatError: vi.fn(),
        evaluateRun: vi.fn(),
        shouldEnqueue: vi.fn().mockReturnValue(true),
        isBusy: vi.fn().mockReturnValue(true),
        enqueue: vi.fn(),
        scheduleNextInQueue: vi.fn(),
        settleAndSkipPath: vi.fn(),
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext,
        delegate,
        skipBusyCheck: true,
      });

      expect(delegate.enqueue).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(executeStreamingChatSpy).toHaveBeenCalled());
    });

    it("run mode 應把來源 metadata 傳入 goalRoundDivider context", async () => {
      const runContext = makeRunContext();
      const autoConn = makeConnection({
        id: "conn-auto-goal-divider",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");
      const executeStreamingChatSpy = vi
        .spyOn(streamingChatExecutor, "executeStreamingChat")
        .mockResolvedValue({
          messageId: "message-1",
          content: "完成",
          hasContent: true,
          aborted: false,
        });

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: ["conn-a", "conn-b"],
        sourcePodIds: ["source-a", "source-b"],
        sourcePodNames: ["Source A", "Source B"],
        strategy: mockStrategy,
        runContext,
        skipBusyCheck: true,
      });
      await vi.waitFor(() => expect(executeStreamingChatSpy).toHaveBeenCalled());

      expect(executeStreamingChatSpy.mock.calls[0]?.[0]).toMatchObject({
        goalRoundDivider: {
          sourcePodIds: ["source-a", "source-b"],
          sourcePodNames: ["Source A", "Source B"],
          connectionIds: ["conn-a", "conn-b"],
        },
      });
    });

    it("run mode 缺 sourcePodNames 時應 fallback 為來源 Pod 名稱", async () => {
      const runContext = makeRunContext();
      const autoConn = makeConnection({
        id: "conn-auto-goal-divider-fallback",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");
      const executeStreamingChatSpy = vi
        .spyOn(streamingChatExecutor, "executeStreamingChat")
        .mockResolvedValue({
          messageId: "message-1",
          content: "完成",
          hasContent: true,
          aborted: false,
        });

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: ["conn-a"],
        sourcePodIds: ["source-a"],
        strategy: mockStrategy,
        runContext,
        skipBusyCheck: true,
      });
      await vi.waitFor(() => expect(executeStreamingChatSpy).toHaveBeenCalled());

      expect(executeStreamingChatSpy.mock.calls[0]?.[0]).toMatchObject({
        goalRoundDivider: {
          sourcePodIds: ["source-a"],
          sourcePodNames: ["Pod source-pod"],
          connectionIds: ["conn-a"],
        },
      });
    });

    it("missing connection is ignored so deleted workflow edges do not start chats", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(connectionStore, "getById").mockReturnValue(undefined);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: "non-existent",
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext: makeRunContext(),
      });

      expect(mockStrategy.onTrigger).not.toHaveBeenCalled();
    });
  });
});

// ─── generateSummaryWithFallback runContext 狀態管理 ─────────────────────────

describe("WorkflowExecutionService.generateSummaryWithFallback runContext 狀態管理", () => {
  const mockRunContext = makeRunContext();

  const mockAutoTriggerServiceForFallback = {
    processAutoTriggerConnection: vi.fn(),
    getLastAssistantMessage: vi.fn(),
    init: vi.fn(),
  };

  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(podStore, "getById").mockReturnValue(makePod(SOURCE_POD_ID));
    vi.spyOn(runExecutionService, "summarizingPodInstance").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "settlePodTrigger").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "errorPodInstance").mockImplementation(
      () => {},
    );

    workflowExecutionService.init({
      pipeline: { execute: vi.fn().mockResolvedValue(undefined) } as any,
      branchTriggerService: { processBranchConnections: vi.fn() } as any,
      autoTriggerService: mockAutoTriggerServiceForFallback as any,
      directTriggerService: makeStrategy("direct"),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      label: "summary success settles the source pathway",
      summaryResult: { success: true, summary: "摘要內容" },
      fallback: null,
      pathway: "auto" as const,
      expectSettle: true,
      expectError: false,
      expectNull: false,
    },
    {
      label: "summary provider failure falls back to the last assistant message",
      summaryResult: { success: false, summary: "", error: "摘要失敗" },
      fallback: "fallback 內容",
      pathway: "direct" as const,
      expectSettle: true,
      expectError: false,
      expectNull: false,
    },
  ])(
    "$label",
    async ({ summaryResult, fallback, pathway, expectSettle, expectError }) => {
      vi.spyOn(summaryService, "generateSummaryForTarget").mockResolvedValue(
        summaryResult as any,
      );
      (
        mockAutoTriggerServiceForFallback.getLastAssistantMessage as any
      ).mockReturnValue(fallback);

      await workflowExecutionService.generateSummaryWithFallback(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        null,
        mockRunContext,
        pathway,
      );

      expect(runExecutionService.summarizingPodInstance).toHaveBeenCalledWith(
        mockRunContext,
        SOURCE_POD_ID,
      );
      if (expectSettle) {
        expect(runExecutionService.settlePodTrigger).toHaveBeenCalledWith(
          mockRunContext,
          SOURCE_POD_ID,
          pathway,
          { evaluateRun: false },
        );
      }
      if (expectError) {
        expect(runExecutionService.errorPodInstance).toHaveBeenCalled();
      } else {
        expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
      }
    },
  );

  it("summary failure without fallback marks the source pod as errored", async () => {
    vi.spyOn(summaryService, "generateSummaryForTarget").mockResolvedValue({
      success: false,
      summary: "",
      error: "摘要失敗",
    } as any);
    (
      mockAutoTriggerServiceForFallback.getLastAssistantMessage as any
    ).mockReturnValue(null);

    const result = await workflowExecutionService.generateSummaryWithFallback(
      CANVAS_ID,
      SOURCE_POD_ID,
      TARGET_POD_ID,
      "claude",
      "sonnet",
      null,
      mockRunContext,
    );

    expect(result).toBeNull();
    expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
      mockRunContext,
      SOURCE_POD_ID,
      "無法生成摘要",
    );
    expect(runExecutionService.settlePodTrigger).not.toHaveBeenCalled();
  });
});
