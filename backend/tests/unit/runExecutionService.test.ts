import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { getDb } from "../../src/database/index.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runStore } from "../../src/services/runStore.js";
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
import { getRunSandboxHomePath } from "../../src/services/runtime/executionPaths.js";
import { config } from "../../src/config/index.js";

// --- 測試常數 ---
const CANVAS_ID = "canvas-exec-1";
const SOURCE_POD_ID = "pod-source";

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
  triggerMode: "auto" | "direct" | "ai-decide" = "auto",
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
  beforeEach(() => {
    resetStatements();
    initTestDb();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
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

    it("emit RUN_CREATED 事件，payload 含 canvasId 與 run.id", async () => {
      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "測試",
      );

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_CREATED,
        expect.objectContaining({
          canvasId: CANVAS_ID,
          run: expect.objectContaining({ id: ctx.runId }),
        }),
      );
    });

    it("emit payload 的 podInstances 中每個 instance 都有正確的 podName（pod 存在時）", async () => {
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

      const emitCall = vi.mocked(socketService.emitToCanvas).mock.calls[0];
      const payload = emitCall?.[2] as any;
      const instances = payload?.run?.podInstances as Array<{
        podId: string;
        podName: string;
      }>;

      const srcResult = instances?.find((i) => i.podId === sourcePod.id);
      const tgtResult = instances?.find((i) => i.podId === targetPod.id);
      expect(srcResult?.podName).toBe("Source Pod");
      expect(tgtResult?.podName).toBe("Target Pod");
    });

    it("pod 找不到時 podName fallback 為 podId", async () => {
      // 不建立真實 pod，podId 直接作為名稱 fallback
      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        "pod-unknown",
        "測試",
      );

      const emitCall = vi.mocked(socketService.emitToCanvas).mock.calls[0];
      const payload = emitCall?.[2] as any;
      const instances = payload?.run?.podInstances as Array<{
        podId: string;
        podName: string;
      }>;
      expect(instances?.[0]?.podName).toBe("pod-unknown");
    });

    it("source pod 找不到時 sourcePodName fallback 為 podId", async () => {
      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        "測試",
      );

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        WebSocketResponseEvents.RUN_CREATED,
        expect.objectContaining({
          run: expect.objectContaining({ sourcePodName: SOURCE_POD_ID }),
        }),
      );
    });

    it("run 數量超過上限時觸發 enforceRunLimit 刪除最舊的 run", async () => {
      // 先建立 30 個已完成 run（上限值）
      for (let i = 0; i < 30; i++) {
        const r = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, `run-${i}`);
        runStore.updateRunStatus(r.id, "completed");
      }

      // 第 31 個 run → 觸發清理
      await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "觸發清理");

      const remaining = runStore.getRunsByCanvasId(CANVAS_ID);
      // 清理後應 <= 30
      expect(remaining.length).toBeLessThanOrEqual(30);
    });

    it("non-repo pod 會配置 run-level workspace snapshot 與 sandbox home", async () => {
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
        workspacePath: path.join("/tmp", "run-workspaces", "isolated-pod"),
        sandboxHomePath: getRunSandboxHomePath("run-mock", pod.id),
        worktreePath: null,
      });

      const ctx = await runExecutionService.createRun(
        CANVAS_ID,
        pod.id,
        "測試",
      );
      const instance = runStore.getPodInstance(ctx.runId, pod.id);

      expect(instance?.workspacePath).toBeTruthy();
      expect(instance?.workspacePath).not.toBe(pod.workspacePath);
      expect(instance?.sandboxHomePath).toBeTruthy();
      expect(
        runExecutionResources.provisionRunExecutionResources,
      ).toHaveBeenCalled();
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

  describe("decidingPodInstance（來自 runExecutionServiceDeciding）", () => {
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

  describe("evaluateRunStatus（透過 settlePodTrigger 觸發）", () => {
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
  });

  describe("registerActiveStream / unregisterActiveStream", () => {
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

    it("刪除 run 時會清理 run-level workspace 與 sandbox home", async () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
      const workspacePath = path.join(
        config.runWorkspacesRoot,
        "run-cleanup",
        "pod-source",
      );
      const sandboxHomePath = getRunSandboxHomePath(run.id, SOURCE_POD_ID);
      runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending", "pending", {
        workspacePath,
        sandboxHomePath,
      });

      const rmSpy = vi
        .spyOn(nodeFs.promises, "rm")
        .mockResolvedValue(undefined);

      await runExecutionService.deleteRun(run.id);

      expect(rmSpy).toHaveBeenCalledWith(workspacePath, {
        recursive: true,
        force: true,
      });
      expect(rmSpy).toHaveBeenCalledWith(sandboxHomePath, {
        recursive: true,
        force: true,
      });
      expect(runStore.getExecutionPathsByRunId(run.id)).toEqual([]);
    });
  });
});
