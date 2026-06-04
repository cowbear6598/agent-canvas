vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runQueueService } from "../../src/services/workflow/runQueueService.js";
import { runStore } from "../../src/services/runStore.js";
import { logger } from "../../src/utils/logger.js";
import { buildRunQueueKey } from "../../src/services/workflow/workflowHelpers.js";
import { initTestDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import type { RunQueueItem } from "../../src/services/workflow/runQueueService.js";
import type { RunContext } from "../../src/types/run.js";

// ─── 常數（本地定義，不依賴工廠檔）────────────────────────────────────────────

const canvasId = "canvas-1";
const sourcePodId = "source-pod";
const targetPodId = "target-pod";
const connectionId = "conn-1";

// ─── 工廠函式 ─────────────────────────────────────────────────────────────────

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "test-run-id",
    canvasId,
    sourcePodId,
    ...overrides,
  };
}

let mockRunContext: RunContext = makeRunContext();

const mockQueuedPodInstance = vi.fn();
const mockErrorPodInstance = vi.fn();
const mockHasActiveStream = vi.fn().mockReturnValue(false);

const mockExecutionService = {
  generateSummaryWithFallback: vi.fn(),
  triggerWorkflowWithSummary: vi.fn().mockResolvedValue(undefined),
};

const mockStrategies = {
  auto: {
    mode: "auto" as const,
    decide: vi.fn(),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
  },
  direct: {
    mode: "direct" as const,
    decide: vi.fn(),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
  },
  branch: {
    mode: "branch" as const,
    decide: vi.fn(),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
  },
};

function createQueueItem(
  overrides?: Partial<Omit<RunQueueItem, "id" | "enqueuedAt">>,
): Omit<RunQueueItem, "id" | "enqueuedAt"> {
  return {
    canvasId,
    connectionId,
    sourcePodId,
    targetPodId,
    summary: "測試摘要",
    isSummarized: true,
    triggerMode: "auto",
    runContext: mockRunContext,
    ...overrides,
  };
}

describe("RunQueueService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStatements();
    initTestDb();
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
      )
      .run(canvasId, "run-queue-canvas", 0);
    const run = runStore.createRun(canvasId, sourcePodId, "測試觸發訊息");
    mockRunContext = makeRunContext({ runId: run.id });
    mockHasActiveStream.mockReturnValue(false);
    runQueueService.init({
      executionService: mockExecutionService,
      strategies: mockStrategies,
      queuedPodInstance: mockQueuedPodInstance,
      errorPodInstance: mockErrorPodInstance,
      hasActiveStream: mockHasActiveStream,
    });
    // 清空佇列
    const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
    while (runQueueService.getQueueSize(key) > 0) runQueueService.dequeue(key);
    while (
      runQueueService.getQueueSize(buildRunQueueKey("other-run", targetPodId)) >
      0
    ) {
      runQueueService.dequeue(buildRunQueueKey("other-run", targetPodId));
    }
  });

  describe("enqueue", () => {
    it("正確加入佇列項目", async () => {
      const item = createQueueItem();
      runQueueService.enqueue(item);

      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
      expect(runQueueService.getQueueSize(key)).toBe(1);
    });

    it("enqueue 後呼叫 queuedPodInstance", () => {
      runQueueService.enqueue(createQueueItem());
      expect(mockQueuedPodInstance).toHaveBeenCalledWith(
        mockRunContext,
        targetPodId,
      );
    });

    it("佇列超過上限時拒絕加入並 warn", () => {
      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);

      for (let i = 0; i < 50; i++) {
        runQueueService.enqueue(createQueueItem({ connectionId: `conn-${i}` }));
      }
      expect(runQueueService.getQueueSize(key)).toBe(50);

      runQueueService.enqueue(
        createQueueItem({ connectionId: "conn-overflow" }),
      );
      expect(runQueueService.getQueueSize(key)).toBe(50);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("dequeue", () => {
    it("依 FIFO 順序取出", () => {
      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);

      runQueueService.enqueue(createQueueItem({ connectionId: "conn-1" }));
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-2" }));
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-3" }));

      expect(runQueueService.dequeue(key)?.connectionId).toBe("conn-1");
      expect(runQueueService.dequeue(key)?.connectionId).toBe("conn-2");
      expect(runQueueService.dequeue(key)?.connectionId).toBe("conn-3");
    });

    it("佇列為空時回傳 undefined", () => {
      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
      expect(runQueueService.dequeue(key)).toBeUndefined();
    });
  });

  describe("getQueueSize", () => {
    it("正確回報佇列長度", () => {
      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);

      expect(runQueueService.getQueueSize(key)).toBe(0);

      runQueueService.enqueue(createQueueItem());
      expect(runQueueService.getQueueSize(key)).toBe(1);

      runQueueService.enqueue(createQueueItem());
      expect(runQueueService.getQueueSize(key)).toBe(2);
    });
  });

  describe("hasActiveItem", () => {
    it("同一 runId:targetPodId 有活躍 stream 時回報忙碌", () => {
      mockHasActiveStream.mockReturnValue(true);

      expect(runQueueService.hasActiveItem(mockRunContext, targetPodId)).toBe(
        true,
      );
    });

    it("同一 runId:targetPodId 有非終態且已啟動的 pod instance 時回報忙碌", () => {
      const instance = runStore.createPodInstance(
        mockRunContext.runId,
        targetPodId,
      );
      runStore.updatePodInstanceStatus(instance.id, "waiting");

      expect(runQueueService.hasActiveItem(mockRunContext, targetPodId)).toBe(
        true,
      );
    });

    it("同一 runId:targetPodId 已有 queue item 時回報忙碌", () => {
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-queued" }));

      expect(runQueueService.hasActiveItem(mockRunContext, targetPodId)).toBe(
        true,
      );
    });

    it("只有尚未啟動的 pending instance 且佇列為空時不視為忙碌", () => {
      runStore.createPodInstance(mockRunContext.runId, targetPodId);

      expect(runQueueService.hasActiveItem(mockRunContext, targetPodId)).toBe(
        false,
      );
    });
  });

  describe("不同 runId:podId 的佇列互相獨立", () => {
    it("兩個不同 key 的佇列各自獨立", () => {
      const otherRunContext = makeRunContext({ runId: "other-run" });

      runQueueService.enqueue(createQueueItem({ runContext: mockRunContext }));
      runQueueService.enqueue(createQueueItem({ runContext: otherRunContext }));

      const key1 = buildRunQueueKey(mockRunContext.runId, targetPodId);
      const key2 = buildRunQueueKey("other-run", targetPodId);

      expect(runQueueService.getQueueSize(key1)).toBe(1);
      expect(runQueueService.getQueueSize(key2)).toBe(1);
    });
  });

  describe("processNext", () => {
    it("目標 Pod 有活躍 stream 時不處理佇列", async () => {
      mockHasActiveStream.mockReturnValue(true);

      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
      runQueueService.enqueue(createQueueItem());

      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
      expect(runQueueService.getQueueSize(key)).toBe(1);
    });

    it("無活躍 stream 時正常取出並觸發（佇列有一個 item）", async () => {
      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
      runQueueService.enqueue(createQueueItem());

      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalled();
      expect(runQueueService.getQueueSize(key)).toBe(0);
    });

    it("無活躍 stream 時正常取出並觸發（直接呼叫）", async () => {
      runQueueService.enqueue(createQueueItem());

      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalled();
    });

    it("triggerWorkflowWithSummary 尚未建立 active stream 時，不會重入連續 dequeue", async () => {
      let resolveTrigger: (() => void) | undefined;
      mockExecutionService.triggerWorkflowWithSummary.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveTrigger = resolve;
        }),
      );

      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-1" }));
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-2" }));
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-3" }));

      const firstProcess = runQueueService.processNext(
        canvasId,
        targetPodId,
        mockRunContext,
      );
      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledTimes(1);
      expect(runQueueService.getQueueSize(key)).toBe(2);

      resolveTrigger?.();
      await firstProcess;

      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenCalledTimes(2);
      expect(runQueueService.getQueueSize(key)).toBe(1);
    });

    it("第一輪 Goal completed 或 blocked 後再次排程時依 FIFO 取出下一個 item", async () => {
      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-1" }));
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-2" }));
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-3" }));

      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);
      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);
      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ connectionId: "conn-1" }),
      );
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ connectionId: "conn-2" }),
      );
      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ connectionId: "conn-3" }),
      );
      expect(runQueueService.getQueueSize(key)).toBe(0);
    });

    it("佇列為空時不呼叫 triggerWorkflowWithSummary", async () => {
      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });

    it("目標 Pod 已為 blocked 終態時，應清空該 Pod 的佇列且不再觸發", async () => {
      const instance = runStore.createPodInstance(
        mockRunContext.runId,
        targetPodId,
      );
      runStore.updatePodInstanceStatus(instance.id, "blocked", "等待人工確認");

      const key = buildRunQueueKey(mockRunContext.runId, targetPodId);
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-1" }));
      runQueueService.enqueue(createQueueItem({ connectionId: "conn-2" }));

      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
      expect(runQueueService.getQueueSize(key)).toBe(0);
    });
  });
});
