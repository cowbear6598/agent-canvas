import { v4 as uuidv4 } from 'uuid';
import type { TriggerMode } from '../../types/index.js';
import type { TriggerStrategy, ExecutionServiceMethods } from './types.js';
import type { RunContext } from '../../types/run.js';
import { podStore } from '../podStore.js';
import { LazyInitializable } from './lazyInitializable.js';
import { logger } from '../../utils/logger.js';

export interface QueueItem {
  id: string;
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  summary: string;
  isSummarized: boolean;
  triggerMode: TriggerMode;
  participatingConnectionIds?: string[];
  runContext?: RunContext;
  enqueuedAt: Date;
}

interface QueueServiceDeps {
  executionService: ExecutionServiceMethods;
  strategies: { auto: TriggerStrategy; direct: TriggerStrategy; 'ai-decide': TriggerStrategy };
}

class WorkflowQueueService extends LazyInitializable<QueueServiceDeps> {
  private queues: Map<string, QueueItem[]> = new Map();

  private getStrategy(triggerMode: TriggerMode): TriggerStrategy {
    return this.deps.strategies[triggerMode];
  }

  enqueue(item: Omit<QueueItem, 'id' | 'enqueuedAt'>): { position: number; queueSize: number } {
    // run mode 下不應進入佇列，直接回傳防禦性結果
    if (item.runContext) {
      logger.warn('Workflow', 'Warn', `[Queue] Run mode 不應呼叫 enqueue (runId: ${item.runContext.runId}, targetPodId: ${item.targetPodId})`);
      return { position: 0, queueSize: 0 };
    }

    const queueItem: QueueItem = {
      ...item,
      id: uuidv4(),
      enqueuedAt: new Date(),
    };

    const queue = this.queues.get(item.targetPodId) ?? [];
    queue.push(queueItem);
    this.queues.set(item.targetPodId, queue);

    const position = queue.length;
    const queueSize = queue.length;

    const strategy = this.getStrategy(item.triggerMode);
    strategy.onQueued({
      canvasId: item.canvasId,
      connectionId: item.connectionId,
      sourcePodId: item.sourcePodId,
      targetPodId: item.targetPodId,
      position,
      queueSize,
      triggerMode: item.triggerMode,
      participatingConnectionIds: item.participatingConnectionIds ?? [item.connectionId],
    });

    return { position, queueSize };
  }

  dequeue(targetPodId: string): QueueItem | undefined {
    const queue = this.queues.get(targetPodId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const item = queue.shift();
    if (queue.length === 0) {
      this.queues.delete(targetPodId);
    }

    return item;
  }

  getQueueSize(targetPodId: string): number {
    const queue = this.queues.get(targetPodId);
    return queue ? queue.length : 0;
  }

  async processNextInQueue(canvasId: string, targetPodId: string): Promise<void> {
    const targetPod = podStore.getById(canvasId, targetPodId);
    if (!targetPod) {
      return;
    }

    if (targetPod.status !== 'idle') {
      return;
    }

    const item = this.dequeue(targetPodId);
    if (!item) {
      return;
    }

    const remainingQueueSize = this.getQueueSize(targetPodId);
    const strategy = this.getStrategy(item.triggerMode);

    strategy.onQueueProcessed({
      canvasId,
      connectionId: item.connectionId,
      sourcePodId: item.sourcePodId,
      targetPodId,
      remainingQueueSize,
      triggerMode: item.triggerMode,
      participatingConnectionIds: item.participatingConnectionIds ?? [item.connectionId],
    });

    await this.deps.executionService.triggerWorkflowWithSummary({
      canvasId,
      connectionId: item.connectionId,
      summary: item.summary,
      isSummarized: item.isSummarized,
      participatingConnectionIds: item.participatingConnectionIds,
      strategy,
    });
  }
}

export const workflowQueueService = new WorkflowQueueService();
