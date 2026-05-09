import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { workflowStateService } from "../../src/services/workflow/workflowStateService.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { directTriggerStore } from "../../src/services/directTriggerStore.js";
import { workflowEventEmitter } from "../../src/services/workflow/workflowEventEmitter.js";
import { workflowDirectTriggerService } from "../../src/services/workflow/workflowDirectTriggerService.js";
import { logger } from "../../src/utils/logger.js";
import type { Connection } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";

// ─── 常數（取代 TEST_IDS 工廠引用）─────────────────────────────────────────

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";
const CONNECTION_ID = "conn-1";

// ─── 工廠函式（取代 createMockConnection 工廠引用）───────────────────────────

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

function makeRunContext(): RunContext {
  return {
    runId: "run-1",
    canvasId: CANVAS_ID,
    triggeredBy: "user",
  } as RunContext;
}

describe("WorkflowStateService", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // checkMultiInputScenario
  // ============================================================
  describe("checkMultiInputScenario", () => {
    it("只有一條 auto-triggerable 連線時 isMultiInput 為 false", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({ id: "c1", triggerMode: "auto", sourcePodId: "src-1" }),
      ]);

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(false);
      expect(result.requiredSourcePodIds).toEqual(["src-1"]);
    });

    it("有多條 auto-triggerable 連線時 isMultiInput 為 true", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({ id: "c1", triggerMode: "auto", sourcePodId: "src-1" }),
        makeConnection({
          id: "c2",
          triggerMode: "branch",
          sourcePodId: "src-2",
        }),
      ]);

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(true);
      expect(result.requiredSourcePodIds).toEqual(["src-1", "src-2"]);
    });

    it("只有 direct 連線時 isMultiInput 為 false，requiredSourcePodIds 為空", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({
          id: "c1",
          triggerMode: "direct",
          sourcePodId: "src-1",
        }),
        makeConnection({
          id: "c2",
          triggerMode: "direct",
          sourcePodId: "src-2",
        }),
      ]);

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(false);
      expect(result.requiredSourcePodIds).toEqual([]);
    });

    it("混合 triggerMode 時只計算 auto-triggerable 的連線", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({ id: "c1", triggerMode: "auto", sourcePodId: "src-1" }),
        makeConnection({
          id: "c2",
          triggerMode: "direct",
          sourcePodId: "src-2",
        }),
        makeConnection({
          id: "c3",
          triggerMode: "branch",
          sourcePodId: "src-3",
        }),
      ]);

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(true);
      expect(result.requiredSourcePodIds).toEqual(["src-1", "src-3"]);
    });

    it("沒有任何連線時 isMultiInput 為 false，requiredSourcePodIds 為空", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(false);
      expect(result.requiredSourcePodIds).toEqual([]);
    });
  });

  // ============================================================
  // getDirectConnectionCount
  // ============================================================
  describe("getDirectConnectionCount", () => {
    it("正確計算 direct 連線數量", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({
          id: "c1",
          triggerMode: "direct",
          sourcePodId: "src-1",
        }),
        makeConnection({
          id: "c2",
          triggerMode: "direct",
          sourcePodId: "src-2",
        }),
        makeConnection({ id: "c3", triggerMode: "auto", sourcePodId: "src-3" }),
      ]);

      const count = workflowStateService.getDirectConnectionCount(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(count).toBe(2);
    });

    it("沒有 direct 連線時回傳 0", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({ id: "c1", triggerMode: "auto", sourcePodId: "src-1" }),
      ]);

      const count = workflowStateService.getDirectConnectionCount(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(count).toBe(0);
    });

    it("沒有任何連線時回傳 0", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);

      const count = workflowStateService.getDirectConnectionCount(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(count).toBe(0);
    });

    it("不計算 branch 連線（branch 走 auto-triggerable，不算 direct）", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({
          id: "c1",
          triggerMode: "branch",
          sourcePodId: "src-1",
        }),
        makeConnection({
          id: "c2",
          triggerMode: "direct",
          sourcePodId: "src-2",
        }),
      ]);

      const count = workflowStateService.getDirectConnectionCount(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(count).toBe(1);
    });
  });

  // ============================================================
  // emitPendingStatus
  // ============================================================
  describe("emitPendingStatus", () => {
    it("有 runContext 時直接 return，不呼叫任何 store/emitter", () => {
      const runContext = makeRunContext();
      const getPendingSpy = vi.spyOn(pendingTargetStore, "getPendingTarget");
      const emitSpy = vi.spyOn(workflowEventEmitter, "emitWorkflowPending");

      workflowStateService.emitPendingStatus(
        CANVAS_ID,
        TARGET_POD_ID,
        runContext,
      );

      expect(getPendingSpy).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("pending 不存在時直接 return，不觸發 emitWorkflowPending", () => {
      vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(
        undefined,
      );
      const emitSpy = vi.spyOn(workflowEventEmitter, "emitWorkflowPending");

      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      expect(pendingTargetStore.getPendingTarget).toHaveBeenCalledWith(
        TARGET_POD_ID,
      );
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("pending 存在時正確組裝 payload 並觸發 emitWorkflowPending", () => {
      const mockPending = {
        requiredSourcePodIds: ["src-1", "src-2", "src-3"],
        completedSources: new Map([["src-1", "Summary 1"]]),
        rejectedSources: new Map([["src-3", "無關"]]),
      };
      vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(
        mockPending as any,
      );
      const emitSpy = vi
        .spyOn(workflowEventEmitter, "emitWorkflowPending")
        .mockImplementation(() => {});

      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      expect(emitSpy).toHaveBeenCalledWith(CANVAS_ID, {
        canvasId: CANVAS_ID,
        targetPodId: TARGET_POD_ID,
        completedSourcePodIds: ["src-1"],
        pendingSourcePodIds: ["src-2"],
        totalSources: 3,
        completedCount: 1,
        rejectedSourcePodIds: ["src-3"],
        hasRejectedSources: true,
      });
    });

    it("所有來源都已完成或拒絕時 pendingSourcePodIds 為空", () => {
      const mockPending = {
        requiredSourcePodIds: ["src-1", "src-2"],
        completedSources: new Map([["src-1", "Summary 1"]]),
        rejectedSources: new Map([["src-2", "Rejected"]]),
      };
      vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(
        mockPending as any,
      );
      const emitSpy = vi
        .spyOn(workflowEventEmitter, "emitWorkflowPending")
        .mockImplementation(() => {});

      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      const payload = emitSpy.mock.calls[0][1];
      expect(payload.pendingSourcePodIds).toEqual([]);
      expect(payload.hasRejectedSources).toBe(true);
    });

    it("沒有任何 rejection 時 hasRejectedSources 為 false", () => {
      const mockPending = {
        requiredSourcePodIds: ["src-1", "src-2"],
        completedSources: new Map([["src-1", "Summary 1"]]),
        rejectedSources: new Map(),
      };
      vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(
        mockPending as any,
      );
      const emitSpy = vi
        .spyOn(workflowEventEmitter, "emitWorkflowPending")
        .mockImplementation(() => {});

      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      const payload = emitSpy.mock.calls[0][1];
      expect(payload.hasRejectedSources).toBe(false);
      expect(payload.rejectedSourcePodIds).toEqual([]);
    });
  });

  // ============================================================
  // handleSourceDeletion
  // ============================================================
  describe("handleSourceDeletion", () => {
    it("呼叫 removeSourceFromAllPending 並回傳受影響的 targetIds", () => {
      vi.spyOn(
        pendingTargetStore,
        "removeSourceFromAllPending",
      ).mockReturnValue(["t1", "t2"]);
      // processAffectedTarget 內部會呼叫 tryCompletePendingOrClear
      // 讓 getPendingTarget 回傳 undefined 來使 tryCompletePendingOrClear 快速 return
      vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(
        undefined,
      );

      const result = workflowStateService.handleSourceDeletion(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(
        pendingTargetStore.removeSourceFromAllPending,
      ).toHaveBeenCalledWith(SOURCE_POD_ID);
      expect(result).toEqual(["t1", "t2"]);
    });

    it("沒有受影響的 target 時回傳空陣列", () => {
      vi.spyOn(
        pendingTargetStore,
        "removeSourceFromAllPending",
      ).mockReturnValue([]);

      const result = workflowStateService.handleSourceDeletion(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(result).toEqual([]);
    });

    it("受影響 target 的 pending 無剩餘來源時清除 pending", () => {
      vi.spyOn(
        pendingTargetStore,
        "removeSourceFromAllPending",
      ).mockReturnValue(["t1"]);
      vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue({
        requiredSourcePodIds: [],
        completedSources: new Map(),
        rejectedSources: new Map(),
      } as any);
      const clearSpy = vi
        .spyOn(pendingTargetStore, "clearPendingTarget")
        .mockImplementation(() => {});

      workflowStateService.handleSourceDeletion(CANVAS_ID, SOURCE_POD_ID);

      expect(clearSpy).toHaveBeenCalledWith("t1");
    });

    it("多個受影響 target 時逐一處理", () => {
      vi.spyOn(
        pendingTargetStore,
        "removeSourceFromAllPending",
      ).mockReturnValue(["t1", "t2", "t3"]);
      const getPendingSpy = vi
        .spyOn(pendingTargetStore, "getPendingTarget")
        .mockReturnValue(undefined);

      workflowStateService.handleSourceDeletion(CANVAS_ID, SOURCE_POD_ID);

      // getPendingTarget 被呼叫了 3 次（每個 target 各一次）
      expect(getPendingSpy).toHaveBeenCalledTimes(3);
      expect(getPendingSpy).toHaveBeenCalledWith("t1");
      expect(getPendingSpy).toHaveBeenCalledWith("t2");
      expect(getPendingSpy).toHaveBeenCalledWith("t3");
    });
  });

  // ============================================================
  // handleConnectionDeletion
  // ============================================================
  describe("handleConnectionDeletion", () => {
    it("connectionStore 找不到連線時直接 return", () => {
      vi.spyOn(connectionStore, "getById").mockReturnValue(undefined);
      const hasDirectSpy = vi.spyOn(directTriggerStore, "hasDirectPending");
      const hasPendingSpy = vi.spyOn(pendingTargetStore, "hasPendingTarget");

      workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

      expect(hasDirectSpy).not.toHaveBeenCalled();
      expect(hasPendingSpy).not.toHaveBeenCalled();
    });

    describe("triggerMode 為 direct 時", () => {
      const directConnection = makeConnection({
        id: CONNECTION_ID,
        triggerMode: "direct",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
      });

      it("有 directPending 時清除並取消 resolver", () => {
        vi.spyOn(connectionStore, "getById").mockReturnValue(directConnection);
        vi.spyOn(directTriggerStore, "hasDirectPending").mockReturnValue(true);
        const clearSpy = vi
          .spyOn(directTriggerStore, "clearDirectPending")
          .mockImplementation(() => {});
        const cancelSpy = vi
          .spyOn(workflowDirectTriggerService, "cancelPendingResolver")
          .mockImplementation(() => {});

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(clearSpy).toHaveBeenCalledWith(TARGET_POD_ID);
        expect(cancelSpy).toHaveBeenCalledWith(TARGET_POD_ID);
      });

      it("沒有 directPending 時不清除但仍取消 resolver", () => {
        vi.spyOn(connectionStore, "getById").mockReturnValue(directConnection);
        vi.spyOn(directTriggerStore, "hasDirectPending").mockReturnValue(false);
        const clearSpy = vi
          .spyOn(directTriggerStore, "clearDirectPending")
          .mockImplementation(() => {});
        const cancelSpy = vi
          .spyOn(workflowDirectTriggerService, "cancelPendingResolver")
          .mockImplementation(() => {});

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(clearSpy).not.toHaveBeenCalled();
        expect(cancelSpy).toHaveBeenCalledWith(TARGET_POD_ID);
      });

      it("不觸發 multi-input 相關邏輯", () => {
        vi.spyOn(connectionStore, "getById").mockReturnValue(directConnection);
        vi.spyOn(directTriggerStore, "hasDirectPending").mockReturnValue(false);
        vi.spyOn(
          workflowDirectTriggerService,
          "cancelPendingResolver",
        ).mockImplementation(() => {});
        const hasPendingSpy = vi.spyOn(pendingTargetStore, "hasPendingTarget");
        const removeFromPendingSpy = vi.spyOn(
          pendingTargetStore,
          "removeSourceFromPending",
        );

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(hasPendingSpy).not.toHaveBeenCalled();
        expect(removeFromPendingSpy).not.toHaveBeenCalled();
      });
    });

    describe("triggerMode 為 auto-triggerable 時", () => {
      const autoConnection = makeConnection({
        id: CONNECTION_ID,
        triggerMode: "auto",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
      });

      it("有 pendingTarget 時移除來源", () => {
        vi.spyOn(connectionStore, "getById").mockReturnValue(autoConnection);
        vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(true);
        // tryCompletePendingOrClear 內部呼叫
        vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(
          undefined,
        );
        const removeFromPendingSpy = vi
          .spyOn(pendingTargetStore, "removeSourceFromPending")
          .mockImplementation(() => {});

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(removeFromPendingSpy).toHaveBeenCalledWith(
          TARGET_POD_ID,
          SOURCE_POD_ID,
        );
      });

      it("沒有 pendingTarget 時不做任何操作", () => {
        vi.spyOn(connectionStore, "getById").mockReturnValue(autoConnection);
        vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(false);
        const removeFromPendingSpy = vi.spyOn(
          pendingTargetStore,
          "removeSourceFromPending",
        );

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(removeFromPendingSpy).not.toHaveBeenCalled();
      });

      it("branch 連線也走 auto-triggerable 分支", () => {
        const aiDecideConnection = makeConnection({
          id: CONNECTION_ID,
          triggerMode: "branch",
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
        });
        vi.spyOn(connectionStore, "getById").mockReturnValue(
          aiDecideConnection,
        );
        vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(true);
        vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(
          undefined,
        );
        const removeFromPendingSpy = vi
          .spyOn(pendingTargetStore, "removeSourceFromPending")
          .mockImplementation(() => {});

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(removeFromPendingSpy).toHaveBeenCalledWith(
          TARGET_POD_ID,
          SOURCE_POD_ID,
        );
      });

      it("移除來源後若無剩餘來源則清除 pending", () => {
        vi.spyOn(connectionStore, "getById").mockReturnValue(autoConnection);
        vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(true);
        vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue({
          requiredSourcePodIds: [],
          completedSources: new Map(),
          rejectedSources: new Map(),
        } as any);
        vi.spyOn(
          pendingTargetStore,
          "removeSourceFromPending",
        ).mockImplementation(() => {});
        const clearSpy = vi
          .spyOn(pendingTargetStore, "clearPendingTarget")
          .mockImplementation(() => {});

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(clearSpy).toHaveBeenCalledWith(TARGET_POD_ID);
      });
    });

    describe("其他非 auto-triggerable triggerMode 時", () => {
      it("不觸發 direct 也不觸發 multi-input 邏輯，直接 return", () => {
        const manualConnection = makeConnection({
          id: CONNECTION_ID,
          triggerMode: "manual" as any,
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
        });
        vi.spyOn(connectionStore, "getById").mockReturnValue(manualConnection);
        const hasDirectSpy = vi.spyOn(directTriggerStore, "hasDirectPending");
        const hasPendingSpy = vi.spyOn(pendingTargetStore, "hasPendingTarget");
        const removeFromPendingSpy = vi.spyOn(
          pendingTargetStore,
          "removeSourceFromPending",
        );

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(hasDirectSpy).not.toHaveBeenCalled();
        expect(hasPendingSpy).not.toHaveBeenCalled();
        expect(removeFromPendingSpy).not.toHaveBeenCalled();
      });
    });
  });
});
