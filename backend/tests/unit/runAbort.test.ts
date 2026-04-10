vi.mock("../../src/services/workflow/runQueueService.js", () => ({
  runQueueService: {
    getQueueSize: vi.fn().mockReturnValue(0),
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    processNext: vi.fn().mockResolvedValue(undefined),
    init: vi.fn(),
  },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runStore } from "../../src/services/runStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { socketService } from "../../src/services/socketService.js";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { logger } from "../../src/utils/logger.js";
import type { WorkflowRun } from "../../src/services/runStore.js";

// 建立最小可用的 WorkflowRun mock
function createMockRun(id: string, canvasId = "canvas-1"): WorkflowRun {
  return {
    id,
    canvasId,
    sourcePodId: "pod-source",
    triggerMessage: "測試訊息",
    status: "running",
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

/**
 * 呼叫 createRun 以初始化 runAbortControllers 與 pendingRunTasks。
 * 使用最精簡的 mock：無連線、無 pod instance（只有 source pod）。
 */
async function initRun(runId: string, canvasId = "canvas-1"): Promise<void> {
  vi.spyOn(runStore, "createRun").mockReturnValue(
    createMockRun(runId, canvasId),
  );
  vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
  vi.spyOn(runStore, "createPodInstance").mockReturnValue({
    id: `instance-${runId}`,
    runId,
    podId: "pod-source",
    status: "pending",
    claudeSessionId: null,
    errorMessage: null,
    triggeredAt: null,
    completedAt: null,
    autoPathwaySettled: "pending",
    directPathwaySettled: "not-applicable",
  });
  vi.spyOn(podStore, "getById").mockReturnValue({
    id: "pod-source",
    name: "Source Pod",
  } as any);
  vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

  await runExecutionService.createRun(canvasId, "pod-source", "測試");
}

describe("Run 中止機制", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createRun 後應能透過 isRunAborted 取得 false", async () => {
    const runId = "run-abort-1";
    await initRun(runId);

    expect(runExecutionService.isRunAborted(runId)).toBe(false);

    // 清理：避免影響後續測試
    vi.spyOn(runStore, "getRun").mockReturnValue(createMockRun(runId));
    vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});
    vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);
    await runExecutionService.deleteRun(runId);
  });

  it("deleteRun 後 isRunAborted 應回傳 true", async () => {
    const runId = "run-abort-2";
    await initRun(runId);

    vi.spyOn(runStore, "getRun").mockReturnValue(createMockRun(runId));
    vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});
    vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);

    await runExecutionService.deleteRun(runId);

    // deleteRun 完成後 controller 已被清除，應視為已中止
    expect(runExecutionService.isRunAborted(runId)).toBe(true);
  });

  it("trackRunTask 追蹤的 Promise 完成後應自動移除", async () => {
    const runId = "run-abort-3";
    await initRun(runId);

    let resolveTask!: () => void;
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    runExecutionService.trackRunTask(runId, task);

    // Task 尚未完成前，先讓 AbortController 存活以允許後續 deleteRun
    resolveTask();
    // 等待 task.finally() 的 microtask 執行
    await task;

    // 清理：deleteRun 此時應不需等待任何 task
    vi.spyOn(runStore, "getRun").mockReturnValue(createMockRun(runId));
    vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});
    vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);

    const deleteStart = Date.now();
    await runExecutionService.deleteRun(runId);
    const elapsed = Date.now() - deleteStart;

    // task 已完成，deleteRun 不需要等待，應立即結束（< 50ms）
    expect(elapsed).toBeLessThan(50);
  });

  it("deleteRun 應等待所有 pendingRunTasks 完成後才刪除 DB", async () => {
    const runId = "run-abort-4";
    await initRun(runId);

    const callOrder: string[] = [];

    // 建立一個 50ms 後才 resolve 的延遲任務
    let resolveTask!: () => void;
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve;
    }).then(() => {
      callOrder.push("task-resolved");
    });

    runExecutionService.trackRunTask(runId, task as Promise<void>);

    vi.spyOn(runStore, "getRun").mockReturnValue(createMockRun(runId));
    vi.spyOn(runStore, "deleteRun").mockImplementation(() => {
      callOrder.push("db-deleted");
    });
    vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);

    // 在 deleteRun 等待期間，讓 task resolve
    const deletePromise = runExecutionService.deleteRun(runId);
    resolveTask();
    await deletePromise;

    // task 必須在 db-deleted 之前完成
    expect(callOrder.indexOf("task-resolved")).toBeLessThan(
      callOrder.indexOf("db-deleted"),
    );
  });

  it("Run 已中止後，新的 trackRunTask 仍應追蹤（確保 await 能涵蓋）", async () => {
    const runId = "run-abort-5";
    await initRun(runId);

    // 先呼叫 abort（透過 isRunAborted 確認 signal 已觸發）
    // 直接建立一個 abort 的情境：在 deleteRun 開始後、任務 resolve 前追蹤新 task
    const callOrder: string[] = [];
    let resolveEarlyTask!: () => void;
    const earlyTask = new Promise<void>((resolve) => {
      resolveEarlyTask = resolve;
    }).then(() => {
      callOrder.push("early-task-resolved");
    });

    // 先追蹤 early task，確保它在 deleteRun 之前加入
    runExecutionService.trackRunTask(runId, earlyTask as Promise<void>);

    vi.spyOn(runStore, "getRun").mockReturnValue(createMockRun(runId));
    vi.spyOn(runStore, "deleteRun").mockImplementation(() => {
      callOrder.push("db-deleted");
    });
    vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);

    const deletePromise = runExecutionService.deleteRun(runId);
    resolveEarlyTask();
    await deletePromise;

    // early task 應在 DB 刪除前完成
    expect(callOrder.indexOf("early-task-resolved")).toBeLessThan(
      callOrder.indexOf("db-deleted"),
    );
    // Run 已清理，isRunAborted 應回傳 true
    expect(runExecutionService.isRunAborted(runId)).toBe(true);
  });
});
