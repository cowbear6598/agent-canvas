import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowPipeline } from "../../src/services/workflow/workflowPipeline.js";
import { podStore } from "../../src/services/podStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { socketService } from "../../src/services/socketService.js";
import { runStore } from "../../src/services/runStore.js";
import { logger } from "../../src/utils/logger.js";
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
    commandId: null,
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
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    aiDecideModel: "sonnet",
    ...overrides,
  } as Connection;
}

function makeStrategy(
  mode: "auto" | "direct" | "ai-decide",
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

  const baseContext: PipelineContext = {
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    connection: mockConnection,
    triggerMode: "auto",
    decideResult: { connectionId: CONNECTION_ID, approved: true, reason: null },
  };

  const mockExecutionService = {
    generateSummaryWithFallback: vi.fn(),
    triggerWorkflowWithSummary: vi.fn(),
  };

  const mockMultiInputService = {
    handleMultiInputForConnection: vi.fn(),
  };

  const mockQueueService = {
    enqueue: vi.fn(),
    processNextInQueue: vi.fn().mockResolvedValue(undefined),
  };

  const mockTargetPod = makePod({
    id: TARGET_POD_ID,
    name: "Target Pod",
    providerConfig: { model: "claude-sonnet-4-5-20250929" } as any,
    status: "idle" as const,
  });

  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});

    vi.spyOn(podStore, "getById").mockReturnValue(mockTargetPod);
    vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
      mockConnection,
    ]);
    vi.spyOn(connectionStore, "update").mockReturnValue(undefined);
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

    workflowPipeline.init({
      executionService: mockExecutionService,
      multiInputService: mockMultiInputService,
      queueService: mockQueueService,
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
    (mockQueueService.processNextInQueue as any).mockResolvedValue(undefined);
    mockExecutionService.generateSummaryWithFallback.mockClear();
    mockExecutionService.triggerWorkflowWithSummary.mockClear();
    mockMultiInputService.handleMultiInputForConnection.mockClear();
    mockQueueService.enqueue.mockClear();
    mockQueueService.processNextInQueue.mockClear();

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

  describe("Pipeline 完整流程", () => {
    it("有 collectSources 的 strategy 時，完整執行 pipeline", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        undefined,
        "auto",
        undefined,
      );

      expect(mockStrategy.collectSources).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "摘要",
      });

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: CONNECTION_ID,
        summary: "摘要",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
        runContext: undefined,
        delegate: undefined,
      });
    });
  });

  describe("collectSources 階段", () => {
    it("collectSources 回傳 ready=false 時暫停", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: false,
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
      expect(mockQueueService.enqueue).not.toHaveBeenCalled();
    });

    it("使用預設 collectSources 邏輯（strategy 沒有 collectSources）", async () => {
      const mockStrategy = makeStrategy("auto");

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(connectionStore.findByTargetPodId).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: CONNECTION_ID,
        summary: "摘要",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });

    it("多輸入情境正確委派", async () => {
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
        runContext: undefined,
      });

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("collectSources 提供 mergedContent 時使用該內容", async () => {
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
      ).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: CONNECTION_ID,
        summary: "合併內容",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });

      const call = (mockExecutionService.triggerWorkflowWithSummary as any).mock
        .calls[0][0];
      expect(call.summary).toBe("合併內容");
      expect(call.isSummarized).toBe(true);
    });
  });

  describe("checkQueue 階段", () => {
    it("目標 Pod 忙碌時加入佇列", async () => {
      const mockStrategy = makeStrategy("auto");

      vi.spyOn(podStore, "getById").mockReturnValue({
        ...mockTargetPod,
        status: "chatting",
      } as any);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockQueueService.enqueue).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: CONNECTION_ID,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        summary: "摘要",
        isSummarized: true,
        triggerMode: "auto",
        participatingConnectionIds: undefined,
        runContext: undefined,
      });

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("目標 Pod 忙碌時 enqueue 後立即呼叫一次 processNextInQueue", async () => {
      const mockStrategy = makeStrategy("auto");

      vi.spyOn(podStore, "getById").mockReturnValue({
        ...mockTargetPod,
        status: "chatting",
      } as any);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockQueueService.enqueue).toHaveBeenCalled();
      expect(mockQueueService.processNextInQueue).toHaveBeenCalledTimes(1);
      expect(mockQueueService.processNextInQueue).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
      );
    });
  });

  describe("generateSummary 階段", () => {
    it("generateSummary 失敗時不繼續流程", async () => {
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

  describe("collectSources 與 mergedContent 的完整流程", () => {
    it("collectSources 回傳 mergedContent 且 isSummarized 未設定時預設為 true", async () => {
      const mockStrategy = makeStrategy("auto", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: "合併內容但未指定 isSummarized",
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: CONNECTION_ID,
        summary: "合併內容但未指定 isSummarized",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });
  });

  describe("trigger 階段傳遞 strategy", () => {
    it("ai-decide mode 時傳遞 strategy 給 triggerWorkflowWithSummary", async () => {
      const aiDecideContext: PipelineContext = {
        ...baseContext,
        triggerMode: "ai-decide",
        connection: makeConnection({
          ...mockConnection,
          triggerMode: "ai-decide",
        }),
      };

      const mockStrategy = makeStrategy("ai-decide", {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: "合併內容",
          isSummarized: true,
        }),
      });

      await workflowPipeline.execute(aiDecideContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: CONNECTION_ID,
        summary: "合併內容",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });

    it("direct mode 時傳遞 strategy 給 triggerWorkflowWithSummary", async () => {
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
      ).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: CONNECTION_ID,
        summary: "合併內容",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });
  });

  describe("目標 Pod 不存在時的處理", () => {
    it("找不到目標 Pod 時不觸發 workflow", async () => {
      const mockStrategy = makeStrategy("auto");

      vi.spyOn(podStore, "getById").mockReturnValue(null as any);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
      expect(mockQueueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("Run 模式 skipped guard", () => {
    const runContext: RunContext = {
      runId: "run-1",
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
    };
    const runContextPipelineBase: PipelineContext = {
      ...baseContext,
      runContext,
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
      };
    }

    it("target instance 為 completed 時應 early return，不繼續觸發", async () => {
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

    it("target instance 為 skipped 時應 early return，不繼續觸發", async () => {
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

    it("target instance 為 error 時應 early return，不繼續觸發", async () => {
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

    it("target instance 為 pending 時應繼續執行", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("pending"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("target instance 為 deciding 時應繼續執行", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("deciding"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("target instance 為 queued 時應繼續執行（不 early return）", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("queued"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("target instance 為 waiting 時應繼續執行（不 early return）", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        makeRunInstance("waiting"),
      );

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });

    it("非 run 模式（無 runContext）時不觸發 guard，照常執行", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalled();
    });
  });

  describe("lazy 修正 summaryModel", () => {
    it("resolvedModel 與 connection.summaryModel 不同時，應寫回並廣播", async () => {
      const mockStrategy = makeStrategy("auto");
      const updatedConnection = makeConnection({
        id: CONNECTION_ID,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        triggerMode: "auto",
        summaryModel: "gpt-5.4",
      });

      // 模擬 disposableChatService fallback 到 gpt-5.4
      (
        mockExecutionService.generateSummaryWithFallback as any
      ).mockResolvedValue({
        content: "摘要",
        isSummarized: true,
        resolvedModel: "gpt-5.4",
      });

      vi.spyOn(connectionStore, "update").mockReturnValue(updatedConnection);

      await workflowPipeline.execute(baseContext, mockStrategy);

      // 應呼叫 connectionStore.update 寫回合法 model
      expect(connectionStore.update).toHaveBeenCalledWith(
        CANVAS_ID,
        CONNECTION_ID,
        { summaryModel: "gpt-5.4" },
      );

      // 應廣播 CONNECTION_UPDATED 事件
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.stringContaining("connection:updated"),
        expect.objectContaining({
          canvasId: CANVAS_ID,
          success: true,
          connection: updatedConnection,
        }),
      );
    });

    it("resolvedModel 與 connection.summaryModel 相同時，不應觸發寫回", async () => {
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

    it("上游 Pod 為 Codex、summaryModel=sonnet（不合法）→ lazy 修正為 gpt-5.4 並廣播", async () => {
      const mockStrategy = makeStrategy("auto");

      // 建立 Codex 上游 Pod
      const mockCodexSourcePod = makePod({
        id: SOURCE_POD_ID,
        name: "Codex Source Pod",
        provider: "codex",
        providerConfig: { model: "gpt-5.4" } as any,
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

      // summaryService 回傳 resolvedModel="gpt-5.4"（fallback 修正結果）
      (
        mockExecutionService.generateSummaryWithFallback as any
      ).mockResolvedValue({
        content: "codex 摘要",
        isSummarized: true,
        resolvedModel: "gpt-5.4",
      });

      const updatedConnection = makeConnection({
        id: CONNECTION_ID,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        triggerMode: "auto",
        summaryModel: "gpt-5.4",
      });
      vi.spyOn(connectionStore, "update").mockReturnValue(updatedConnection);

      await workflowPipeline.execute(codexBaseContext, mockStrategy);

      // 應呼叫 connectionStore.update 寫回 gpt-5.4
      expect(connectionStore.update).toHaveBeenCalledWith(
        CANVAS_ID,
        CONNECTION_ID,
        { summaryModel: "gpt-5.4" },
      );

      // 應廣播 CONNECTION_UPDATED 事件
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.stringContaining("connection:updated"),
        expect.objectContaining({
          canvasId: CANVAS_ID,
          success: true,
          connection: updatedConnection,
        }),
      );
    });

    it("resolvedModel 為 undefined（fallback 路徑）時，不應觸發寫回", async () => {
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
  // B7–B8：summaryProvider resolution 傳入 generateSummaryWithFallback
  // ----------------------------------------------------------------
  describe("B7–B8 summaryProvider resolution", () => {
    // B7: connection.summaryProvider=null + sourcePod.provider=gemini
    //     → generateSummaryWithFallback 的 provider 參數為 "gemini"
    it("B7: connection.summaryProvider=null、sourcePod.provider=gemini → provider 傳入 gemini", async () => {
      const mockStrategy = makeStrategy("auto");

      // sourcePod 為 gemini provider
      const geminiSourcePod = makePod({
        id: SOURCE_POD_ID,
        provider: "gemini" as any,
        providerConfig: { model: "gemini-2.5-flash" } as any,
      });
      const geminiConnection = makeConnection({
        summaryProvider: null, // NULL：未指定，由 runtime fallback
      });
      const geminiContext: PipelineContext = {
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: geminiConnection,
        triggerMode: "auto",
        decideResult: {
          connectionId: CONNECTION_ID,
          approved: true,
          reason: null,
        },
      };

      // podStore.getById：source 回 gemini pod，target 回原本的 mockTargetPod
      vi.spyOn(podStore, "getById").mockImplementation(
        (_cId: string, podId: string) => {
          if (podId === SOURCE_POD_ID) return geminiSourcePod as any;
          return mockTargetPod as any;
        },
      );
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        geminiConnection,
      ]);

      await workflowPipeline.execute(geminiContext, mockStrategy);

      // 驗證 generateSummaryWithFallback 收到的 provider 參數為 "gemini"
      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "gemini", // summaryProvider=null → fallback 為 sourcePod.provider=gemini
        geminiConnection.summaryModel,
        undefined,
        expect.any(String), // pathway
        undefined,
      );
    });

    // B8: connection.summaryProvider=codex + sourcePod.provider=claude
    //     → generateSummaryWithFallback 的 provider 參數為 "codex"（cross-provider 解耦）
    it("B8: connection.summaryProvider=codex、sourcePod.provider=claude → provider 傳入 codex（cross-provider）", async () => {
      const mockStrategy = makeStrategy("auto");

      // sourcePod 為 claude provider
      const claudeSourcePod = makePod({
        id: SOURCE_POD_ID,
        provider: "claude" as const,
        providerConfig: { model: "sonnet" } as any,
      });
      // connection 明確指定 summaryProvider=codex（cross-provider）
      const codexSummaryConnection = makeConnection({
        summaryProvider: "codex" as any, // 明確指定 codex provider 做摘要
        summaryModel: "gpt-5.4",
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

      // 驗證 provider 參數為 "codex"，而非 sourcePod.provider="claude"
      expect(
        mockExecutionService.generateSummaryWithFallback,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "codex", // summaryProvider 明確指定 codex，cross-provider 解耦
        codexSummaryConnection.summaryModel,
        undefined,
        expect.any(String), // pathway
        undefined,
      );
    });
  });
});
