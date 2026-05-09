import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { workflowMultiInputService } from "../../src/services/workflow/workflowMultiInputService.js";
import { podStore } from "../../src/services/podStore.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { runStore } from "../../src/services/runStore.js";
import { workflowQueueService } from "../../src/services/workflow/workflowQueueService.js";
import { runQueueService } from "../../src/services/workflow/runQueueService.js";
import { socketService } from "../../src/services/socketService.js";
import { logger } from "../../src/utils/logger.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import type { TriggerStrategy } from "../../src/services/workflow/types.js";
import type { WorkflowStatusDelegate } from "../../src/services/workflow/workflowStatusDelegate.js";
import type { Connection } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";
import path from "path";
import { config } from "../../src/config/index.js";

// ─── 常數 ───────────────────────────────────────────────────────────────────
const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";

// ─── 工廠函式 ────────────────────────────────────────────────────────────────

function makePod(
  id: string,
  status: "idle" | "chatting" | "uploading" | "error" = "idle",
) {
  return {
    id,
    name: `Pod ${id}`,
    provider: "claude" as const,
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: path.join(config.canvasRoot, CANVAS_ID, `pod-${id}`),
    commandId: null,
    status,
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
  };
}

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-multi-1",
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

function makeStrategy(mode: "auto" | "direct" | "ai-decide"): TriggerStrategy {
  return {
    mode,
    decide: vi.fn().mockResolvedValue([]),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
  } as unknown as TriggerStrategy;
}

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "test-run-id",
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    ...overrides,
  };
}

function makeRunPodInstance(
  status:
    | "pending"
    | "running"
    | "completed"
    | "queued"
    | "skipped" = "pending",
) {
  return {
    id: "test-instance-id",
    runId: "test-run-id",
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

// ─── テスト ──────────────────────────────────────────────────────────────────

describe("WorkflowMultiInputService", () => {
  const mockConnection = makeConnection();

  let mockAutoStrategy: TriggerStrategy;
  let mockExecutionService: {
    triggerWorkflowWithSummary: ReturnType<typeof vi.fn>;
    generateSummaryWithFallback: ReturnType<typeof vi.fn>;
  };
  let mockDelegate: WorkflowStatusDelegate;

  // spies
  let podGetByIdSpy: ReturnType<typeof vi.spyOn>;
  let podSetStatusSpy: ReturnType<typeof vi.spyOn>;
  let runGetPodInstanceSpy: ReturnType<typeof vi.spyOn>;
  let pendingHasSpy: ReturnType<typeof vi.spyOn>;
  let pendingRecordSpy: ReturnType<typeof vi.spyOn>;
  let pendingGetSummariesSpy: ReturnType<typeof vi.spyOn>;
  let pendingClearSpy: ReturnType<typeof vi.spyOn>;
  let queueEnqueueSpy: ReturnType<typeof vi.spyOn>;
  let runQueueEnqueueSpy: ReturnType<typeof vi.spyOn>;
  let socketEmitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // spyOn stores（不 mock 模組，保留真實模組）
    podGetByIdSpy = vi
      .spyOn(podStore, "getById")
      .mockImplementation(
        (_cId: string, podId: string) => makePod(podId) as any,
      );
    podSetStatusSpy = vi
      .spyOn(podStore, "setStatus")
      .mockImplementation(() => {});

    runGetPodInstanceSpy = vi
      .spyOn(runStore, "getPodInstance")
      .mockReturnValue(undefined);

    pendingHasSpy = vi
      .spyOn(pendingTargetStore, "hasPendingTarget")
      .mockReturnValue(false);
    pendingRecordSpy = vi
      .spyOn(pendingTargetStore, "recordSourceCompletion")
      .mockReturnValue({ allSourcesResponded: true, hasRejection: false });
    pendingGetSummariesSpy = vi
      .spyOn(pendingTargetStore, "getCompletedSummaries")
      .mockReturnValue(new Map([[SOURCE_POD_ID, "Summary content"]]));
    pendingClearSpy = vi
      .spyOn(pendingTargetStore, "clearPendingTarget")
      .mockImplementation(() => {});

    queueEnqueueSpy = vi
      .spyOn(workflowQueueService, "enqueue")
      .mockReturnValue({ position: 1, queueSize: 1 });
    runQueueEnqueueSpy = vi
      .spyOn(runQueueService, "enqueue")
      .mockImplementation(() => ({ position: 1, queueSize: 1 }) as any);

    socketEmitSpy = vi
      .spyOn(socketService, "emitToCanvas")
      .mockImplementation(() => {});

    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});

    // 初始化 service
    mockAutoStrategy = makeStrategy("auto");
    mockExecutionService = {
      triggerWorkflowWithSummary: vi.fn().mockResolvedValue(undefined),
      generateSummaryWithFallback: vi.fn().mockResolvedValue({
        content: "摘要",
        isSummarized: true,
      }),
    };
    mockDelegate = {
      scheduleNextInQueue: vi.fn(),
    } as unknown as WorkflowStatusDelegate;

    workflowMultiInputService.init({
      executionService: mockExecutionService as any,
      strategies: {
        auto: mockAutoStrategy,
        direct: makeStrategy("direct"),
        "ai-decide": makeStrategy("ai-decide"),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Normal Mode ─────────────────────────────────────────────────────────

  describe("Normal Mode - target pod 忙碌時", () => {
    it("target pod 忙碌時應加入 workflowQueue", async () => {
      podGetByIdSpy.mockImplementation(
        (_cId: string, podId: string) => makePod(podId, "chatting") as any,
      );

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
      });

      expect(queueEnqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: mockConnection.id,
          targetPodId: TARGET_POD_ID,
          isSummarized: true,
          triggerMode: "auto",
        }),
      );
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("target pod 閒置時不進入 queue 直接觸發", async () => {
      podGetByIdSpy.mockImplementation(
        (_cId: string, podId: string) => makePod(podId, "idle") as any,
      );

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
      });

      expect(queueEnqueueSpy).not.toHaveBeenCalled();
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalled();
    });
  });

  // ─── Run Mode ─────────────────────────────────────────────────────────────

  describe("Run Mode - target pod instance 忙碌時", () => {
    it("target pod instance 為 running 時應加入 runQueue", async () => {
      const runContext = makeRunContext();
      runGetPodInstanceSpy.mockReturnValue(
        makeRunPodInstance("running") as any,
      );

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
        runContext,
      });

      await vi.waitFor(() => {
        expect(runQueueEnqueueSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            canvasId: CANVAS_ID,
            connectionId: mockConnection.id,
            targetPodId: TARGET_POD_ID,
            isSummarized: true,
            triggerMode: "auto",
            runContext,
          }),
        );
      });
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("target pod instance 不是 running 時直接觸發，不加入 runQueue", async () => {
      const runContext = makeRunContext();
      runGetPodInstanceSpy.mockReturnValue(
        makeRunPodInstance("pending") as any,
      );

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
        runContext,
      });

      expect(runQueueEnqueueSpy).not.toHaveBeenCalled();
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalled();
    });

    it("target pod instance 不存在時直接觸發，不加入 runQueue", async () => {
      const runContext = makeRunContext();
      runGetPodInstanceSpy.mockReturnValue(undefined);

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
        runContext,
      });

      expect(runQueueEnqueueSpy).not.toHaveBeenCalled();
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalled();
    });

    it("enqueueIfBusy 呼叫後應觸發 scheduleNextInQueue（安全網）", async () => {
      const runContext = makeRunContext();
      runGetPodInstanceSpy.mockReturnValue(
        makeRunPodInstance("running") as any,
      );

      // spy scheduleNextInQueue 透過 workflowQueueService（Normal Mode delegate）
      // 在 Run Mode enqueueIfBusy 內部，createStatusDelegate(runContext) 會回傳 RunModeDelegate，
      // 其 scheduleNextInQueue 會呼叫 runQueueService.processNext。
      const processNextSpy = vi
        .spyOn(runQueueService, "processNext")
        .mockResolvedValue(undefined);

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
        runContext,
      });

      // enqueue 完成後應立即呼叫 scheduleNextInQueue 防止佇列卡住
      await vi.waitFor(() => {
        expect(runQueueEnqueueSpy).toHaveBeenCalled();
        // scheduleNextInQueue 在 enqueueIfBusy 內部被呼叫，透過 RunModeDelegate
        expect(processNextSpy).toHaveBeenCalledWith(
          CANVAS_ID,
          TARGET_POD_ID,
          runContext,
        );
      });
    });
  });

  // ─── 有拒絕來源 ────────────────────────────────────────────────────────────

  describe("handleMultiInputForConnection - 所有來源回應完畢有拒絕時", () => {
    it("所有來源回應完畢且有拒絕時不應觸發 workflow，且 approved 連線狀態收回 idle 並廣播 CONNECTION_UPDATED", async () => {
      pendingRecordSpy.mockReturnValue({
        allSourcesResponded: true,
        hasRejection: true,
      });

      // 設定 group 中有一條 approved 連線（來自同一個 source pod 的 branch）
      const approvedConn = makeConnection({
        id: "conn-approved-1",
        decideStatus: "approved",
        connectionStatus: "active",
      });

      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        approvedConn,
      ]);
      const updateConnectionStatusSpy = vi
        .spyOn(connectionStore, "updateConnectionStatus")
        .mockReturnValue(undefined);
      vi.spyOn(connectionStore, "getById").mockReturnValue({
        ...approvedConn,
        connectionStatus: "idle",
      } as Connection);

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
      });

      // 不觸發 workflow
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();

      // approved 連線的 connectionStatus 收回 idle
      expect(updateConnectionStatusSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-approved-1",
        "idle",
      );

      // 廣播 CONNECTION_UPDATED
      expect(socketEmitSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        expect.objectContaining({
          requestId: "",
          canvasId: CANVAS_ID,
          success: true,
          connection: expect.objectContaining({ id: "conn-approved-1" }),
        }),
      );
    });
  });

  // ─── triggerMergedWorkflow ────────────────────────────────────────────────

  describe("triggerMergedWorkflow - completedSummaries 為 null", () => {
    it("completedSummaries 為 null 時直接 return 不觸發 workflow", () => {
      pendingGetSummariesSpy.mockReturnValue(null);

      workflowMultiInputService.triggerMergedWorkflow(
        CANVAS_ID,
        mockConnection,
        "auto",
      );

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });
  });

  describe("triggerMergedWorkflow - 合併多來源 summary 觸發下游", () => {
    it("Normal Mode：合併多來源 summary 後觸發下游 workflow", () => {
      const summaries = new Map([
        [SOURCE_POD_ID, "First source summary"],
        ["source-pod-2", "Second source summary"],
      ]);

      pendingGetSummariesSpy.mockReturnValue(summaries);
      podGetByIdSpy.mockImplementation(
        (_cId: string, podId: string) => makePod(podId, "idle") as any,
      );

      workflowMultiInputService.triggerMergedWorkflow(
        CANVAS_ID,
        mockConnection,
        "auto",
      );

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: mockConnection.id,
          summary: expect.stringContaining("First source summary"),
          isSummarized: true,
          participatingConnectionIds: undefined,
          strategy: mockAutoStrategy,
        }),
      );
      expect(podSetStatusSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
        "chatting",
      );
      expect(pendingClearSpy).toHaveBeenCalledWith(TARGET_POD_ID);
    });

    it("Run Mode：觸發下游 workflow 時不呼叫 podStore.setStatus", () => {
      const runContext = makeRunContext();
      const summaries = new Map([[SOURCE_POD_ID, "Run mode summary"]]);

      pendingGetSummariesSpy.mockReturnValue(summaries);
      runGetPodInstanceSpy.mockReturnValue(
        makeRunPodInstance("pending") as any,
      );

      workflowMultiInputService.triggerMergedWorkflow(
        CANVAS_ID,
        mockConnection,
        "auto",
        runContext,
      );

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: mockConnection.id,
          isSummarized: true,
          strategy: mockAutoStrategy,
          runContext,
        }),
      );
      expect(podSetStatusSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Bug B 驗收：rejected 路徑 approved connection 狀態收尾 ────────────────

  describe("rejected 路徑：approved connection 狀態收尾（Bug B 回歸測試）", () => {
    let updateConnectionStatusSpy: ReturnType<typeof vi.spyOn>;
    let findByTargetPodIdSpy: ReturnType<typeof vi.spyOn>;
    let getByIdSpy: ReturnType<typeof vi.spyOn>;

    const approvedConn = makeConnection({
      id: "conn-approved-bugb",
      decideStatus: "approved",
      connectionStatus: "active",
    });

    beforeEach(() => {
      // 設定 group 包含一條 approved 連線
      findByTargetPodIdSpy = vi
        .spyOn(connectionStore, "findByTargetPodId")
        .mockReturnValue([approvedConn]);

      updateConnectionStatusSpy = vi
        .spyOn(connectionStore, "updateConnectionStatus")
        .mockReturnValue(undefined);

      getByIdSpy = vi.spyOn(connectionStore, "getById").mockReturnValue({
        ...approvedConn,
        connectionStatus: "idle",
      } as Connection);

      // 設定 recordSourceCompletion 回傳 hasRejection: true（所有來源都回應了）
      pendingRecordSpy.mockReturnValue({
        allSourcesResponded: true,
        hasRejection: true,
      });
    });

    it("hasRejection=true 時：approved 連線 connectionStatus 收回 idle", async () => {
      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
      });

      expect(updateConnectionStatusSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-approved-bugb",
        "idle",
      );
    });

    it("hasRejection=true 時：廣播 CONNECTION_UPDATED 事件", async () => {
      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
      });

      expect(socketEmitSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        expect.objectContaining({
          requestId: "",
          canvasId: CANVAS_ID,
          success: true,
          connection: expect.objectContaining({ id: "conn-approved-bugb" }),
        }),
      );
    });

    it("hasRejection=true 時：不觸發 triggerWorkflowWithSummary", async () => {
      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
      });

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("group 中沒有 approved 連線時：不呼叫 updateConnectionStatus 也不廣播 CONNECTION_UPDATED", async () => {
      // 覆寫：group 中只有 none 狀態的連線
      findByTargetPodIdSpy.mockReturnValue([
        makeConnection({ id: "conn-none-1", decideStatus: "none" }),
      ]);

      await workflowMultiInputService.handleMultiInputForConnection({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: mockConnection,
        summary: "Some summary",
        triggerMode: "auto",
      });

      expect(updateConnectionStatusSpy).not.toHaveBeenCalled();
      expect(socketEmitSpy).not.toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        expect.anything(),
      );
    });
  });
});
