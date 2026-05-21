vi.mock("../../src/services/runStore.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/runStore.js")>();
  return {
    ...actual,
    runStore: {
      getPodInstance: vi.fn(),
    },
  };
});

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

const mockRunContext = makeRunContext();

const mockQueuedPodInstance = vi.fn();
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
  "ai-decide": {
    mode: "ai-decide" as const,
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
    mockHasActiveStream.mockReturnValue(false);
    runQueueService.init({
      executionService: mockExecutionService,
      strategies: mockStrategies,
      queuedPodInstance: mockQueuedPodInstance,
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

    it("佇列為空時不呼叫 triggerWorkflowWithSummary", async () => {
      await runQueueService.processNext(canvasId, targetPodId, mockRunContext);

      expect(
        mockExecutionService.triggerWorkflowWithSummary,
      ).not.toHaveBeenCalled();
    });
  });
});
