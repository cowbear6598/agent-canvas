import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { workflowStateService } from "../../src/services/workflow/workflowStateService.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { socketService } from "../../src/services/socketService.js";
import { logger } from "../../src/utils/logger.js";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import type { AnchorPosition, Connection, TriggerMode } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";

const CANVAS_ID = "canvas-workflow-state";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";
const CONNECTION_ID = "conn-manual";

function insertCanvas(): void {
  getDb()
    .prepare("INSERT INTO canvases (id, name, sort_index) VALUES (?, ?, ?)")
    .run(CANVAS_ID, "workflow-state-canvas", 0);
}

function createConnection(
  triggerMode: TriggerMode,
  overrides?: Partial<Connection>,
): Connection {
  return connectionStore.create(CANVAS_ID, {
    sourcePodId: overrides?.sourcePodId ?? SOURCE_POD_ID,
    sourceAnchor: overrides?.sourceAnchor ?? "right",
    targetPodId: overrides?.targetPodId ?? TARGET_POD_ID,
    targetAnchor: overrides?.targetAnchor ?? "left",
    triggerMode,
    label:
      triggerMode === "branch" ? (overrides?.label ?? "Branch") : undefined,
    branchProvider: triggerMode === "branch" ? "claude" : undefined,
    branchModel: triggerMode === "branch" ? "sonnet" : undefined,
  });
}

function insertRawConnection(overrides: {
  id: string;
  sourcePodId: string;
  targetPodId: string;
  triggerMode: string;
  sourceAnchor?: AnchorPosition;
  targetAnchor?: AnchorPosition;
}): void {
  getDb()
    .prepare(
      `INSERT INTO connections (
        id, canvas_id, source_pod_id, source_anchor, target_pod_id,
        target_anchor, trigger_mode, decide_status, decide_reason,
        connection_status, summary_model, summary_provider, label,
        description, branch_provider, branch_model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'none', NULL, 'idle', 'sonnet', NULL, '', NULL, NULL, NULL)`,
    )
    .run(
      overrides.id,
      CANVAS_ID,
      overrides.sourcePodId,
      overrides.sourceAnchor ?? "right",
      overrides.targetPodId,
      overrides.targetAnchor ?? "left",
      overrides.triggerMode,
    );
}

function makeRunContext(): RunContext {
  return {
    runId: "run-1",
    canvasId: CANVAS_ID,
    triggeredBy: "user",
  } as RunContext;
}

function resetPendingTargets(): void {
  [TARGET_POD_ID, "t1", "t2", "t3", "target-without-pending"].forEach(
    (targetPodId) => {
      pendingTargetStore.clearPendingTarget(targetPodId);
    },
  );
}

describe("WorkflowStateService", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    resetPendingTargets();
  });

  afterEach(() => {
    resetPendingTargets();
    vi.restoreAllMocks();
    closeDb();
  });

  describe("multi-input readiness rules", () => {
    it("single auto-triggerable source does not require multi-input waiting", () => {
      createConnection("auto", { id: "c1", sourcePodId: "src-1" });

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(false);
      expect(result.requiredSourcePodIds).toEqual(["src-1"]);
    });

    it("multiple auto-triggerable sources require multi-input waiting", () => {
      createConnection("auto", { sourcePodId: "src-1" });
      createConnection("branch", { sourcePodId: "src-2", label: "Beta" });

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(true);
      expect(result.requiredSourcePodIds).toEqual(["src-1", "src-2"]);
    });

    it("direct-only sources do not participate in auto multi-input waiting", () => {
      createConnection("direct", { sourcePodId: "src-1" });
      createConnection("direct", { sourcePodId: "src-2" });

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(false);
      expect(result.requiredSourcePodIds).toEqual([]);
    });

    it("mixed trigger modes only count auto-triggerable sources for waiting", () => {
      createConnection("auto", { sourcePodId: "src-1" });
      createConnection("direct", { sourcePodId: "src-2" });
      createConnection("branch", { sourcePodId: "src-3", label: "Gamma" });

      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(result.isMultiInput).toBe(true);
      expect(result.requiredSourcePodIds).toEqual(["src-1", "src-3"]);
    });

    it("target with no incoming sources has no multi-input requirements", () => {
      const result = workflowStateService.checkMultiInputScenario(
        CANVAS_ID,
        "target-without-pending",
      );

      expect(result.isMultiInput).toBe(false);
      expect(result.requiredSourcePodIds).toEqual([]);
    });
  });

  describe("pending status payload rules", () => {
    it("run mode does not emit legacy canvas pending status", () => {
      workflowStateService.emitPendingStatus(
        CANVAS_ID,
        TARGET_POD_ID,
        makeRunContext(),
      );

      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it("target without pending state emits no pending payload", () => {
      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it("pending payload separates completed, pending, and rejected sources", () => {
      pendingTargetStore.recordSourceCompletion(
        TARGET_POD_ID,
        "src-1",
        "Summary 1",
        ["src-1", "src-2", "src-3"],
      );
      pendingTargetStore.recordSourceRejection(TARGET_POD_ID, "src-3", "無關");

      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.WORKFLOW_PENDING,
        {
          canvasId: CANVAS_ID,
          targetPodId: TARGET_POD_ID,
          completedSourcePodIds: ["src-1"],
          pendingSourcePodIds: ["src-2"],
          totalSources: 3,
          completedCount: 1,
          rejectedSourcePodIds: ["src-3"],
          hasRejectedSources: true,
        },
      );
    });

    it("pending payload has no pending sources after every source is completed or rejected", () => {
      pendingTargetStore.recordSourceCompletion(
        TARGET_POD_ID,
        "src-1",
        "Summary 1",
        ["src-1", "src-2"],
      );
      pendingTargetStore.recordSourceRejection(
        TARGET_POD_ID,
        "src-2",
        "Rejected",
      );

      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.WORKFLOW_PENDING,
        expect.objectContaining({
          pendingSourcePodIds: [],
          hasRejectedSources: true,
        }),
      );
    });

    it("pending payload reports no rejected sources when all recorded sources completed", () => {
      pendingTargetStore.recordSourceCompletion(
        TARGET_POD_ID,
        "src-1",
        "Summary 1",
        ["src-1", "src-2"],
      );

      workflowStateService.emitPendingStatus(CANVAS_ID, TARGET_POD_ID);

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.WORKFLOW_PENDING,
        expect.objectContaining({
          rejectedSourcePodIds: [],
          hasRejectedSources: false,
        }),
      );
    });
  });

  describe("source deletion state rules", () => {
    it("source deletion returns every pending target affected by that source", () => {
      pendingTargetStore.initializePendingTarget("t1", [
        SOURCE_POD_ID,
        "src-2",
      ]);
      pendingTargetStore.initializePendingTarget("t2", [SOURCE_POD_ID]);

      const result = workflowStateService.handleSourceDeletion(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(result).toEqual(["t1", "t2"]);
      expect(
        pendingTargetStore.getPendingTarget("t1")?.requiredSourcePodIds,
      ).toEqual(["src-2"]);
      expect(pendingTargetStore.getPendingTarget("t2")).toBeUndefined();
    });

    it("source deletion returns no affected targets when no pending target uses it", () => {
      pendingTargetStore.initializePendingTarget("t1", ["other-source"]);

      const result = workflowStateService.handleSourceDeletion(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(result).toEqual([]);
      expect(
        pendingTargetStore.getPendingTarget("t1")?.requiredSourcePodIds,
      ).toEqual(["other-source"]);
    });

    it("source deletion clears target pending state when no required sources remain", () => {
      pendingTargetStore.initializePendingTarget("t1", [SOURCE_POD_ID]);

      workflowStateService.handleSourceDeletion(CANVAS_ID, SOURCE_POD_ID);

      expect(pendingTargetStore.getPendingTarget("t1")).toBeUndefined();
    });

    it("source deletion reevaluates each affected target independently", () => {
      pendingTargetStore.initializePendingTarget("t1", [
        SOURCE_POD_ID,
        "src-2",
      ]);
      pendingTargetStore.initializePendingTarget("t2", [SOURCE_POD_ID]);
      pendingTargetStore.initializePendingTarget("t3", [
        SOURCE_POD_ID,
        "src-3",
      ]);

      const result = workflowStateService.handleSourceDeletion(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(result).toEqual(["t1", "t2", "t3"]);
      expect(
        pendingTargetStore.getPendingTarget("t1")?.requiredSourcePodIds,
      ).toEqual(["src-2"]);
      expect(pendingTargetStore.getPendingTarget("t2")).toBeUndefined();
      expect(
        pendingTargetStore.getPendingTarget("t3")?.requiredSourcePodIds,
      ).toEqual(["src-3"]);
    });
  });

  describe("connection deletion state rules", () => {
    it("missing connection deletion leaves pending state unchanged", () => {
      pendingTargetStore.initializePendingTarget(TARGET_POD_ID, [
        SOURCE_POD_ID,
      ]);

      workflowStateService.handleConnectionDeletion(CANVAS_ID, "missing-id");

      expect(pendingTargetStore.getPendingTarget(TARGET_POD_ID)).toBeDefined();
    });

    describe("direct connection deletion", () => {
      it("does not alter auto multi-input pending state", () => {
        const directConnection = createConnection("direct");
        pendingTargetStore.recordSourceCompletion(
          TARGET_POD_ID,
          "auto-source",
          "Auto summary",
          ["auto-source", "other-auto-source"],
        );

        workflowStateService.handleConnectionDeletion(
          CANVAS_ID,
          directConnection.id,
        );

        const pending = pendingTargetStore.getPendingTarget(TARGET_POD_ID);
        expect(pending?.requiredSourcePodIds).toEqual([
          "auto-source",
          "other-auto-source",
        ]);
        expect(pending?.completedSources.get("auto-source")).toBe(
          "Auto summary",
        );
      });
    });

    describe("auto-triggerable connection deletion", () => {
      it("removes the deleted source from the target pending state", () => {
        const autoConnection = createConnection("auto");
        pendingTargetStore.initializePendingTarget(TARGET_POD_ID, [
          SOURCE_POD_ID,
          "other-source",
        ]);

        workflowStateService.handleConnectionDeletion(
          CANVAS_ID,
          autoConnection.id,
        );

        expect(
          pendingTargetStore.getPendingTarget(TARGET_POD_ID)
            ?.requiredSourcePodIds,
        ).toEqual(["other-source"]);
      });

      it("leaves state unchanged when the target has no pending state", () => {
        const autoConnection = createConnection("auto");

        workflowStateService.handleConnectionDeletion(
          CANVAS_ID,
          autoConnection.id,
        );

        expect(
          pendingTargetStore.getPendingTarget(TARGET_POD_ID),
        ).toBeUndefined();
      });

      it("branch source is removed through the auto-triggerable pending path", () => {
        const branchConnection = createConnection("branch", {
          label: "Branch",
        });
        pendingTargetStore.initializePendingTarget(TARGET_POD_ID, [
          SOURCE_POD_ID,
          "other-source",
        ]);

        workflowStateService.handleConnectionDeletion(
          CANVAS_ID,
          branchConnection.id,
        );

        expect(
          pendingTargetStore.getPendingTarget(TARGET_POD_ID)
            ?.requiredSourcePodIds,
        ).toEqual(["other-source"]);
      });

      it("clears pending state when deleting the source leaves no remaining sources", () => {
        const autoConnection = createConnection("auto");
        pendingTargetStore.initializePendingTarget(TARGET_POD_ID, [
          SOURCE_POD_ID,
        ]);

        workflowStateService.handleConnectionDeletion(
          CANVAS_ID,
          autoConnection.id,
        );

        expect(
          pendingTargetStore.getPendingTarget(TARGET_POD_ID),
        ).toBeUndefined();
      });
    });

    describe("non-triggerable connection deletion", () => {
      it("ignores unsupported trigger modes without touching pending state", () => {
        insertRawConnection({
          id: CONNECTION_ID,
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
          triggerMode: "manual",
        });
        pendingTargetStore.initializePendingTarget(TARGET_POD_ID, [
          SOURCE_POD_ID,
        ]);

        workflowStateService.handleConnectionDeletion(CANVAS_ID, CONNECTION_ID);

        expect(
          pendingTargetStore.getPendingTarget(TARGET_POD_ID)
            ?.requiredSourcePodIds,
        ).toEqual([SOURCE_POD_ID]);
      });
    });
  });
});
