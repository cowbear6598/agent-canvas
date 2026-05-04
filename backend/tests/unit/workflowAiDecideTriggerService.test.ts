import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowAiDecideTriggerService } from "../../src/services/workflow/workflowAiDecideTriggerService.js";
import { aiDecideService } from "../../src/services/workflow/aiDecideService.js";
import { workflowEventEmitter } from "../../src/services/workflow/workflowEventEmitter.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { workflowStateService } from "../../src/services/workflow/workflowStateService.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { workflowPipeline } from "../../src/services/workflow/workflowPipeline.js";
import { workflowMultiInputService } from "../../src/services/workflow/workflowMultiInputService.js";
import { podStore } from "../../src/services/podStore.js";
import { logger } from "../../src/utils/logger.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import type { Connection } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";
import path from "path";
import { config } from "../../src/config/index.js";

// ─── 常數 ────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";

// ─── 工廠函式 ─────────────────────────────────────────────────────────────────

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-ai-1",
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "ai-decide",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    aiDecideModel: "sonnet",
    ...overrides,
  } as Connection;
}

function makePod(id: string) {
  return {
    id,
    name: `Pod ${id}`,
    provider: "claude" as const,
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: path.join(config.canvasRoot, CANVAS_ID, `pod-${id}`),
    commandId: null,
    status: "idle" as const,
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
  };
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
  vi.spyOn(podStore, "getById").mockImplementation(((
    _cId: string,
    podId: string,
  ) => makePod(podId)) as any);
  vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);
  vi.spyOn(connectionStore, "updateDecideStatus").mockReturnValue(undefined);
  vi.spyOn(connectionStore, "updateConnectionStatus").mockReturnValue(
    undefined,
  );
  vi.spyOn(workflowStateService, "checkMultiInputScenario").mockReturnValue({
    isMultiInput: false,
    requiredSourcePodIds: [],
  });
  vi.spyOn(workflowStateService, "emitPendingStatus").mockImplementation(
    () => {},
  );
  vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(false);
  vi.spyOn(pendingTargetStore, "recordSourceRejection").mockReturnValue({
    allSourcesResponded: false,
  } as any);
  vi.spyOn(workflowPipeline, "execute").mockResolvedValue(undefined);
  vi.spyOn(workflowEventEmitter, "emitAiDecidePending").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitAiDecideResult").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitAiDecideError").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowQueued").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowComplete").mockImplementation(
    () => {},
  );
  vi.spyOn(
    workflowEventEmitter,
    "emitWorkflowAiDecideTriggered",
  ).mockImplementation(() => {});
  vi.spyOn(runExecutionService, "errorPodInstance").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "settleAndSkipPath").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "decidingPodInstance").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "startPodInstance").mockImplementation(
    () => {},
  );
}

// ─── 測試 ─────────────────────────────────────────────────────────────────────

describe("WorkflowAiDecideTriggerService", () => {
  const mockConnection = makeConnection();
  const mockRunContext = makeRunContext();

  const createUninitializedService = () =>
    Object.create(Object.getPrototypeOf(workflowAiDecideTriggerService));

  beforeEach(() => {
    setupBasicSpies();

    workflowAiDecideTriggerService.init({
      aiDecideService,
      eventEmitter: workflowEventEmitter,
      connectionStore,
      podStore,
      stateService: workflowStateService,
      pendingTargetStore,
      pipeline: workflowPipeline,
      multiInputService: workflowMultiInputService,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // decide() - 批次決策格式轉換
  // ============================================================
  describe("decide() - 批次決策格式轉換", () => {
    it("正確轉換 aiDecideService 的成功結果為 TriggerDecideResult 格式", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          {
            connectionId: "conn-ai-1",
            shouldTrigger: true,
            reason: "相關任務",
          },
        ],
        errors: [],
      });

      const results = await workflowAiDecideTriggerService.decide({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connections: [mockConnection],
      });

      expect(results).toEqual([
        {
          connectionId: "conn-ai-1",
          approved: true,
          reason: "相關任務",
          isError: false,
        },
      ]);
    });

    it("正確轉換 aiDecideService 的錯誤結果為 approved=false 格式", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [],
        errors: [{ connectionId: "conn-ai-1", error: "AI 決策失敗" }],
      });

      const results = await workflowAiDecideTriggerService.decide({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connections: [mockConnection],
      });

      expect(results).toEqual([
        {
          connectionId: "conn-ai-1",
          approved: false,
          reason: "AI 判斷服務發生錯誤",
          isError: true,
        },
      ]);
    });

    it("當 aiDecideService 拋出錯誤時，所有 connection 標記為錯誤", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockRejectedValue(
        new Error("網路錯誤"),
      );

      const results = await workflowAiDecideTriggerService.decide({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connections: [mockConnection],
      });

      expect(results).toEqual([
        {
          connectionId: "conn-ai-1",
          approved: false,
          reason: "錯誤：網路錯誤",
          isError: true,
        },
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        "Workflow",
        "Error",
        "[AI-Decide] aiDecideService.decideConnections 失敗",
        expect.any(Error),
      );
    });
  });

  // ============================================================
  // processAiDecideConnections() - 完整批次判斷流程（非 run 模式）
  // ============================================================
  describe("processAiDecideConnections() - 完整批次判斷流程", () => {
    it("批次決策 approved 的 connection 進入 Pipeline", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          {
            connectionId: "conn-ai-1",
            shouldTrigger: true,
            reason: "相關任務",
          },
        ],
        errors: [],
      });

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
      );

      expect(workflowEventEmitter.emitAiDecidePending).toHaveBeenCalledWith(
        CANVAS_ID,
        ["conn-ai-1"],
        SOURCE_POD_ID,
      );
      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-1",
        "approved",
        "相關任務",
      );
      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-1",
        "ai-approved",
      );
      expect(workflowEventEmitter.emitAiDecideResult).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: "conn-ai-1",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        shouldTrigger: true,
        reason: "相關任務",
      });
      expect(workflowPipeline.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          sourcePodId: SOURCE_POD_ID,
          connection: mockConnection,
          triggerMode: "ai-decide",
          decideResult: {
            connectionId: "conn-ai-1",
            approved: true,
            reason: "相關任務",
            isError: false,
          },
        }),
        workflowAiDecideTriggerService,
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Workflow",
        "Create",
        expect.stringContaining("AI Decide 核准"),
      );
    });

    it("批次決策 rejected 的 connection 更新狀態並發送事件", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          { connectionId: "conn-ai-1", shouldTrigger: false, reason: "不相關" },
        ],
        errors: [],
      });

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
      );

      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-1",
        "rejected",
        "不相關",
      );
      expect(workflowEventEmitter.emitAiDecideResult).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: "conn-ai-1",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        shouldTrigger: false,
        reason: "不相關",
      });
      expect(workflowPipeline.execute).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        "Workflow",
        "Update",
        expect.stringContaining("AI Decide 拒絕"),
      );
    });

    it.each([
      {
        label: "errors 欄位 → 標記 error 並發送 emitAiDecideError",
        mockDecide: () =>
          vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
            results: [],
            errors: [{ connectionId: "conn-ai-1", error: "AI 決策失敗" }],
          }),
        expectedDecideStatus: "error" as const,
        expectedReason: "AI 判斷服務發生錯誤",
        expectedError: "AI 判斷服務發生錯誤",
      },
      {
        label: "decideConnections 拋出 → 標記 error 並發送 emitAiDecideError",
        mockDecide: () =>
          vi
            .spyOn(aiDecideService, "decideConnections")
            .mockRejectedValue(new Error("網路錯誤")),
        expectedDecideStatus: "error" as const,
        expectedReason: "錯誤：網路錯誤",
        expectedError: "錯誤：網路錯誤",
      },
    ])(
      "$label",
      async ({
        mockDecide,
        expectedDecideStatus,
        expectedReason,
        expectedError,
      }) => {
        mockDecide();

        await workflowAiDecideTriggerService.processAiDecideConnections(
          CANVAS_ID,
          SOURCE_POD_ID,
          [mockConnection],
        );

        expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
          CANVAS_ID,
          "conn-ai-1",
          expectedDecideStatus,
          expectedReason,
        );
        expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(
          CANVAS_ID,
          "conn-ai-1",
          "ai-error",
        );
        expect(workflowEventEmitter.emitAiDecideError).toHaveBeenCalledWith({
          canvasId: CANVAS_ID,
          connectionId: "conn-ai-1",
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
          error: expectedError,
        });
        expect(workflowPipeline.execute).not.toHaveBeenCalled();
      },
    );

    it("PENDING 事件在決策前正確發送（呼叫順序）", async () => {
      const callOrder: string[] = [];

      (workflowEventEmitter.emitAiDecidePending as any).mockImplementation(
        () => {
          callOrder.push("emitAiDecidePending");
        },
      );
      (connectionStore.updateDecideStatus as any).mockImplementation(
        (_cId: string, _connId: string, status: string) => {
          if (status === "pending")
            callOrder.push("updateDecideStatus-pending");
          else if (status === "approved")
            callOrder.push("updateDecideStatus-approved");
        },
      );
      (connectionStore.updateConnectionStatus as any).mockImplementation(
        (_cId: string, _connId: string, status: string) => {
          if (status === "ai-deciding")
            callOrder.push("updateConnectionStatus-ai-deciding");
        },
      );
      vi.spyOn(aiDecideService, "decideConnections").mockImplementation(
        async () => {
          callOrder.push("decide");
          return {
            results: [
              {
                connectionId: "conn-ai-1",
                shouldTrigger: true,
                reason: "相關任務",
              },
            ],
            errors: [],
          };
        },
      );

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
      );

      expect(callOrder).toEqual([
        "emitAiDecidePending",
        "updateDecideStatus-pending",
        "updateConnectionStatus-ai-deciding",
        "decide",
        "updateDecideStatus-approved",
      ]);
    });

    it("多個 connections 批次處理", async () => {
      const conn2 = makeConnection({
        id: "conn-ai-2",
        targetPodId: "target-pod-2",
      });
      const conn3 = makeConnection({
        id: "conn-ai-3",
        targetPodId: "target-pod-3",
      });

      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          {
            connectionId: "conn-ai-1",
            shouldTrigger: true,
            reason: "相關任務 1",
          },
          {
            connectionId: "conn-ai-2",
            shouldTrigger: false,
            reason: "不相關任務 2",
          },
        ],
        errors: [{ connectionId: "conn-ai-3", error: "AI 決策失敗" }],
      });

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection, conn2, conn3],
      );

      expect(workflowEventEmitter.emitAiDecidePending).toHaveBeenCalledWith(
        CANVAS_ID,
        ["conn-ai-1", "conn-ai-2", "conn-ai-3"],
        SOURCE_POD_ID,
      );
      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-1",
        "approved",
        "相關任務 1",
      );
      expect(workflowPipeline.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: mockConnection,
          triggerMode: "ai-decide",
        }),
        workflowAiDecideTriggerService,
      );
      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-2",
        "rejected",
        "不相關任務 2",
      );
      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-3",
        "error",
        "AI 判斷服務發生錯誤",
      );
      expect(workflowEventEmitter.emitAiDecideError).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: "conn-ai-3",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: "target-pod-3",
        error: "AI 判斷服務發生錯誤",
      });
    });
  });

  // ============================================================
  // 錯誤處理
  // ============================================================
  describe("錯誤處理", () => {
    it.each([
      {
        label: "decide()",
        call: (svc: any) =>
          svc.decide({
            canvasId: CANVAS_ID,
            sourcePodId: SOURCE_POD_ID,
            connections: [mockConnection],
          }),
      },
      {
        label: "processAiDecideConnections()",
        call: (svc: any) =>
          svc.processAiDecideConnections(CANVAS_ID, SOURCE_POD_ID, [
            mockConnection,
          ]),
      },
    ])("未初始化時呼叫 $label 拋出錯誤", async ({ call }) => {
      const uninitializedService = createUninitializedService();

      await expect(call(uninitializedService)).rejects.toThrow(
        "WorkflowAiDecideTriggerService 尚未初始化，請先呼叫 init()",
      );
    });

    it("pipeline.execute 拋出錯誤時記錄但不影響流程", async () => {
      const pipelineError = new Error("Pipeline 執行失敗");
      vi.spyOn(workflowPipeline, "execute").mockRejectedValue(pipelineError);
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          {
            connectionId: "conn-ai-1",
            shouldTrigger: true,
            reason: "相關任務",
          },
        ],
        errors: [],
      });

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
      );

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "Workflow",
          "Error",
          expect.stringContaining("AI Decide Workflow 執行失敗，連線"),
          pipelineError,
        );
      });
      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-1",
        "approved",
        "相關任務",
      );
      expect(workflowEventEmitter.emitWorkflowComplete).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: "conn-ai-1",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        success: false,
        error: "Pipeline 執行失敗",
        triggerMode: "ai-decide",
      });
    });
  });

  // ============================================================
  // onTrigger() - 觸發生命週期
  // ============================================================
  describe("onTrigger() - 觸發生命週期", () => {
    it("非 run 模式：應呼叫 emitWorkflowAiDecideTriggered", () => {
      workflowAiDecideTriggerService.onTrigger({
        canvasId: CANVAS_ID,
        connectionId: "conn-ai-1",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        summary: "Test summary",
        isSummarized: true,
      });

      expect(
        workflowEventEmitter.emitWorkflowAiDecideTriggered,
      ).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-1",
        SOURCE_POD_ID,
        TARGET_POD_ID,
      );
    });

    it("run 模式下不呼叫 emitWorkflowAiDecideTriggered", () => {
      workflowAiDecideTriggerService.onTrigger({
        canvasId: CANVAS_ID,
        connectionId: "conn-ai-1",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        summary: "Test summary",
        isSummarized: true,
        runContext: mockRunContext,
      });

      expect(
        workflowEventEmitter.emitWorkflowAiDecideTriggered,
      ).not.toHaveBeenCalled();
    });

    it("onTrigger 未初始化時應拋出錯誤", () => {
      const uninitializedService = createUninitializedService();

      expect(() =>
        uninitializedService.onTrigger({
          canvasId: CANVAS_ID,
          connectionId: "conn-ai-1",
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
          summary: "Test summary",
          isSummarized: true,
        }),
      ).toThrow("WorkflowAiDecideTriggerService 尚未初始化");
    });
  });

  // ============================================================
  // onQueued() - 佇列生命週期
  // ============================================================
  describe("onQueued() - 佇列生命週期", () => {
    const mockQueuedContext = {
      canvasId: CANVAS_ID,
      connectionId: "conn-ai-1",
      sourcePodId: SOURCE_POD_ID,
      targetPodId: TARGET_POD_ID,
      position: 0,
      queueSize: 1,
      triggerMode: "ai-decide" as const,
      participatingConnectionIds: ["conn-ai-1"],
    };

    it("非 run 模式：更新連線狀態為 queued 並發送 emitWorkflowQueued 事件", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        mockConnection,
      ]);

      workflowAiDecideTriggerService.onQueued(mockQueuedContext);

      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-ai-1",
        "queued",
      );
      expect(workflowEventEmitter.emitWorkflowQueued).toHaveBeenCalled();
    });

    it("run 模式：不更新連線狀態也不發送 emitWorkflowQueued 事件", () => {
      workflowAiDecideTriggerService.onQueued({
        ...mockQueuedContext,
        runContext: mockRunContext,
      });

      expect(connectionStore.updateConnectionStatus).not.toHaveBeenCalled();
      expect(workflowEventEmitter.emitWorkflowQueued).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // handleRejectedConnection - 拒絕處理路徑
  // ============================================================
  describe("handleRejectedConnection - 拒絕處理路徑", () => {
    it("多輸入場景 + 拒絕時記錄 rejection 並更新 pending 狀態", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          { connectionId: "conn-ai-1", shouldTrigger: false, reason: "不相關" },
        ],
        errors: [],
      });
      vi.spyOn(workflowStateService, "checkMultiInputScenario").mockReturnValue(
        {
          isMultiInput: true,
          requiredSourcePodIds: [SOURCE_POD_ID, "other-source"],
        },
      );
      vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(true);

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
      );

      expect(pendingTargetStore.recordSourceRejection).toHaveBeenCalledWith(
        TARGET_POD_ID,
        SOURCE_POD_ID,
        "不相關",
      );
      expect(workflowStateService.emitPendingStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
      );
    });

    it("非多輸入場景拒絕時不記錄 rejection", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          { connectionId: "conn-ai-1", shouldTrigger: false, reason: "不相關" },
        ],
        errors: [],
      });
      vi.spyOn(workflowStateService, "checkMultiInputScenario").mockReturnValue(
        {
          isMultiInput: false,
          requiredSourcePodIds: [],
        },
      );

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
      );

      expect(pendingTargetStore.recordSourceRejection).not.toHaveBeenCalled();
      expect(workflowStateService.emitPendingStatus).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: "單一 ai-decide",
        targetConnections: [{ id: "conn-ai-1", triggerMode: "ai-decide" }],
      },
      {
        label: "混合 auto/ai-decide",
        targetConnections: [
          { id: "conn-ai-1", triggerMode: "ai-decide" },
          { id: "conn-auto-1", triggerMode: "auto" },
        ],
      },
    ])(
      "$label connection 被拒絕 + 非 multi input → 更新連線狀態",
      async ({ targetConnections }) => {
        vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
          results: [
            {
              connectionId: "conn-ai-1",
              shouldTrigger: false,
              reason: "不相關",
            },
          ],
          errors: [],
        });
        vi.spyOn(
          workflowStateService,
          "checkMultiInputScenario",
        ).mockReturnValue({
          isMultiInput: false,
          requiredSourcePodIds: [],
        });
        vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue(
          targetConnections.map((c) =>
            makeConnection({ id: c.id, triggerMode: c.triggerMode as any }),
          ),
        );

        await workflowAiDecideTriggerService.processAiDecideConnections(
          CANVAS_ID,
          SOURCE_POD_ID,
          [mockConnection],
        );

        expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
          CANVAS_ID,
          "conn-ai-1",
          "rejected",
          "不相關",
        );
        expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(
          CANVAS_ID,
          "conn-ai-1",
          "ai-rejected",
        );
      },
    );
  });

  // ============================================================
  // mode 屬性
  // ============================================================
  describe("mode 屬性", () => {
    it("mode 應為 'ai-decide'", () => {
      expect(workflowAiDecideTriggerService.mode).toBe("ai-decide");
    });
  });

  // ============================================================
  // run 模式 - AI-Decide 拒絕/出錯時下游 pod instance 狀態更新
  // ============================================================
  describe("run 模式 - AI-Decide 決策結果處理", () => {
    it.each([
      {
        label:
          "AI-Decide 拒絕 → 呼叫 settleAndSkipPath，不更新 connectionStore",
        mockDecide: () =>
          vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
            results: [
              {
                connectionId: "conn-ai-1",
                shouldTrigger: false,
                reason: "不相關任務",
              },
            ],
            errors: [],
          }),
        expectSettle: true,
        expectError: false,
        expectedErrorMsg: undefined as string | undefined,
      },
      {
        label:
          "AI-Decide errors 欄位 → 呼叫 errorPodInstance，不更新 connectionStore",
        mockDecide: () =>
          vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
            results: [],
            errors: [{ connectionId: "conn-ai-1", error: "AI 決策失敗" }],
          }),
        expectSettle: false,
        expectError: true,
        expectedErrorMsg: "AI 判斷服務發生錯誤",
      },
      {
        label: "decideConnections 拋出 → 呼叫 errorPodInstance",
        mockDecide: () =>
          vi
            .spyOn(aiDecideService, "decideConnections")
            .mockRejectedValue(new Error("網路錯誤")),
        expectSettle: false,
        expectError: true,
        expectedErrorMsg: "錯誤：網路錯誤",
      },
    ])(
      "run 模式下 $label",
      async ({ mockDecide, expectSettle, expectError, expectedErrorMsg }) => {
        mockDecide();

        await workflowAiDecideTriggerService.processAiDecideConnections(
          CANVAS_ID,
          SOURCE_POD_ID,
          [mockConnection],
          mockRunContext,
        );

        if (expectSettle) {
          expect(runExecutionService.settleAndSkipPath).toHaveBeenCalledWith(
            mockRunContext,
            TARGET_POD_ID,
            "auto",
          );
          expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
        }
        if (expectError) {
          expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
            mockRunContext,
            TARGET_POD_ID,
            expectedErrorMsg,
          );
          expect(runExecutionService.settleAndSkipPath).not.toHaveBeenCalled();
        }
        expect(connectionStore.updateDecideStatus).not.toHaveBeenCalled();
        expect(connectionStore.updateConnectionStatus).not.toHaveBeenCalled();
      },
    );

    it("run 模式下 AI-Decide 核准時不呼叫 settleAndSkipPath 或 errorPodInstance，不更新 connectionStore", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          {
            connectionId: "conn-ai-1",
            shouldTrigger: true,
            reason: "相關任務",
          },
        ],
        errors: [],
      });

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
        mockRunContext,
      );

      expect(runExecutionService.settleAndSkipPath).not.toHaveBeenCalled();
      expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
      expect(connectionStore.updateDecideStatus).not.toHaveBeenCalled();
      expect(connectionStore.updateConnectionStatus).not.toHaveBeenCalled();
      expect(workflowEventEmitter.emitAiDecideResult).not.toHaveBeenCalled();
      expect(workflowEventEmitter.emitAiDecidePending).not.toHaveBeenCalled();
    });

    it("processAiDecideConnections 在呼叫 decide 前設定目標 pod 為 deciding", async () => {
      vi.spyOn(aiDecideService, "decideConnections").mockResolvedValue({
        results: [
          { connectionId: "conn-ai-1", shouldTrigger: true, reason: "" },
        ],
        errors: [],
      });

      await workflowAiDecideTriggerService.processAiDecideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
        mockRunContext,
      );

      expect(runExecutionService.decidingPodInstance).toHaveBeenCalledWith(
        mockRunContext,
        TARGET_POD_ID,
      );
    });
  });
});
