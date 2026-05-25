import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowDirectTriggerService } from "../../src/services/workflow/workflowDirectTriggerService.js";
import { workflowStateService } from "../../src/services/workflow/workflowStateService.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { socketService } from "../../src/services/socketService.js";
import { logger } from "../../src/utils/logger.js";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import type { Connection } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";

const CANVAS_ID = "canvas-direct-flow";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";
const TEST_SUMMARY = "Test summary content";

function insertCanvas(): void {
  getDb()
    .prepare("INSERT INTO canvases (id, name, sort_index) VALUES (?, ?, ?)")
    .run(CANVAS_ID, "direct-flow-canvas", 0);
}

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "run-1",
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    ...overrides,
  };
}

function createDirectConnection(overrides?: Partial<Connection>): Connection {
  return connectionStore.create(CANVAS_ID, {
    sourcePodId: overrides?.sourcePodId ?? SOURCE_POD_ID,
    sourceAnchor: overrides?.sourceAnchor ?? "right",
    targetPodId: overrides?.targetPodId ?? TARGET_POD_ID,
    targetAnchor: overrides?.targetAnchor ?? "left",
    triggerMode: "direct",
    summaryModel: overrides?.summaryModel,
  });
}

describe("Direct Trigger Flow", () => {
  const testRunContext = makeRunContext();

  beforeEach(() => {
    resetStatements();
    initTestDb();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    pendingTargetStore.clearPendingTarget(TARGET_POD_ID);
  });

  afterEach(() => {
    pendingTargetStore.clearPendingTarget(TARGET_POD_ID);
    vi.restoreAllMocks();
    closeDb();
  });

  describe("Multi-direct 每條 ready Direct 形成獨立項目", () => {
    it("collectSources 不等待合併，回傳目前 connection 作為唯一參與連線", async () => {
      const connAD = createDirectConnection({
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = createDirectConnection({
        sourcePodId: "source-pod-B",
      });
      const connCD = createDirectConnection({
        sourcePodId: "source-pod-C",
      });

      const [resultA, resultB, resultC] = await Promise.all([
        workflowDirectTriggerService.collectSources({
          canvasId: CANVAS_ID,
          sourcePodId: SOURCE_POD_ID,
          connection: connAD,
          summary: TEST_SUMMARY,
          runContext: testRunContext,
        }),
        workflowDirectTriggerService.collectSources({
          canvasId: CANVAS_ID,
          sourcePodId: "source-pod-B",
          connection: connBD,
          summary: "Summary from B",
          runContext: testRunContext,
        }),
        workflowDirectTriggerService.collectSources({
          canvasId: CANVAS_ID,
          sourcePodId: "source-pod-C",
          connection: connCD,
          summary: "Summary from C",
          runContext: testRunContext,
        }),
      ]);

      expect(resultA).toEqual({
        ready: true,
        participatingConnectionIds: [connAD.id],
      });
      expect(resultB).toEqual({
        ready: true,
        participatingConnectionIds: [connBD.id],
      });
      expect(resultC).toEqual({
        ready: true,
        participatingConnectionIds: [connCD.id],
      });
    });
  });

  describe("lifecycle hooks onTrigger 只對參與的 connections 發出事件", () => {
    it("run mode 單源觸發時，onTrigger 不應更新全域 connection 事件", () => {
      const connAD = createDirectConnection({ sourcePodId: SOURCE_POD_ID });
      createDirectConnection({ sourcePodId: "source-pod-B" });

      workflowDirectTriggerService.onTrigger({
        canvasId: CANVAS_ID,
        connectionId: connAD.id,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        summary: TEST_SUMMARY,
        isSummarized: true,
        participatingConnectionIds: [connAD.id],
        runContext: testRunContext,
      });

      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });
  });

  describe("lifecycle hooks onComplete / onQueued 只對參與的 connections 作用", () => {
    it("run mode onComplete 不應更新全域 connection 狀態或發出 complete 事件", () => {
      const connAD = createDirectConnection({ sourcePodId: SOURCE_POD_ID });
      const connBD = createDirectConnection({ sourcePodId: "source-pod-B" });

      workflowDirectTriggerService.onComplete(
        {
          canvasId: CANVAS_ID,
          connectionId: connAD.id,
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
          triggerMode: "direct",
          participatingConnectionIds: [connAD.id],
          runContext: testRunContext,
        },
        true,
      );

      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
      expect(
        connectionStore.getById(CANVAS_ID, connAD.id)?.connectionStatus,
      ).toBe("idle");
      expect(
        connectionStore.getById(CANVAS_ID, connBD.id)?.connectionStatus,
      ).toBe("idle");
    });

    it("run mode onQueued 不應更新全域 connection 狀態或發出 queued 事件", () => {
      const connAD = createDirectConnection({ sourcePodId: SOURCE_POD_ID });
      const connBD = createDirectConnection({ sourcePodId: "source-pod-B" });

      workflowDirectTriggerService.onQueued({
        canvasId: CANVAS_ID,
        connectionId: connAD.id,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        position: 1,
        queueSize: 1,
        triggerMode: "direct",
        participatingConnectionIds: [connAD.id],
        runContext: testRunContext,
      });

      expect(socketService.emitToCanvas).not.toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.WORKFLOW_QUEUED,
        expect.anything(),
      );
      expect(
        connectionStore.getById(CANVAS_ID, connAD.id)?.connectionStatus,
      ).toBe("idle");
      expect(
        connectionStore.getById(CANVAS_ID, connBD.id)?.connectionStatus,
      ).toBe("idle");
    });
  });

  describe("direct connection deletion", () => {
    it("刪除 Direct 連線不應觸碰既有 auto multi-input pending state", () => {
      const directConnection = createDirectConnection({
        sourcePodId: "source-pod-direct",
      });
      const requiredAutoSourcePodIds = [
        "source-pod-auto-A",
        "source-pod-auto-B",
      ];

      pendingTargetStore.recordSourceCompletion(
        TARGET_POD_ID,
        "source-pod-auto-A",
        "Auto summary A",
        requiredAutoSourcePodIds,
      );

      workflowStateService.handleConnectionDeletion(
        CANVAS_ID,
        directConnection.id,
      );

      const pending = pendingTargetStore.getPendingTarget(TARGET_POD_ID);
      expect(pending?.requiredSourcePodIds).toEqual(requiredAutoSourcePodIds);
      expect(pending?.completedSources.get("source-pod-auto-A")).toBe(
        "Auto summary A",
      );
    });
  });
});
