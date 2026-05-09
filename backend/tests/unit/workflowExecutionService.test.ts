import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowExecutionService } from "../../src/services/workflow";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { summaryService } from "../../src/services/summaryService.js";
import { workflowEventEmitter } from "../../src/services/workflow";
import { workflowQueueService } from "../../src/services/workflow";
import { branchDecisionService } from "../../src/services/workflow";
import { workflowAutoTriggerService } from "../../src/services/workflow";
import { workflowBranchTriggerService } from "../../src/services/workflow";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { logger } from "../../src/utils/logger.js";
import type { Connection } from "../../src/types";
import type { TriggerStrategy } from "../../src/services/workflow/types.js";
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
    commandId: null,
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
  // checkAndTriggerWorkflows - 路由分發
  // ============================================================
  describe("checkAndTriggerWorkflows - 路由分發", () => {
    it("混合 auto + branch connection 時，分別呼叫對應的服務", async () => {
      const autoConn = makeConnection({
        id: "conn-auto-1",
        triggerMode: "auto",
      });
      const branchConn = makeConnection({
        id: "conn-branch-1",
        targetPodId: "target-pod-2",
        triggerMode: "branch",
      });

      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([
        autoConn,
        branchConn,
      ]);
      vi.spyOn(connectionStore, "getById").mockImplementation(((
        _cId: string,
        id: string,
      ) => {
        if (id === "conn-auto-1") return autoConn;
        if (id === "conn-branch-1") return branchConn;
        return null;
      }) as any);

      // 用 spy 驗證兩個路徑都被啟動
      const autoSpy = vi
        .spyOn(workflowAutoTriggerService, "processAutoTriggerConnection")
        .mockResolvedValue(undefined);
      const branchSpy = vi
        .spyOn(workflowBranchTriggerService, "processBranchConnections")
        .mockResolvedValue(undefined);

      await workflowExecutionService.checkAndTriggerWorkflows(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(autoSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        autoConn,
        undefined,
      );
      expect(branchSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        [branchConn],
        undefined,
      );
    });

    it("沒有 connection 時直接 return，不呼叫任何服務", async () => {
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      const autoSpy = vi.spyOn(
        workflowAutoTriggerService,
        "processAutoTriggerConnection",
      );

      await workflowExecutionService.checkAndTriggerWorkflows(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(autoSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // triggerWorkflowWithSummary - connection 狀態設定
  // ============================================================
  describe("triggerWorkflowWithSummary - connection 狀態設定", () => {
    it("觸發前應先將 connection 設為 active，才呼叫 strategy.onTrigger", async () => {
      const autoConn = makeConnection({
        id: "conn-auto-1",
        triggerMode: "auto",
      });
      const mockStrategy = makeStrategy("auto");

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        autoConn,
      ]);

      const callOrder: string[] = [];

      (connectionStore.updateConnectionStatus as any).mockImplementation(
        (_cId: string, _connId: string, status: string) => {
          callOrder.push(`updateConnectionStatus:${status}`);
        },
      );
      (mockStrategy.onTrigger as any).mockImplementation(() => {
        callOrder.push("onTrigger");
      });

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });

      const activeIndex = callOrder.indexOf("updateConnectionStatus:active");
      const onTriggerIndex = callOrder.indexOf("onTrigger");
      expect(activeIndex).toBeGreaterThanOrEqual(0);
      expect(onTriggerIndex).toBeGreaterThanOrEqual(0);
      expect(activeIndex).toBeLessThan(onTriggerIndex);
    });

    it.each([
      {
        label: "auto 模式：設定同群所有 auto/branch 連線為 active",
        triggerMode: "auto" as const,
        connections: [
          { id: "conn-auto-1", triggerMode: "auto" as const },
          {
            id: "conn-auto-2",
            triggerMode: "auto" as const,
            sourcePodId: "other-source",
          },
        ],
        expectedActiveCount: 2,
      },
      {
        label: "branch 模式：設定同群所有 auto/branch 連線為 active",
        triggerMode: "branch" as const,
        connections: [
          { id: "conn-branch-1", triggerMode: "branch" as const },
          {
            id: "conn-branch-2",
            triggerMode: "branch" as const,
            sourcePodId: "other-source",
          },
        ],
        expectedActiveCount: 2,
      },
      {
        label: "direct 模式：只設定當前連線為 active",
        triggerMode: "direct" as const,
        connections: [{ id: "conn-direct-1", triggerMode: "direct" as const }],
        expectedActiveCount: 1,
      },
    ])("$label", async ({ triggerMode, connections, expectedActiveCount }) => {
      const mainConn = makeConnection({ id: connections[0].id, triggerMode });
      const mockStrategy = makeStrategy(triggerMode);

      vi.spyOn(connectionStore, "getById").mockReturnValue(mainConn);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue(
        connections.map((c) =>
          makeConnection({
            id: c.id,
            triggerMode: c.triggerMode,
            sourcePodId: (c as any).sourcePodId ?? SOURCE_POD_ID,
          }),
        ),
      );

      const params =
        triggerMode === "direct"
          ? {
              canvasId: CANVAS_ID,
              connectionId: mainConn.id,
              summary: "Test summary",
              isSummarized: true,
              participatingConnectionIds: [mainConn.id],
              strategy: mockStrategy,
            }
          : {
              canvasId: CANVAS_ID,
              connectionId: mainConn.id,
              summary: "Test summary",
              isSummarized: true,
              participatingConnectionIds: undefined,
              strategy: mockStrategy,
            };

      await workflowExecutionService.triggerWorkflowWithSummary(params);

      const activeCalls = (
        connectionStore.updateConnectionStatus as any
      ).mock.calls.filter((call: any[]) => call[2] === "active");
      expect(activeCalls).toHaveLength(expectedActiveCount);
    });

    it("connection 不存在時直接 return，不觸發 strategy", async () => {
      const mockStrategy = makeStrategy("auto");
      vi.spyOn(connectionStore, "getById").mockReturnValue(undefined);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: "non-existent",
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });

      expect(mockStrategy.onTrigger).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // branch 判斷流程（通過 workflowBranchTriggerService）
  // ============================================================
  describe("branch 判斷流程", () => {
    it("branch connection → 觸發 workflow（通過 branchTriggerService）", async () => {
      const branchConn = makeConnection({
        id: "conn-branch-1",
        targetPodId: "target-pod-2",
        triggerMode: "branch",
      });

      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([
        branchConn,
      ]);
      const processSpy = vi
        .spyOn(workflowBranchTriggerService, "processBranchConnections")
        .mockResolvedValue(undefined);

      await workflowExecutionService.checkAndTriggerWorkflows(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(processSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        [branchConn],
        undefined,
      );
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
      label: "摘要成功 → 呼叫 settlePodTrigger（帶 pathway）",
      summaryResult: { success: true, summary: "摘要內容" },
      fallback: null,
      pathway: "auto" as const,
      expectSettle: true,
      expectError: false,
      expectNull: false,
    },
    {
      label: "摘要失敗但 fallback 有值 → 呼叫 settlePodTrigger",
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
        );
      }
      if (expectError) {
        expect(runExecutionService.errorPodInstance).toHaveBeenCalled();
      } else {
        expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
      }
    },
  );

  it("摘要失敗且 fallback 為 null → 呼叫 errorPodInstance，返回 null", async () => {
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
