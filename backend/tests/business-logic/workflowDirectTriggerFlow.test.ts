import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowDirectTriggerService } from "../../src/services/workflow/workflowDirectTriggerService.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { workflowEventEmitter } from "../../src/services/workflow";
import { summaryService } from "../../src/services/summaryService.js";
import { logger } from "../../src/utils/logger.js";
import type { Connection } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";

// ─── 常數 ────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";
const TEST_SUMMARY = "Test summary content";

// ─── 工廠函式 ─────────────────────────────────────────────────────────────────

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "run-1",
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    ...overrides,
  };
}

const testRunContext = makeRunContext();

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-direct-1",
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "direct",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    aiDecideModel: "sonnet",
    ...overrides,
  } as Connection;
}

// ─── 共用 spy setup ───────────────────────────────────────────────────────────

function setupBasicSpies(conn: Connection) {
  vi.spyOn(logger, "log").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
  vi.spyOn(summaryService, "generateSummaryForTarget").mockResolvedValue({
    success: true,
    summary: TEST_SUMMARY,
    targetPodId: TARGET_POD_ID,
  });
  vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([conn]);
  vi.spyOn(connectionStore, "getById").mockReturnValue(conn);
  vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([conn]);
  vi.spyOn(connectionStore, "updateConnectionStatus").mockReturnValue(
    undefined,
  );
  vi.spyOn(connectionStore, "updateDecideStatus").mockReturnValue(undefined);
  // workflowEventEmitter spies
  vi.spyOn(workflowEventEmitter, "emitDirectTriggered").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitDirectWaiting").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitDirectMerged").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowComplete").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowQueued").mockImplementation(
    () => {},
  );
  vi.spyOn(
    workflowEventEmitter,
    "emitWorkflowAutoTriggered",
  ).mockImplementation(() => {});
}

describe("Direct Trigger Flow", () => {
  const mockDirectConnection = makeConnection();

  beforeEach(() => {
    setupBasicSpies(mockDirectConnection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("B1: Multi-direct - 每條 ready Direct 形成獨立項目", () => {
    it("collectSources 不等待合併，回傳目前 connection 作為唯一參與連線", async () => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      const resultA = await workflowDirectTriggerService.collectSources?.({
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
        connection: connAD,
        summary: TEST_SUMMARY,
        runContext: testRunContext,
      });
      const resultB = await workflowDirectTriggerService.collectSources?.({
        canvasId: CANVAS_ID,
        sourcePodId: "source-pod-B",
        connection: connBD,
        summary: "Summary from B",
        runContext: testRunContext,
      });

      expect(resultA).toEqual({
        ready: true,
        participatingConnectionIds: ["conn-A-D"],
      });
      expect(resultB).toEqual({
        ready: true,
        participatingConnectionIds: ["conn-B-D"],
      });
      expect(workflowEventEmitter.emitDirectWaiting).not.toHaveBeenCalled();
      expect(workflowEventEmitter.emitDirectMerged).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // D：lifecycle hooks（onTrigger / onComplete / onQueued）
  // ============================================================
  describe("D1: lifecycle hooks - onTrigger 只對參與的 connections 發出事件", () => {
    it("run mode 單源觸發時，onTrigger 不應更新全域 connection 事件", () => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      vi.spyOn(connectionStore, "getById").mockImplementation(((
        _cId: string,
        id: string,
      ) => {
        if (id === "conn-A-D") return connAD;
        if (id === "conn-B-D") return connBD;
        return undefined;
      }) as any);

      workflowDirectTriggerService.onTrigger({
        canvasId: CANVAS_ID,
        connectionId: connAD.id,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        summary: TEST_SUMMARY,
        isSummarized: true,
        participatingConnectionIds: ["conn-A-D"],
        runContext: testRunContext,
      });

      expect(workflowEventEmitter.emitDirectTriggered).not.toHaveBeenCalled();
    });
  });

  describe("D2-D3: lifecycle hooks - onComplete / onQueued 只對參與的 connections 作用", () => {
    it("run mode onComplete 不應更新全域 connection 狀態或發出 complete 事件", () => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      vi.spyOn(connectionStore, "getById").mockImplementation(((
        _cId: string,
        id: string,
      ) => {
        if (id === "conn-A-D") return connAD;
        if (id === "conn-B-D") return connBD;
        return undefined;
      }) as any);

      const updateStatusSpy = vi.spyOn(
        connectionStore,
        "updateConnectionStatus",
      );

      workflowDirectTriggerService.onComplete(
        {
          canvasId: CANVAS_ID,
          connectionId: connAD.id,
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
          triggerMode: "direct",
          participatingConnectionIds: ["conn-A-D"],
          runContext: testRunContext,
        },
        true,
      );

      expect(workflowEventEmitter.emitWorkflowComplete).not.toHaveBeenCalled();
      expect(updateStatusSpy).not.toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-A-D",
        "idle",
      );
      expect(updateStatusSpy).not.toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-B-D",
        "idle",
      );
    });

    it("run mode onQueued 不應更新全域 connection 狀態或發出 queued 事件", () => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      vi.spyOn(connectionStore, "getById").mockImplementation(((
        _cId: string,
        id: string,
      ) => {
        if (id === "conn-A-D") return connAD;
        if (id === "conn-B-D") return connBD;
        return undefined;
      }) as any);

      const updateStatusSpy = vi.spyOn(
        connectionStore,
        "updateConnectionStatus",
      );

      workflowDirectTriggerService.onQueued({
        canvasId: CANVAS_ID,
        connectionId: connAD.id,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        position: 1,
        queueSize: 1,
        triggerMode: "direct",
        participatingConnectionIds: ["conn-A-D"],
        runContext: testRunContext,
      });

      expect(updateStatusSpy).not.toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-A-D",
        "queued",
      );
      expect(updateStatusSpy).not.toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-B-D",
        "queued",
      );
      expect(workflowEventEmitter.emitWorkflowQueued).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // E：cancelPendingResolver
  // ============================================================
  describe("E1: cancelPendingResolver", () => {
    it("Direct 已不使用 pending resolver，呼叫取消不拋出錯誤", () => {
      workflowDirectTriggerService.cancelPendingResolver(TARGET_POD_ID);
      expect(logger.log).toHaveBeenCalledWith(
        "Workflow",
        "Delete",
        expect.stringContaining("已不使用 pending resolver"),
      );
    });

    it("對不存在的 targetPodId 不拋出錯誤", () => {
      expect(() => {
        workflowDirectTriggerService.cancelPendingResolver("non-existent-pod");
      }).not.toThrow();
    });
  });
});
