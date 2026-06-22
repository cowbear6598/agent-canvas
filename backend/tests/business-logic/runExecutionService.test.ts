import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { getDb } from "../../src/database/index.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import {
  runStore,
  RUN_HISTORY_RETENTION_COUNT,
} from "../../src/services/runStore.js";
import { podStore } from "../../src/services/podStore.js";
import { socketService } from "../../src/services/socketService.js";
import { abortRegistry } from "../../src/services/provider/abortRegistry.js";
import { logger } from "../../src/utils/logger.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import type { RunContext } from "../../src/types/run.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import * as nodeFs from "fs";
import * as runExecutionResources from "../../src/services/runtime/runExecutionResources.js";
import { config } from "../../src/config/index.js";
import {
  getGoalRuntimeStatePath,
  readGoalRuntimeSnapshot,
  removeGoalRuntimeRun,
} from "../../src/services/goalRuntime.js";
import { memoryMaintainerService } from "../../src/services/memoryMaintainerService.js";

// --- 測試常數 ---
const CANVAS_ID = "canvas-exec-1";
const SOURCE_POD_ID = "pod-source";

interface CapturedCanvasEvent {
  canvasId: string;
  eventName: string;
  payload: Record<string, any>;
}

// --- DB 初始化 Helper ---

/**
 * 直接透過 SQL 插入 canvas，供 podStore.create 的 getCanvasDir 查找使用。
 */
function insertCanvas(id: string = CANVAS_ID): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(id, `canvas-${id}`, 0);
}

/**
 * 直接透過 SQL 插入 connection，繞過 connectionStore.create 的 pod 查找。
 */
function insertConnection(
  canvasId: string,
  sourcePodId: string,
  targetPodId: string,
  triggerMode: "auto" | "direct" | "branch" | "ai-decide" = "auto",
  id?: string,
): string {
  const connId = id ?? uuidv4();
  getDb()
    .prepare(
      `INSERT INTO connections
       (id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor,
        trigger_mode, decide_status, decide_reason, connection_status)
       VALUES (?, ?, ?, 'right', ?, 'left', ?, 'none', NULL, 'idle')`,
    )
    .run(connId, canvasId, sourcePodId, targetPodId, triggerMode);
  return connId;
}

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "run-1",
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    ...overrides,
  };
}

describe("RunExecutionService", () => {
  const capturedCanvasEvents: CapturedCanvasEvent[] = [];

  beforeEach(() => {
    resetStatements();
    initTestDb();
    insertCanvas();
    capturedCanvasEvents.length = 0;
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(
      (canvasId, eventName, payload) => {
        capturedCanvasEvents.push({
          canvasId,
          eventName,
          payload: payload as Record<string, any>,
        });
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createRun", () => {
    it("建立 Run 並為 chain 中所有 pod 建立 instance", async () => {
      const targetPodId = "pod-target";
      insertConnection(CANVAS_ID, SOURCE_POD_ID, targetPodId, "auto");

      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "測試",
      );

      expect(ctx.runId).toBeTruthy();
      expect(ctx.canvasId).toBe(CANVAS_ID);
      expect(ctx.sourcePodId).toBe(SOURCE_POD_ID);

      const instances = runStore.getPodInstancesByRunId(ctx.runId);
      expect(instances).toHaveLength(2);
      expect(instances.map((i) => i.podId)).toContain(SOURCE_POD_ID);
      expect(instances.map((i) => i.podId)).toContain(targetPodId);
    });

    it("建立 run 後對前端發布可還原 run 狀態的 RUN_CREATED 事件", async () => {
      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "測試",
      );
      const run = runStore.getRun(ctx.runId);

      expect(capturedCanvasEvents).toContainEqual(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          eventName: WebSocketResponseEvents.RUN_CREATED,
          payload: expect.objectContaining({
            canvasId: CANVAS_ID,
            run: expect.objectContaining({
              id: ctx.runId,
              sourcePodId: SOURCE_POD_ID,
              triggerMessage: "測試",
              status: run?.status,
            }),
          }),
        }),
      );
    });

    it("RUN_CREATED payload 的 podInstances 使用 pod 顯示名稱，讓前端可直接渲染 run chain", async () => {
      // 建立真實 pod，讓 podStore.getById 能查到名稱
      const { pod: sourcePod } = podStore.create(CANVAS_ID, {
        name: "Source Pod",
        x: 0,
        y: 0,
        rotation: 0,
      });
      const { pod: targetPod } = podStore.create(CANVAS_ID, {
        name: "Target Pod",
        x: 300,
        y: 0,
        rotation: 0,
      });
      insertConnection(CANVAS_ID, sourcePod.id, targetPod.id, "auto");

      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        sourcePod.id,
        "測試",
      );

      const createdEvent = capturedCanvasEvents.find(
        (event) =>
          event.eventName === WebSocketResponseEvents.RUN_CREATED &&
          event.payload.run?.id === ctx.runId,
      );
      const instances = createdEvent?.payload.run?.podInstances as Array<{
        podId: string;
        podName: string;
      }>;

      const srcResult = instances?.find((i) => i.podId === sourcePod.id);
      const tgtResult = instances?.find((i) => i.podId === targetPod.id);
      expect(srcResult?.podName).toBe("Source Pod");
      expect(tgtResult?.podName).toBe("Target Pod");
    });

    it("pod 找不到時 RUN_CREATED payload 的 podName fallback 為 podId", async () => {
      // 不建立真實 pod，podId 直接作為名稱 fallback
      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        "pod-unknown",
        "測試",
      );

      const createdEvent = capturedCanvasEvents.find(
        (event) =>
          event.eventName === WebSocketResponseEvents.RUN_CREATED &&
          event.payload.run?.id === ctx.runId,
      );
      const instances = createdEvent?.payload.run?.podInstances as Array<{
        podId: string;
        podName: string;
      }>;
      expect(instances?.[0]?.podName).toBe("pod-unknown");
    });

    it("source pod 找不到時 RUN_CREATED payload 的 sourcePodName fallback 為 podId", async () => {
      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "測試",
      );

      expect(capturedCanvasEvents).toContainEqual(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          eventName: WebSocketResponseEvents.RUN_CREATED,
          payload: expect.objectContaining({
            run: expect.objectContaining({
              id: ctx.runId,
              sourcePodName: SOURCE_POD_ID,
            }),
          }),
        }),
      );
    });

    it("建立新 run 時只會刪除超過 30 筆的最舊 terminal run", async () => {
      const oldestRun = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "run-0");
      runStore.updateRunStatus(oldestRun.id, "completed");
      await new Promise((resolve) => setTimeout(resolve, 1));

      for (let i = 1; i < RUN_HISTORY_RETENTION_COUNT; i++) {
        const r = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, `run-${i}`);
        runStore.updateRunStatus(r.id, "completed");
      }

      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "觸發清理",
      );

      await vi.waitFor(() => {
        expect(runStore.getRun(oldestRun.id)).toBeUndefined();
      });
      expect(runStore.getRun(ctx.runId)?.status).toBe("running");
      expect(runStore.getRunsByCanvasId(CANVAS_ID)).toHaveLength(
        RUN_HISTORY_RETENTION_COUNT,
      );
    });

    it("超額時仍會保留尚未結束的 run", async () => {
      const longRunning = runStore.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "long-running",
      );
      runStore.createPodInstance(longRunning.id, SOURCE_POD_ID, "pending");
      await new Promise((resolve) => setTimeout(resolve, 1));

      for (let i = 0; i < RUN_HISTORY_RETENTION_COUNT; i++) {
        const r = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, `run-${i}`);
        runStore.updateRunStatus(r.id, "completed");
      }

      await runExecutionService.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "觸發保留進行中 run",
      );

      await vi.waitFor(() => {
        expect(runStore.getRunsByCanvasId(CANVAS_ID)).toHaveLength(
          RUN_HISTORY_RETENTION_COUNT + 1,
        );
      });
      expect(runStore.getRun(longRunning.id)?.status).toBe("running");
    });

    it("背景清理失敗時會重試一次", async () => {
      const oldestRuns: string[] = [];
      for (let i = 0; i < RUN_HISTORY_RETENTION_COUNT; i++) {
        const r = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, `run-${i}`);
        runStore.updateRunStatus(r.id, "completed");
        oldestRuns.push(r.id);
      }

      const deleteSpy = vi
        .spyOn(runExecutionService, "deleteRun")
        .mockRejectedValueOnce(new Error("first failure"))
        .mockResolvedValue(undefined);

      await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "觸發重試");

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(deleteSpy).toHaveBeenCalledTimes(2);
      expect(deleteSpy).toHaveBeenNthCalledWith(1, oldestRuns[0]);
      expect(deleteSpy).toHaveBeenNthCalledWith(2, oldestRuns[0]);
    });

    it("non-repo pod 會直接使用原始 workspace，不配置 sandbox home", async () => {
      const { pod } = podStore.create(CANVAS_ID, {
        name: "Isolated Pod",
        x: 0,
        y: 0,
        rotation: 0,
      });
      vi.spyOn(
        runExecutionResources,
        "provisionRunExecutionResources",
      ).mockResolvedValue({
        workspacePath: pod.workspacePath,
        runRepoPath: null,
      });

      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        pod.id,
        "測試",
      );
      const instance = runStore.getPodInstance(ctx.runId, pod.id);

      expect(instance?.workspacePath).toBe(pod.workspacePath);
      expect(instance?.runRepoPath).toBeNull();
    });

    it("createRun 會凍結 chain 中尚未執行 pod 的 goal snapshot", async () => {
      const { pod: sourcePod } = podStore.create(CANVAS_ID, {
        name: "Source Pod",
        x: 0,
        y: 0,
        rotation: 0,
        goal: { todos: [{ id: "source-todo-1", text: "Start" }] },
      });
      const { pod: targetPod } = podStore.create(CANVAS_ID, {
        name: "Target Pod",
        x: 300,
        y: 0,
        rotation: 0,
        goal: { todos: [{ id: "target-todo-1", text: "Original target" }] },
      });
      insertConnection(CANVAS_ID, sourcePod.id, targetPod.id, "auto");

      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        sourcePod.id,
        "測試",
      );
      podStore.update(CANVAS_ID, targetPod.id, {
        goal: { todos: [{ id: "target-todo-2", text: "Edited target" }] },
      });

      const targetSnapshot = readGoalRuntimeSnapshot(
        getGoalRuntimeStatePath(ctx, targetPod.id),
      );

      expect(targetSnapshot?.goal.todos).toEqual([
        { id: "target-todo-1", text: "Original target" },
      ]);
      removeGoalRuntimeRun(ctx.runId);
    });
  });

  describe("startPodInstance", () => {
    it("更新 status 為 running 並發送 RUN_POD_STATUS_CHANGED 事件", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID);
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.startPodInstance(ctx, SOURCE_POD_ID);

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("running");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: SOURCE_POD_ID, status: "running" }),
      );
    });

    it("發送 RUN_POD_STATUS_CHANGED 時應帶出 lastResponseSummary", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID);
      runStore.updatePodInstanceLastResponseSummary(inst.id, "最近摘要");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.startPodInstance(ctx, SOURCE_POD_ID);

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({
          podId: SOURCE_POD_ID,
          status: "running",
          lastResponseSummary: "最近摘要",
        }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const ctx = makeRunContext({ runId: run.id });

      expect(() =>
        runExecutionService.startPodInstance(ctx, "pod-nonexistent"),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("instance 狀態為 terminal（error）時，status 不被更新為 running 且不發送 RUN_POD_STATUS_CHANGED", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID);
      // 將 instance 設為 terminal 狀態
      runStore.updatePodInstanceStatus(inst.id, "error", "執行失敗");
      vi.mocked(socketService.emitToCanvas).mockClear();
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.startPodInstance(ctx, SOURCE_POD_ID);

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("error");
      expect(socketService.emitToCanvas).not.toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.anything(),
      );
    });
  });

  describe("settlePodTrigger", () => {
    it("settle auto pathway 後狀態非 pending → 更新 status 為 completed 並評估 run 狀態", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending");
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settlePodTrigger(ctx, SOURCE_POD_ID, "auto");

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("completed");
      expect(runStore.getRun(run.id)!.status).toBe("completed");
    });

    it("使用 direct pathway 時 directPathwaySettled=settled 而 autoPathwaySettled 不變", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "not-applicable",
        "pending",
      );
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settlePodTrigger(ctx, SOURCE_POD_ID, "direct");

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.directPathwaySettled).toBe("settled");
      expect(updated!.autoPathwaySettled).toBe("not-applicable");
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const ctx = makeRunContext({ runId: run.id });

      expect(() =>
        runExecutionService.settlePodTrigger(ctx, "pod-nonexistent", "auto"),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("佇列為空時且 pathways 全 settled，標記為 completed", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending");
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settlePodTrigger(ctx, SOURCE_POD_ID, "auto");

      expect(runStore.getPodInstance(run.id, SOURCE_POD_ID)!.status).toBe(
        "completed",
      );
    });

    it("部分 pathway settle 時不改變 instance status", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "pending",
        "pending",
      );
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settlePodTrigger(ctx, SOURCE_POD_ID, "direct");

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("running");
    });

    it("全部 pathway settle 時正常標記 completed", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "pending",
        "pending",
      );
      runStore.updatePodInstanceStatus(inst.id, "running");
      runStore.settleAutoPathway(inst.id);
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settlePodTrigger(ctx, SOURCE_POD_ID, "direct");

      expect(runStore.getPodInstance(run.id, SOURCE_POD_ID)!.status).toBe(
        "completed",
      );
    });

    it("部分 pathway settle 但 instance status 非 running 時不回退", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "pending",
        "pending",
      );
      runStore.updatePodInstanceStatus(inst.id, "error");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settlePodTrigger(ctx, SOURCE_POD_ID, "direct");

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("error");
    });
  });

  describe("settleAndSkipPath", () => {
    it("尚有未 settled 的 pathway 時不更新 status", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending", "pending");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settleAndSkipPath(ctx, SOURCE_POD_ID, "auto");

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("pending");
      expect(updated!.autoPathwaySettled).toBe("settled");
    });

    it("所有 pathway settled 且 status 為 pending（NEVER_TRIGGERED_STATUSES）→ skipped", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "pending",
        "not-applicable",
      );
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settleAndSkipPath(ctx, SOURCE_POD_ID, "auto");

      expect(runStore.getPodInstance(run.id, SOURCE_POD_ID)!.status).toBe(
        "skipped",
      );
    });

    it("所有 pathway settled 且 status 為 deciding（NEVER_TRIGGERED_STATUSES）→ skipped", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "pending",
        "not-applicable",
      );
      runStore.updatePodInstanceStatus(inst.id, "deciding");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settleAndSkipPath(ctx, SOURCE_POD_ID, "auto");

      expect(runStore.getPodInstance(run.id, SOURCE_POD_ID)!.status).toBe(
        "skipped",
      );
    });

    it("所有 pathway settled 且 status 不在 NEVER_TRIGGERED_STATUSES → completed", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "pending",
        "not-applicable",
      );
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settleAndSkipPath(ctx, SOURCE_POD_ID, "auto");

      expect(runStore.getPodInstance(run.id, SOURCE_POD_ID)!.status).toBe(
        "completed",
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const ctx = makeRunContext({ runId: run.id });

      expect(() =>
        runExecutionService.settleAndSkipPath(ctx, "pod-nonexistent", "auto"),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("errorPodInstance", () => {
    it("更新 status 為 error 並帶入 errorMessage", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID);
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.errorPodInstance(ctx, SOURCE_POD_ID, "執行失敗");

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("error");
      expect(updated!.errorMessage).toBe("執行失敗");
    });

    it("emit RUN_POD_STATUS_CHANGED 含 errorMessage", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID);
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.errorPodInstance(ctx, SOURCE_POD_ID, "執行失敗");

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ status: "error", errorMessage: "執行失敗" }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const ctx = makeRunContext({ runId: run.id });

      expect(() =>
        runExecutionService.errorPodInstance(ctx, "pod-nonexistent", "err"),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("queuedPodInstance", () => {
    it("更新 status 為 queued 並發送 WebSocket 事件", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      runStore.createPodInstance(run.id, SOURCE_POD_ID);
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.queuedPodInstance(ctx, SOURCE_POD_ID);

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("queued");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: SOURCE_POD_ID, status: "queued" }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const ctx = makeRunContext({ runId: run.id });

      expect(() =>
        runExecutionService.queuedPodInstance(ctx, "pod-nonexistent"),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("waitingPodInstance", () => {
    it("更新 status 為 waiting 並發送 WebSocket 事件", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      runStore.createPodInstance(run.id, SOURCE_POD_ID);
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.waitingPodInstance(ctx, SOURCE_POD_ID);

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("waiting");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: SOURCE_POD_ID, status: "waiting" }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const ctx = makeRunContext({ runId: run.id });

      expect(() =>
        runExecutionService.waitingPodInstance(ctx, "pod-nonexistent"),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("summarizingPodInstance", () => {
    it("更新 status 為 summarizing 並發送事件，不評估 run 狀態", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const inst = runStore.createPodInstance(run.id, SOURCE_POD_ID);
      runStore.updatePodInstanceStatus(inst.id, "running");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.summarizingPodInstance(ctx, SOURCE_POD_ID);

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("summarizing");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({
          podId: SOURCE_POD_ID,
          status: "summarizing",
        }),
      );
      // summarizing 不應觸發 run 結算（run 狀態維持 running）
      expect(runStore.getRun(run.id)!.status).toBe("running");
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const ctx = makeRunContext({ runId: run.id });

      expect(() =>
        runExecutionService.summarizingPodInstance(ctx, "pod-nonexistent"),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("run status transition business logic: deciding instances", () => {
    it("decidingPodInstance 將 pod 狀態更新為 deciding", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      runStore.createPodInstance(run.id, SOURCE_POD_ID);
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.decidingPodInstance(ctx, SOURCE_POD_ID);

      const updated = runStore.getPodInstance(run.id, SOURCE_POD_ID);
      expect(updated!.status).toBe("deciding");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: SOURCE_POD_ID, status: "deciding" }),
      );
    });

    it("deciding 狀態不觸發 evaluateRunStatus（run 維持 running）", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      runStore.createPodInstance(run.id, SOURCE_POD_ID);
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.decidingPodInstance(ctx, SOURCE_POD_ID);

      // run 狀態應維持 running，不被 deciding 觸發完成
      expect(runStore.getRun(run.id)!.status).toBe("running");
    });

    it("有 deciding instance 時，settleAndSkipPath 後不應完成 run", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const instA = runStore.createPodInstance(run.id, "pod-a");
      runStore.updatePodInstanceStatus(instA.id, "deciding");

      runStore.createPodInstance(run.id, "pod-b", "pending");
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.settleAndSkipPath(ctx, "pod-b", "auto");

      // pod-a 仍在 deciding → run 未完成
      expect(runStore.getRun(run.id)!.status).toBe("running");
    });

    it("有 pod 處於 deciding 狀態時，即使其他 pod 有 error，Run 不應結束", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a", "pending");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b");
      runStore.updatePodInstanceStatus(instB.id, "deciding");

      const ctx = makeRunContext({ runId: run.id });
      // settle auto → pod-a completed，但 pod-b 在 deciding → run 不結算
      runExecutionService.settlePodTrigger(ctx, "pod-a", "auto");

      expect(runStore.getRun(run.id)!.status).toBe("running");
    });

    it("所有 pod completed/skipped 且無 deciding 時，Run 標記為 completed", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a", "pending");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "skipped");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.settlePodTrigger(ctx, "pod-a", "auto");

      expect(runStore.getRun(run.id)!.status).toBe("completed");
    });
  });

  describe("run status transition business logic: evaluate via settlePodTrigger", () => {
    it("落在 30 筆外的 run 完成後會自動清除", async () => {
      vi.spyOn(
        memoryMaintainerService,
        "scheduleRepositoriesForCompletedRun",
      ).mockResolvedValue(undefined);
      const bulkOverflowSpy = vi.spyOn(runStore, "getOverflowTerminalRunIds");

      const oldRun = runStore.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "舊進行中 run",
      );
      const oldInstance = runStore.createPodInstance(
        oldRun.id,
        SOURCE_POD_ID,
        "pending",
      );
      runStore.updatePodInstanceStatus(oldInstance.id, "running");
      await new Promise((resolve) => setTimeout(resolve, 1));

      for (let i = 0; i < RUN_HISTORY_RETENTION_COUNT; i++) {
        const r = runStore.createRun(
          CANVAS_ID,
          SOURCE_POD_ID,
          `completed-${i}`,
        );
        runStore.updateRunStatus(r.id, "completed");
      }

      const ctx = makeRunContext({ runId: oldRun.id });
      runExecutionService.settlePodTrigger(ctx, SOURCE_POD_ID, "auto");

      await vi.waitFor(() => {
        expect(runStore.getRun(oldRun.id)).toBeUndefined();
      });
      expect(bulkOverflowSpy).not.toHaveBeenCalled();
    });

    it("有 error 且無進行中的 instance → run 狀態變為 error", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a", "pending");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "error");

      const ctx = makeRunContext({ runId: run.id });
      // settle pod-a → completed；pod-b 有 error → run 變 error
      runExecutionService.settlePodTrigger(ctx, "pod-a", "auto");

      expect(runStore.getRun(run.id)!.status).toBe("error");
    });

    it("有 blocked 且無進行中的 instance → run 狀態也應收斂為 error", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a", "pending");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "blocked", "等待人工確認");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.settlePodTrigger(ctx, "pod-a", "auto");

      expect(runStore.getRun(run.id)!.status).toBe("error");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
        expect.objectContaining({ status: "error" }),
      );
    });

    it("有 pending instance 時不更新 run 狀態", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a", "pending");
      runStore.updatePodInstanceStatus(instA.id, "running");

      // pod-b 仍在 pending
      runStore.createPodInstance(run.id, "pod-b", "pending");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.settlePodTrigger(ctx, "pod-a", "auto");

      // 有 pending → run 不結算
      expect(runStore.getRun(run.id)!.status).toBe("running");
    });

    it("全部 instance 為 completed → run 狀態變為 completed", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a", "pending");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "completed");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.settlePodTrigger(ctx, "pod-a", "auto");

      expect(runStore.getRun(run.id)!.status).toBe("completed");
    });

    it("全部 instance 為 completed/skipped 混合 → run 狀態變為 completed", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a", "pending");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "skipped");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.settlePodTrigger(ctx, "pod-a", "auto");

      expect(runStore.getRun(run.id)!.status).toBe("completed");
    });

    it("有 queued instance 時不更新 run 狀態", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "queued");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.errorPodInstance(ctx, "pod-a", "失敗");

      // queued 屬於 IN_PROGRESS → run 不結算
      expect(runStore.getRun(run.id)!.status).toBe("running");
    });

    it("有 waiting instance 時不更新 run 狀態", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "waiting");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.errorPodInstance(ctx, "pod-a", "失敗");

      // waiting 屬於 IN_PROGRESS → run 不結算
      expect(runStore.getRun(run.id)!.status).toBe("running");
    });

    it("errorPodInstance 後有 error 且無進行中 → run 最終狀態更新為 error 並發送 RUN_STATUS_CHANGED", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      const instA = runStore.createPodInstance(run.id, "pod-a");
      runStore.updatePodInstanceStatus(instA.id, "running");

      const instB = runStore.createPodInstance(run.id, "pod-b", "settled");
      runStore.updatePodInstanceStatus(instB.id, "completed");

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.errorPodInstance(ctx, "pod-a", "執行錯誤");

      expect(runStore.getRun(run.id)!.status).toBe("error");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
        expect.objectContaining({ status: "error" }),
      );
    });

    it("落在 30 筆外的 run 錯誤終止後會自動清除", async () => {
      vi.spyOn(
        memoryMaintainerService,
        "scheduleRepositoriesForCompletedRun",
      ).mockResolvedValue(undefined);
      const bulkOverflowSpy = vi.spyOn(runStore, "getOverflowTerminalRunIds");

      const oldRun = runStore.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "舊進行中 run",
      );
      const oldInstance = runStore.createPodInstance(oldRun.id, SOURCE_POD_ID);
      runStore.updatePodInstanceStatus(oldInstance.id, "running");
      await new Promise((resolve) => setTimeout(resolve, 1));

      for (let i = 0; i < RUN_HISTORY_RETENTION_COUNT; i++) {
        const r = runStore.createRun(
          CANVAS_ID,
          SOURCE_POD_ID,
          `completed-${i}`,
        );
        runStore.updateRunStatus(r.id, "completed");
      }

      const ctx = makeRunContext({ runId: oldRun.id });
      runExecutionService.errorPodInstance(ctx, SOURCE_POD_ID, "執行失敗");

      await vi.waitFor(() => {
        expect(runStore.getRun(oldRun.id)).toBeUndefined();
      });
      expect(bulkOverflowSpy).not.toHaveBeenCalled();
    });

    it("source blocked 透過 error pathway 後，下游 auto/branch/direct pathway 應結清為 skipped 而不是持續等待", () => {
      const targetPodId = "pod-downstream";
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const sourceInstance = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "pending",
        "not-applicable",
      );
      runStore.updatePodInstanceStatus(sourceInstance.id, "running");
      runStore.createPodInstance(run.id, targetPodId, "pending", "pending");
      insertConnection(
        CANVAS_ID,
        SOURCE_POD_ID,
        targetPodId,
        "auto",
        "conn-auto-blocked",
      );
      insertConnection(
        CANVAS_ID,
        SOURCE_POD_ID,
        targetPodId,
        "branch",
        "conn-branch-blocked",
      );
      insertConnection(
        CANVAS_ID,
        SOURCE_POD_ID,
        targetPodId,
        "direct",
        "conn-direct-blocked",
      );
      const ctx = makeRunContext({ runId: run.id });

      runExecutionService.errorPodInstance(ctx, SOURCE_POD_ID, "Goal 已 blocked");

      const downstream = runStore.getPodInstance(run.id, targetPodId);
      expect(downstream?.status).toBe("skipped");
      expect(downstream?.autoPathwaySettled).toBe("settled");
      expect(downstream?.directPathwaySettled).toBe("settled");
      expect(runStore.getRun(run.id)?.status).toBe("error");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({
          podId: targetPodId,
          status: "skipped",
          autoPathwaySettled: "settled",
          directPathwaySettled: "settled",
        }),
      );
    });

    it("source instance 真正為 blocked 時，下游 auto/branch/direct pathway 也應結清為 skipped", () => {
      const helperPodId = "pod-helper";
      const targetPodId = "pod-downstream";
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const sourceInstance = runStore.createPodInstance(
        run.id,
        SOURCE_POD_ID,
        "settled",
        "not-applicable",
      );
      runStore.updatePodInstanceStatus(
        sourceInstance.id,
        "blocked",
        "等待人工確認",
      );

      const helperInstance = runStore.createPodInstance(
        run.id,
        helperPodId,
        "pending",
      );
      runStore.updatePodInstanceStatus(helperInstance.id, "running");
      runStore.createPodInstance(run.id, targetPodId, "pending", "pending");

      insertConnection(
        CANVAS_ID,
        SOURCE_POD_ID,
        targetPodId,
        "auto",
        "conn-auto-source-blocked",
      );
      insertConnection(
        CANVAS_ID,
        SOURCE_POD_ID,
        targetPodId,
        "branch",
        "conn-branch-source-blocked",
      );
      insertConnection(
        CANVAS_ID,
        SOURCE_POD_ID,
        targetPodId,
        "direct",
        "conn-direct-source-blocked",
      );

      const ctx = makeRunContext({ runId: run.id });
      runExecutionService.errorPodInstance(ctx, helperPodId, "觸發 run 狀態重算");

      const downstream = runStore.getPodInstance(run.id, targetPodId);
      expect(downstream?.status).toBe("skipped");
      expect(downstream?.autoPathwaySettled).toBe("settled");
      expect(downstream?.directPathwaySettled).toBe("settled");
      expect(runStore.getRun(run.id)?.status).toBe("error");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({
          podId: targetPodId,
          status: "skipped",
          autoPathwaySettled: "settled",
          directPathwaySettled: "settled",
        }),
      );
    });
  });

  describe("registerActiveStream / unregisterActiveStream", () => {
    it("同一 run/pod 多次 register 時需對應 unregister 次數才會清理", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      runExecutionService.registerActiveStream(run.id, "pod-1");
      runExecutionService.registerActiveStream(run.id, "pod-1");
      runExecutionService.unregisterActiveStream(run.id, "pod-1");

      expect(runExecutionService.hasActiveStream(run.id, "pod-1")).toBe(true);

      runExecutionService.unregisterActiveStream(run.id, "pod-1");

      expect(runExecutionService.hasActiveStream(run.id, "pod-1")).toBe(false);
    });

    it("register 後 unregister 正確清理 Map", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      runExecutionService.registerActiveStream(run.id, "pod-1");
      runExecutionService.registerActiveStream(run.id, "pod-2");
      runExecutionService.unregisterActiveStream(run.id, "pod-1");
      runExecutionService.unregisterActiveStream(run.id, "pod-2");

      // Map 已清空，deleteRun 不應呼叫 abort
      const abortSpy = vi.spyOn(abortRegistry, "abort").mockReturnValue(false);

      await runExecutionService.deleteRun(run.id);

      expect(abortSpy).not.toHaveBeenCalled();
    });

    it("Set 為空時從 Map 移除 runId", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

      runExecutionService.registerActiveStream(run.id, "pod-1");
      runExecutionService.unregisterActiveStream(run.id, "pod-1");

      const abortSpy = vi.spyOn(abortRegistry, "abort").mockReturnValue(false);

      await runExecutionService.deleteRun(run.id);

      expect(abortSpy).not.toHaveBeenCalled();
    });
  });

  describe("deleteRun", () => {
    it("中斷活躍串流中的 pod 並刪除 run 發送事件", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      runExecutionService.registerActiveStream(run.id, "pod-active");

      const abortSpy = vi.spyOn(abortRegistry, "abort").mockReturnValue(true);

      await runExecutionService.deleteRun(run.id);

      expect(abortSpy).toHaveBeenCalledWith(`${run.id}:pod-active`);
      expect(runStore.getRun(run.id)).toBeUndefined();
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_DELETED,
        { runId: run.id, canvasId: CANVAS_ID },
      );
    });

    it("run 不存在時不發送 RUN_DELETED 事件", async () => {
      await runExecutionService.deleteRun("run-ghost");

      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it("無活躍串流時不呼叫 abort", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const abortSpy = vi.spyOn(abortRegistry, "abort").mockReturnValue(false);

      await runExecutionService.deleteRun(run.id);

      expect(abortSpy).not.toHaveBeenCalled();
    });

    it("刪除 run 時不會清理原始 workspace", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const workspacePath = path.join(
        config.canvasRoot,
        CANVAS_ID,
        "pod-source-workspace",
      );
      runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending", "pending", {
        workspacePath,
      });

      const rmSpy = vi
        .spyOn(nodeFs.promises, "rm")
        .mockResolvedValue(undefined);

      await runExecutionService.deleteRun(run.id);

      expect(rmSpy).not.toHaveBeenCalledWith(workspacePath, {
        recursive: true,
        force: true,
      });
      expect(runStore.getExecutionPathsByRunId(run.id)).toEqual([]);
    });

    it("deleteRun 時 runRepoPath 在 runRepositoriesRoot 內，應呼叫 fs.rm 清理", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const runRepoPath = path.join(
        config.runRepositoriesRoot,
        `repo-1-agnet-canvas-${run.id}`,
      );
      runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending", "pending", {
        runRepoPath,
      });

      const rmSpy = vi
        .spyOn(nodeFs.promises, "rm")
        .mockResolvedValue(undefined);

      await runExecutionService.deleteRun(run.id);

      expect(rmSpy).toHaveBeenCalledWith(
        path.resolve(runRepoPath),
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it("deleteRun 時 runRepoPath 在 runRepositoriesRoot 之外（越界），不呼叫 fs.rm 且 logger.warn 被呼叫", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const outOfBoundsPath = "/tmp/evil-path/repo";
      runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending", "pending", {
        runRepoPath: outOfBoundsPath,
      });

      const rmSpy = vi
        .spyOn(nodeFs.promises, "rm")
        .mockResolvedValue(undefined);
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await runExecutionService.deleteRun(run.id);

      expect(rmSpy).not.toHaveBeenCalledWith(
        outOfBoundsPath,
        expect.anything(),
      );
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
