import { runStore } from '../runStore.js';
import { connectionStore } from '../connectionStore.js';
import { podStore } from '../podStore.js';
import { socketService } from '../socketService.js';
import { claudeService } from '../claude/claudeService.js';
import { logger } from '../../utils/logger.js';
import { WebSocketResponseEvents } from '../../schemas/events.js';
import type {
  RunContext,
  RunCreatedPayload,
  RunStatusChangedPayload,
  RunPodStatusChangedPayload,
  RunDeletedPayload,
} from '../../types/run.js';

const MAX_RUNS_PER_CANVAS = 30;

class RunExecutionService {
  // key: runId, value: Set<podId> — 追蹤每個 run 中正在活躍串流的 pod
  private activeRunStreams: Map<string, Set<string>> = new Map();

  async createRun(canvasId: string, sourcePodId: string, triggerMessage: string): Promise<RunContext> {
    const workflowRun = runStore.createRun(canvasId, sourcePodId, triggerMessage);

    const chainPodIds = this.collectChainPodIds(canvasId, sourcePodId);
    const instances = chainPodIds.map((podId) => runStore.createPodInstance(workflowRun.id, podId));

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    const sourcePodName = sourcePod?.name ?? sourcePodId;

    logger.log('Run', 'Create', `建立 Run ${workflowRun.id}，共 ${instances.length} 個 pod instance`);

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CREATED, {
      canvasId,
      run: { ...workflowRun, podInstances: instances, sourcePodName },
    } as RunCreatedPayload);

    this.enforceRunLimit(canvasId);

    return { runId: workflowRun.id, canvasId, sourcePodId };
  }

  private collectChainPodIds(canvasId: string, sourcePodId: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [sourcePodId];
    visited.add(sourcePodId);

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) break;

      const connections = connectionStore.findBySourcePodId(canvasId, currentId);
      for (const conn of connections) {
        if (!visited.has(conn.targetPodId)) {
          visited.add(conn.targetPodId);
          queue.push(conn.targetPodId);
        }
      }
    }

    return [...visited];
  }

  private enforceRunLimit(canvasId: string): void {
    const count = runStore.countRunsByCanvasId(canvasId);
    if (count <= MAX_RUNS_PER_CANVAS) return;

    const overflow = count - MAX_RUNS_PER_CANVAS;
    const oldestIds = runStore.getOldestCompletedRunIds(canvasId, overflow);
    for (const runId of oldestIds) {
      this.deleteRun(runId);
    }
  }

  startPodInstance(runContext: RunContext, podId: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `startPodInstance: 找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    runStore.updatePodInstanceStatus(instance.id, 'running');

    const updatedInstance = runStore.getPodInstance(runContext.runId, podId);
    socketService.emitToCanvas(runContext.canvasId, WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, {
      runId: runContext.runId,
      canvasId: runContext.canvasId,
      podId,
      status: updatedInstance?.status ?? 'error',
      errorMessage: updatedInstance?.errorMessage ?? undefined,
      triggeredAt: updatedInstance?.triggeredAt ?? undefined,
      completedAt: updatedInstance?.completedAt ?? undefined,
    } as RunPodStatusChangedPayload);
  }

  completePodInstance(runContext: RunContext, podId: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `completePodInstance: 找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    runStore.updatePodInstanceStatus(instance.id, 'completed');

    const updatedInstance = runStore.getPodInstance(runContext.runId, podId);
    socketService.emitToCanvas(runContext.canvasId, WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, {
      runId: runContext.runId,
      canvasId: runContext.canvasId,
      podId,
      status: updatedInstance?.status ?? 'error',
      errorMessage: updatedInstance?.errorMessage ?? undefined,
      triggeredAt: updatedInstance?.triggeredAt ?? undefined,
      completedAt: updatedInstance?.completedAt ?? undefined,
    } as RunPodStatusChangedPayload);

    this.evaluateRunStatus(runContext.runId, runContext.canvasId);
  }

  errorPodInstance(runContext: RunContext, podId: string, errorMessage: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `errorPodInstance: 找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    runStore.updatePodInstanceStatus(instance.id, 'error', errorMessage);

    const updatedInstance = runStore.getPodInstance(runContext.runId, podId);
    socketService.emitToCanvas(runContext.canvasId, WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, {
      runId: runContext.runId,
      canvasId: runContext.canvasId,
      podId,
      status: updatedInstance?.status ?? 'error',
      errorMessage: updatedInstance?.errorMessage ?? undefined,
      triggeredAt: updatedInstance?.triggeredAt ?? undefined,
      completedAt: updatedInstance?.completedAt ?? undefined,
    } as RunPodStatusChangedPayload);

    this.evaluateRunStatus(runContext.runId, runContext.canvasId);
  }

  summarizingPodInstance(runContext: RunContext, podId: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `summarizingPodInstance: 找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    runStore.updatePodInstanceStatus(instance.id, 'summarizing');

    const updatedInstance = runStore.getPodInstance(runContext.runId, podId);
    socketService.emitToCanvas(runContext.canvasId, WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, {
      runId: runContext.runId,
      canvasId: runContext.canvasId,
      podId,
      status: updatedInstance?.status ?? 'summarizing',
      errorMessage: updatedInstance?.errorMessage ?? undefined,
      triggeredAt: updatedInstance?.triggeredAt ?? undefined,
      completedAt: updatedInstance?.completedAt ?? undefined,
    } as RunPodStatusChangedPayload);
  }

  skipPodInstance(runContext: RunContext, podId: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `skipPodInstance: 找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    runStore.updatePodInstanceStatus(instance.id, 'skipped');

    const updatedInstance = runStore.getPodInstance(runContext.runId, podId);
    socketService.emitToCanvas(runContext.canvasId, WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, {
      runId: runContext.runId,
      canvasId: runContext.canvasId,
      podId,
      status: updatedInstance?.status ?? 'skipped',
      errorMessage: updatedInstance?.errorMessage ?? undefined,
      triggeredAt: updatedInstance?.triggeredAt ?? undefined,
      completedAt: updatedInstance?.completedAt ?? undefined,
    } as RunPodStatusChangedPayload);

    this.evaluateRunStatus(runContext.runId, runContext.canvasId);
  }

  /**
   * 判斷規則：
   * - 全部 completed/skipped → completed
   * - 有 error 且無 running/pending/summarizing → error
   * - 其他 → 維持 running（不更新）
   * 巢狀條件超過閾值，加此說明
   */
  private evaluateRunStatus(runId: string, canvasId: string): void {
    const instances = runStore.getPodInstancesByRunId(runId);
    if (instances.length === 0) return;

    const hasError = instances.some((i) => i.status === 'error');
    const hasInProgress = instances.some(
      (i) => i.status === 'running' || i.status === 'pending' || i.status === 'summarizing',
    );
    const allDone = instances.every((i) => i.status === 'completed' || i.status === 'skipped');

    let newStatus: 'completed' | 'error' | null = null;

    if (allDone) {
      newStatus = 'completed';
    } else if (hasError && !hasInProgress) {
      newStatus = 'error';
    }

    if (!newStatus) return;

    runStore.updateRunStatus(runId, newStatus);
    const updatedRun = runStore.getRun(runId);

    logger.log('Run', 'Complete', `Run ${runId} 狀態變更為 ${newStatus}`);

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_STATUS_CHANGED, {
      runId,
      canvasId,
      status: newStatus,
      completedAt: updatedRun?.completedAt ?? undefined,
    } as RunStatusChangedPayload);
  }

  registerActiveStream(runId: string, podId: string): void {
    if (!this.activeRunStreams.has(runId)) {
      this.activeRunStreams.set(runId, new Set());
    }
    this.activeRunStreams.get(runId)!.add(podId);
  }

  unregisterActiveStream(runId: string, podId: string): void {
    const streams = this.activeRunStreams.get(runId);
    if (!streams) return;

    streams.delete(podId);
    if (streams.size === 0) {
      this.activeRunStreams.delete(runId);
    }
  }

  deleteRun(runId: string): void {
    const activePodIds = this.activeRunStreams.get(runId);
    if (activePodIds) {
      for (const podId of activePodIds) {
        // Run mode 的 query key 是 ${runId}:${podId}
        claudeService.abortQuery(`${runId}:${podId}`);
      }
      this.activeRunStreams.delete(runId);
    }

    const run = runStore.getRun(runId);
    const canvasId = run?.canvasId ?? '';

    runStore.deleteRun(runId);
    logger.log('Run', 'Delete', `刪除 Run ${runId}`);

    if (canvasId) {
      socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_DELETED, {
        runId,
        canvasId,
      } as RunDeletedPayload);
    }
  }
}

export const runExecutionService = new RunExecutionService();
