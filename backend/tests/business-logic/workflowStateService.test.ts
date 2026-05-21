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
  describe("multi-input readiness rules", () => {
    it("single auto-triggerable source does not require multi-input waiting", () => {
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

    it("multiple auto-triggerable sources require multi-input waiting", () => {
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

    it("direct-only sources do not participate in auto multi-input waiting", () => {
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

    it("mixed trigger modes only count auto-triggerable sources for waiting", () => {
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

    it("target with no incoming sources has no multi-input requirements", () => {
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
  describe("direct trigger source counting rules", () => {
    it("counts only direct sources for direct merge decisions", () => {
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

    it("returns zero when all incoming sources are automatic", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        makeConnection({ id: "c1", triggerMode: "auto", sourcePodId: "src-1" }),
      ]);

      const count = workflowStateService.getDirectConnectionCount(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(count).toBe(0);
    });

    it("returns zero when the target has no incoming sources", () => {
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);

      const count = workflowStateService.getDirectConnectionCount(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(count).toBe(0);
    });

    it("does not count branch sources as direct sources", () => {
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
  describe("pending status payload rules", () => {
    it("run mode does not emit legacy canvas pending status", () => {
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

    it("target without pending state emits no pending payload", () => {
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

    it("pending payload separates completed, pending, and rejected sources", () => {
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

    it("pending payload has no pending sources after every source is completed or rejected", () => {
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

    it("pending payload reports no rejected sources when all recorded sources completed", () => {
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
  describe("source deletion state rules", () => {
    it("source deletion returns every pending target affected by that source", () => {
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

    it("source deletion returns no affected targets when no pending target uses it", () => {
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

    it("source deletion clears target pending state when no required sources remain", () => {
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

    it("source deletion reevaluates each affected target independently", () => {
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
  describe("connection deletion state rules", () => {
    it("missing connection deletion leaves pending state unchanged", () => {
      vi.spyOn(connectionStore, "getById").mockReturnValue(undefined);
      const hasDirectSpy = vi.spyOn(directTriggerStore, "hasDirectPending");
      const hasPendingSpy = vi.spyOn(pendingTargetStore, "hasPendingTarget");

      workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

      expect(hasDirectSpy).not.toHaveBeenCalled();
      expect(hasPendingSpy).not.toHaveBeenCalled();
    });

    describe("direct connection deletion", () => {
      const directConnection = makeConnection({
        id: CONNECTION_ID,
        triggerMode: "direct",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
      });

      it("clears direct pending state and cancels the waiting resolver", () => {
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

      it("still cancels the waiting resolver when no direct pending state exists", () => {
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

      it("does not alter auto multi-input pending state", () => {
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

    describe("auto-triggerable connection deletion", () => {
      const autoConnection = makeConnection({
        id: CONNECTION_ID,
        triggerMode: "auto",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
      });

      it("removes the deleted source from the target pending state", () => {
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

      it("leaves state unchanged when the target has no pending state", () => {
        vi.spyOn(connectionStore, "getById").mockReturnValue(autoConnection);
        vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(false);
        const removeFromPendingSpy = vi.spyOn(
          pendingTargetStore,
          "removeSourceFromPending",
        );

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(removeFromPendingSpy).not.toHaveBeenCalled();
      });

      it("branch source is removed through the auto-triggerable pending path", () => {
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

      it("clears pending state when deleting the source leaves no remaining sources", () => {
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

    describe("non-triggerable connection deletion", () => {
      it("ignores unsupported trigger modes without touching direct or pending state", () => {
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
