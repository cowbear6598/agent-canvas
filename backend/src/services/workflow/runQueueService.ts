import { v4 as uuidv4 } from "uuid";
import type { TriggerMode } from "../../types/index.js";
import type { TriggerStrategy, ExecutionServiceMethods } from "./types.js";
import type { RunContext } from "../../types/run.js";
import { runStore, TERMINAL_POD_STATUSES } from "../runStore.js";
import { LazyInitializable } from "./lazyInitializable.js";
import { buildRunQueueKey } from "./workflowHelpers.js";
import { decideRunQueueSettlement } from "./runStatusMachine.js";
import { logger } from "../../utils/logger.js";

const MAX_QUEUE_SIZE = 50;

export interface RunQueueItem {
  id: string;
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  summary: string;
  isSummarized: boolean;
  triggerMode: TriggerMode;
  participatingConnectionIds?: string[];
  sourcePodIds?: string[];
  sourcePodNames?: string[];
  runContext: RunContext;
  enqueuedAt: Date;
}

interface RunQueueServiceDeps {
  executionService: ExecutionServiceMethods;
  strategies: {
    auto: TriggerStrategy;
    direct: TriggerStrategy;
    branch: TriggerStrategy;
  };
  queuedPodInstance: (runContext: RunContext, podId: string) => void;
  hasActiveStream: (runId: string, podId: string) => boolean;
}

class RunQueueService extends LazyInitializable<RunQueueServiceDeps> {
  private queues: Map<string, RunQueueItem[]> = new Map();
  private processingKeys: Set<string> = new Set();

  private getStrategy(triggerMode: TriggerMode): TriggerStrategy {
    return this.deps.strategies[triggerMode];
  }

  private hasActivePodInstance(runContext: RunContext, podId: string): boolean {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) return false;
    if (instance.status === "pending") return false;
    return !TERMINAL_POD_STATUSES.has(instance.status);
  }

  hasActiveItem(runContext: RunContext, targetPodId: string): boolean {
    const key = buildRunQueueKey(runContext.runId, targetPodId);
    return (
      this.deps.hasActiveStream(runContext.runId, targetPodId) ||
      this.processingKeys.has(key) ||
      this.hasActivePodInstance(runContext, targetPodId) ||
      this.getQueueSize(key) > 0
    );
  }

  enqueue(item: Omit<RunQueueItem, "id" | "enqueuedAt">): void {
    const key = buildRunQueueKey(item.runContext.runId, item.targetPodId);
    const queue = this.queues.get(key) ?? [];

    if (queue.length >= MAX_QUEUE_SIZE) {
      logger.warn(
        "Run",
        "Warn",
        `[RunQueueService] 佇列已達上限 ${MAX_QUEUE_SIZE}，拒絕加入 (runId=${item.runContext.runId}, targetPodId=${item.targetPodId})`,
      );
      return;
    }

    const queueItem: RunQueueItem = {
      ...item,
      id: uuidv4(),
      enqueuedAt: new Date(),
    };

    queue.push(queueItem);
    this.queues.set(key, queue);

    this.deps.queuedPodInstance(item.runContext, item.targetPodId);
  }

  dequeue(key: string): RunQueueItem | undefined {
    const queue = this.queues.get(key);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const item = queue.shift();
    if (queue.length === 0) {
      this.queues.delete(key);
    }

    return item;
  }

  getQueueSize(key: string): number {
    const queue = this.queues.get(key);
    return queue ? queue.length : 0;
  }

  async processNext(
    canvasId: string,
    targetPodId: string,
    runContext: RunContext,
  ): Promise<void> {
    const key = buildRunQueueKey(runContext.runId, targetPodId);
    if (this.processingKeys.has(key)) {
      return;
    }

    const decision = decideRunQueueSettlement(
      this.deps.hasActiveStream(runContext.runId, targetPodId),
      this.getQueueSize(key),
    );

    if (decision !== "process-next") {
      return;
    }

    const item = this.dequeue(key);
    if (!item) return;

    this.processingKeys.add(key);
    try {
      const strategy = this.getStrategy(item.triggerMode);

      await this.deps.executionService.triggerWorkflowWithSummary({
        canvasId,
        connectionId: item.connectionId,
        summary: item.summary,
        isSummarized: item.isSummarized,
        participatingConnectionIds: item.participatingConnectionIds,
        sourcePodIds: item.sourcePodIds,
        sourcePodNames: item.sourcePodNames,
        strategy,
        runContext: item.runContext,
        skipBusyCheck: true,
      });
    } finally {
      this.processingKeys.delete(key);
    }
  }
}

export const runQueueService = new RunQueueService();
