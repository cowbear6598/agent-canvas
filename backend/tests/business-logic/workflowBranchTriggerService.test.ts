/**
 * workflowBranchTriggerService 單元測試（Phase 6A，E 區塊）
 *
 * 此檔案取代原 workflowAiDecideTriggerService.test.ts，
 * 測試新的 workflowBranchTriggerService（Branch Connection 模式）。
 *
 * Mock 邊界：
 *   - branchDecisionService.decideBranch
 *   - workflowEventEmitter 各 emit* 方法
 *   - connectionStore.updateDecideStatus / updateConnectionStatus
 *   - canvasStore.getNameById
 *   - workflowPipeline.execute
 *   - podStore.getById
 *   - logger
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowBranchTriggerService } from "../../src/services/workflow/workflowBranchTriggerService.js";
import { branchDecisionService } from "../../src/services/workflow/branchDecisionService.js";
import { workflowEventEmitter } from "../../src/services/workflow/workflowEventEmitter.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { canvasStore } from "../../src/services/canvasStore.js";
import { socketService } from "../../src/services/socketService.js";
import { workflowStateService } from "../../src/services/workflow/workflowStateService.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { workflowPipeline } from "../../src/services/workflow/workflowPipeline.js";
import { workflowMultiInputService } from "../../src/services/workflow/workflowMultiInputService.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { podStore } from "../../src/services/podStore.js";
import { logger } from "../../src/utils/logger.js";
import { abortRegistry } from "../../src/services/provider/abortRegistry.js";
import { BranchAbortError } from "../../src/services/branch/abortError.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import type { Connection } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";
import path from "path";
import { config } from "../../src/config/index.js";

// ─── 常數 ────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-branch-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";

// ─── 工廠函式 ─────────────────────────────────────────────────────────────────

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-branch-1",
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "branch",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    summaryProvider: null,
    label: "Checklist",
    description: undefined,
    branchProvider: "claude",
    branchModel: "sonnet",
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
  vi.spyOn(canvasStore, "getNameById").mockReturnValue("Branch Canvas");
  vi.spyOn(podStore, "getById").mockImplementation(((
    _cId: string,
    podId: string,
  ) => makePod(podId)) as any);
  vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);
  vi.spyOn(connectionStore, "updateDecideStatus").mockReturnValue(undefined);
  vi.spyOn(connectionStore, "updateConnectionStatus").mockReturnValue(
    undefined,
  );
  vi.spyOn(connectionStore, "getById").mockImplementation(
    (_cId: string, connId: string) =>
      ({ id: connId, connectionStatus: "idle", decideStatus: "none" }) as any,
  );
  vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
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
  vi.spyOn(workflowEventEmitter, "emitBranchTriggered").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowQueued").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowComplete").mockImplementation(
    () => {},
  );
}

// ─── 測試 ─────────────────────────────────────────────────────────────────────

describe("WorkflowBranchTriggerService", () => {
  const mockConnection = makeConnection();

  beforeEach(() => {
    setupBasicSpies();

    workflowBranchTriggerService.init({
      branchDecisionService,
      eventEmitter: workflowEventEmitter,
      connectionStore,
      canvasStore,
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
  // processBranchConnections — approved 路徑
  // ============================================================
  describe("processBranchConnections — approved 路徑", () => {
    it("branchDecisionService 選中某 connection → pipeline 走 approved，rejected connection 走 settleAndSkipPath", async () => {
      const runContext = makeRunContext();
      const conn1 = makeConnection({ id: "conn-1", label: "Checklist" });
      const conn2 = makeConnection({
        id: "conn-2",
        label: "Review",
        targetPodId: "target-pod-2",
      });

      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "selected",
        selectedConnectionId: "conn-1",
        rejectedConnectionIds: ["conn-2"],
      });

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [conn1, conn2],
        runContext,
      );

      // run mode 不更新 connection status
      expect(connectionStore.updateDecideStatus).not.toHaveBeenCalled();

      // run mode 不廣播 CONNECTION_UPDATED（由 delegate 處理狀態）
      expect(socketService.emitToCanvas).not.toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        expect.anything(),
      );

      // pipeline 走 approved
      expect(workflowPipeline.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          sourcePodId: SOURCE_POD_ID,
          connection: conn1,
          triggerMode: "branch",
        }),
        workflowBranchTriggerService,
      );
    });

    it("run mode 拒絕 direct-enabled branch 時結算 direct pathway", async () => {
      const runContext = makeRunContext();
      const selected = makeConnection({
        id: "conn-success",
        label: "success",
        targetPodId: "pod-done",
        direct: true,
      });
      const rejected = makeConnection({
        id: "conn-fail",
        label: "fail",
        targetPodId: "pod-loop-target",
        direct: true,
      });
      const settleSpy = vi
        .spyOn(runExecutionService, "settleAndSkipPath")
        .mockImplementation(() => {});

      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "selected",
        selectedConnectionId: selected.id,
        rejectedConnectionIds: [rejected.id],
      });

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [selected, rejected],
        runContext,
      );

      expect(settleSpy).toHaveBeenCalledWith(
        runContext,
        rejected.targetPodId,
        "direct",
      );
    });

    it("approved pipeline 失敗時 workflow log 使用 source-target pod 名稱", async () => {
      const conn = makeConnection({
        id: "conn-fail",
        label: "Checklist",
        targetPodId: "target-pod",
      });
      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "selected",
        selectedConnectionId: "conn-fail",
        rejectedConnectionIds: [],
      });
      vi.spyOn(workflowPipeline, "execute").mockRejectedValueOnce(
        new Error("boom"),
      );

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [conn],
        makeRunContext(),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(logger.error).toHaveBeenCalledWith(
        "Workflow",
        "Error",
        "Branch Workflow 執行失敗，連線: Pod source-pod - Pod target-pod",
        expect.any(Error),
      );
    });
  });

  // ============================================================
  // processBranchConnections — failed 路徑
  // ============================================================
  describe("processBranchConnections — failed 路徑", () => {
    it("branch 決策失敗 → run mode 走 settleAndSkipPath，不觸發 pipeline", async () => {
      const runContext = makeRunContext();
      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "failed",
        selectedConnectionId: null,
        rejectedConnectionIds: ["conn-branch-1"],
        failure: {
          kind: "provider_error",
          message: "模型服務失敗",
          attempts: [
            { attempt: 1, kind: "provider_error", message: "模型服務失敗" },
          ],
        },
      });

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
        runContext,
      );

      // run mode 不更新 connection status / decideStatus
      expect(connectionStore.updateDecideStatus).not.toHaveBeenCalled();

      // run mode 不廣播 CONNECTION_UPDATED
      expect(socketService.emitToCanvas).not.toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        expect.anything(),
      );

      expect(workflowPipeline.execute).not.toHaveBeenCalled();
    });

    it("branch 決策失敗的 workflow log 使用 canvas / source pod 名稱", async () => {
      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "failed",
        selectedConnectionId: null,
        rejectedConnectionIds: ["conn-branch-1"],
        failure: {
          kind: "provider_error",
          message: "模型服務失敗",
          attempts: [
            { attempt: 1, kind: "provider_error", message: "模型服務失敗" },
          ],
        },
      });

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
        makeRunContext(),
      );

      expect(logger.error).toHaveBeenCalledWith(
        "Workflow",
        "Error",
        "[Branch] 決策失敗，全部拒絕，canvas「Branch Canvas」 sourcePod「Pod source-pod」：模型服務失敗",
      );
    });
  });

  // ============================================================
  // processBranchConnections — abort 路徑
  // ============================================================
  describe("processBranchConnections — abort 路徑", () => {
    it("branchDecisionService 拋 BranchAbortError → run mode 透過 delegate 走 settleAndSkipPath，不觸發 pipeline", async () => {
      const runContext = makeRunContext();
      vi.spyOn(branchDecisionService, "decideBranch").mockRejectedValue(
        new BranchAbortError(),
      );

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
        runContext,
      );

      // run mode：不清回 idle（clearConnectionsDecidingStatus 在 runContext 下為 noop）
      expect(connectionStore.updateConnectionStatus).not.toHaveBeenCalled();
      expect(connectionStore.updateDecideStatus).not.toHaveBeenCalled();
      expect(workflowPipeline.execute).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // processBranchConnections — run 模式
  // ============================================================
  describe("processBranchConnections — run 模式", () => {
    it("run mode：approved connection 走 pipeline，不廣播 CONNECTION_UPDATED", async () => {
      const runContext = makeRunContext();

      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "selected",
        selectedConnectionId: "conn-branch-1",
        rejectedConnectionIds: [],
      });

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection],
        runContext,
      );

      // run mode 不廣播 CONNECTION_UPDATED
      expect(socketService.emitToCanvas).not.toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        expect.anything(),
      );

      // pipeline 仍要執行
      expect(workflowPipeline.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          sourcePodId: SOURCE_POD_ID,
          connection: mockConnection,
          triggerMode: "branch",
        }),
        workflowBranchTriggerService,
      );
    });
  });

  // ============================================================
  // decide() — 批次決策格式轉換
  // ============================================================
  describe("decide() — 批次決策格式轉換", () => {
    it("正確將 decideBranch 結果轉換為 TriggerDecideResult 格式", async () => {
      const conn1 = makeConnection({ id: "conn-1", label: "Checklist" });
      const conn2 = makeConnection({
        id: "conn-2",
        label: "Review",
        targetPodId: "target-pod-2",
      });

      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "selected",
        selectedConnectionId: "conn-1",
        rejectedConnectionIds: ["conn-2"],
      });

      const results = await workflowBranchTriggerService.decide({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connections: [conn1, conn2],
        runContext: makeRunContext(),
      });

      expect(results).toEqual([
        {
          connectionId: "conn-1",
          approved: true,
          reason: null,
          isError: false,
        },
        {
          connectionId: "conn-2",
          approved: false,
          reason: null,
          isError: false,
        },
      ]);
    });

    it("decision failed 時，所有 connection 應標記為 isError=true 並帶失敗原因", async () => {
      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "failed",
        selectedConnectionId: null,
        rejectedConnectionIds: ["conn-branch-1"],
        failure: {
          kind: "provider_error",
          message: "模型服務失敗",
          attempts: [
            { attempt: 1, kind: "provider_error", message: "模型服務失敗" },
          ],
        },
      });

      const results = await workflowBranchTriggerService.decide({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connections: [mockConnection],
        runContext: makeRunContext(),
      });

      expect(results).toEqual([
        {
          connectionId: "conn-branch-1",
          approved: false,
          reason: "錯誤：模型服務失敗",
          isError: true,
        },
      ]);
    });
  });

  // ============================================================
  // multi-input rejection 早到：shouldDeferToMultiInput 不依賴 hasPendingTarget
  // ============================================================
  describe("multi-input rejection 早到：shouldDeferToMultiInput 不依賴 hasPendingTarget（Bug A 回歸測試）", () => {
    it("hasPendingTarget=false 時，shouldDeferToMultiInput 仍依 isMultiInput=true 走 recordSourceRejection", async () => {
      // 設定 multi-input 場景
      vi.spyOn(workflowStateService, "checkMultiInputScenario").mockReturnValue(
        {
          isMultiInput: true,
          requiredSourcePodIds: [SOURCE_POD_ID, "source-pod-2"],
        },
      );

      // hasPendingTarget 回傳 false（rejection 在 initializePendingTarget 之前早到）
      vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(false);

      // recordSourceRejection 允許 lazy init（帶第四個參數 requiredSourcePodIds）
      const recordRejectionSpy = vi.spyOn(
        pendingTargetStore,
        "recordSourceRejection",
      );

      const selectedConn = makeConnection({
        id: "conn-selected",
        label: "Review",
        targetPodId: "target-pod-2",
      });

      // 選中另一條 branch，讓 multi-input connection 走 rejected
      vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
        outcome: "selected",
        selectedConnectionId: "conn-selected",
        rejectedConnectionIds: ["conn-branch-1"],
      });

      await workflowBranchTriggerService.processBranchConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [mockConnection, selectedConn],
        makeRunContext(),
      );

      // 即使 hasPendingTarget=false，仍應呼叫 recordSourceRejection（不因此跳過）
      expect(recordRejectionSpy).toHaveBeenCalledWith(
        `run-1:${TARGET_POD_ID}`,
        SOURCE_POD_ID,
        "",
        [SOURCE_POD_ID, "source-pod-2"],
      );
    });
  });
});
