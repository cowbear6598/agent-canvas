import { runStore } from '../runStore.js';
import type { RunPodInstance, RunPodInstanceStatus } from '../runStore.js';
import { connectionStore } from '../connectionStore.js';
import { podStore } from '../podStore.js';
import { socketService } from '../socketService.js';
import { claudeService } from '../claude/claudeService.js';
import { logger } from '../../utils/logger.js';
import { WebSocketResponseEvents } from '../../schemas/events.js';
import { isAutoTriggerable } from './workflowHelpers.js';
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
    const instances = chainPodIds.map((podId) => {
      const pathways = this.calculatePathways(canvasId, podId, sourcePodId, chainPodIds);
      return runStore.createPodInstance(workflowRun.id, podId, pathways.autoPathwaySettled, pathways.directPathwaySettled);
    });

    const instancesWithNames = instances.map((instance) => {
      const pod = podStore.getById(canvasId, instance.podId);
      return {
        ...instance,
        podName: pod?.name ?? instance.podId,
      };
    });

    const sourcePodName = instancesWithNames.find((i) => i.podId === sourcePodId)?.podName ?? sourcePodId;

    logger.log('Run', 'Create', `建立 Run ${workflowRun.id}，共 ${instances.length} 個 pod instance`);

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CREATED, {
      canvasId,
      run: { ...workflowRun, podInstances: instancesWithNames, sourcePodName },
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

  private calculatePathways(
    canvasId: string,
    podId: string,
    sourcePodId: string,
    chainPodIds: string[],
  ): { autoPathwaySettled: boolean | null; directPathwaySettled: boolean | null } {
    if (podId === sourcePodId) {
      return { autoPathwaySettled: false, directPathwaySettled: null };
    }

    const connections = connectionStore.findByTargetPodId(canvasId, podId);
    const chainConnections = connections.filter((c) => chainPodIds.includes(c.sourcePodId));

    if (chainConnections.length === 0) {
      return { autoPathwaySettled: false, directPathwaySettled: null };
    }

    const hasAutoTriggerable = chainConnections.some((c) => isAutoTriggerable(c.triggerMode));
    const hasDirect = chainConnections.some((c) => c.triggerMode === 'direct');

    return {
      autoPathwaySettled: hasAutoTriggerable ? false : null,
      directPathwaySettled: hasDirect ? false : null,
    };
  }

  private isAllPathwaysSettled(instance: RunPodInstance): boolean {
    return (
      (instance.autoPathwaySettled === null || instance.autoPathwaySettled === true) &&
      (instance.directPathwaySettled === null || instance.directPathwaySettled === true)
    );
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
    this.updateAndEmitPodInstanceStatus(runContext, podId, 'running');
  }

  settlePodTrigger(runContext: RunContext, podId: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `settlePodTrigger：找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    runStore.settleAllPathways(instance.id);
    const updated = runStore.getPodInstance(runContext.runId, podId);
    if (!updated) return;

    if (this.isAllPathwaysSettled(updated) && updated.status !== 'pending') {
      this.updateAndEmitPodInstanceStatus(runContext, podId, 'completed', { evaluateRun: true });
    }
  }

  settleAndSkipPath(runContext: RunContext, podId: string, pathway: 'auto' | 'direct'): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `settleAndSkipPath：找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    if (pathway === 'auto') {
      runStore.settleAutoPathway(instance.id);
    } else {
      runStore.settleDirectPathway(instance.id);
    }

    const updated = runStore.getPodInstance(runContext.runId, podId);
    if (!updated || !this.isAllPathwaysSettled(updated)) return;

    // deciding 表示 AI 判斷中但 pod 本身從未真正執行，與 pending 同等視為「未觸發」
    const wasNeverTriggered = updated.status === 'pending' || updated.status === 'deciding';
    if (wasNeverTriggered) {
      this.updateAndEmitPodInstanceStatus(runContext, podId, 'skipped', { evaluateRun: true });
    } else {
      this.updateAndEmitPodInstanceStatus(runContext, podId, 'completed', { evaluateRun: true });
    }
  }

  /**
   * 在 evaluateRunStatus 前呼叫，偵測不可達路徑並直接更新 DB + emit WebSocket。
   * 不呼叫 settleAndSkipPath，避免遞迴觸發 evaluateRunStatus。
   * while 迴圈確保多層級聯 skip 能完整處理。
   * Auto 路徑：ANY auto-triggerable source skipped/error → 不可達
   * Direct 路徑：ALL direct sources skipped/error → 不可達
   */
  private settleUnreachablePaths(runId: string, canvasId: string): void {
    let instances = runStore.getPodInstancesByRunId(runId);
    const connections = connectionStore.list(canvasId);
    const instancePodIds = new Set(instances.map((i) => i.podId));
    let safetyLimit = instances.length;

    while (safetyLimit-- > 0) {
      let changed = false;

      for (const instance of instances) {
        if (instance.status !== 'pending' && instance.status !== 'deciding') continue;

        const incomingConns = connections.filter(
          (c) => c.targetPodId === instance.podId && instancePodIds.has(c.sourcePodId),
        );
        const autoConns = incomingConns.filter((c) => isAutoTriggerable(c.triggerMode));
        const directConns = incomingConns.filter((c) => c.triggerMode === 'direct');

        const autoUnreachable =
          instance.autoPathwaySettled === false &&
          autoConns.length > 0 &&
          autoConns.some((c) => {
            const src = instances.find((i) => i.podId === c.sourcePodId);
            return src && (src.status === 'skipped' || src.status === 'error');
          });

        const directUnreachable =
          instance.directPathwaySettled === false &&
          directConns.length > 0 &&
          directConns.every((c) => {
            const src = instances.find((i) => i.podId === c.sourcePodId);
            return src && (src.status === 'skipped' || src.status === 'error');
          });

        if (autoUnreachable) {
          runStore.settleAutoPathway(instance.id);
          instance.autoPathwaySettled = true;
        }

        if (directUnreachable) {
          runStore.settleDirectPathway(instance.id);
          instance.directPathwaySettled = true;
        }

        if (autoUnreachable || directUnreachable) {
          if (this.isAllPathwaysSettled(instance)) {
            // deciding 同 pending，視為「未觸發」
            const wasNeverTriggered = instance.status === 'pending' || instance.status === 'deciding';
            const newStatus = wasNeverTriggered ? 'skipped' : 'completed';
            runStore.updatePodInstanceStatus(instance.id, newStatus);
            instance.status = newStatus;

            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, {
              runId,
              canvasId,
              podId: instance.podId,
              status: newStatus,
              completedAt: new Date().toISOString(),
              autoPathwaySettled: instance.autoPathwaySettled,
              directPathwaySettled: instance.directPathwaySettled,
            } satisfies RunPodStatusChangedPayload);
          }
          changed = true;
        }
      }

      if (!changed) break;
    }

    if (safetyLimit <= 0) {
      logger.warn('Run', 'Warn', `settleUnreachablePaths 達到迭代上限 (runId: ${runId})`);
    }
  }

  errorPodInstance(runContext: RunContext, podId: string, errorMessage: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, 'error', { evaluateRun: true, errorMessage });
  }

  summarizingPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, 'summarizing');
  }

  decidingPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, 'deciding');
  }

  private updateAndEmitPodInstanceStatus(
    runContext: RunContext,
    podId: string,
    status: RunPodInstanceStatus,
    options?: { evaluateRun?: boolean; errorMessage?: string },
  ): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn('Run', 'Warn', `更新 pod instance 狀態失敗：找不到 instance (runId=${runContext.runId}, podId=${podId})`);
      return;
    }

    if (options?.errorMessage) {
      runStore.updatePodInstanceStatus(instance.id, status, options.errorMessage);
    } else {
      runStore.updatePodInstanceStatus(instance.id, status);
    }

    // running 時記錄啟動時間；其他狀態保留原有的 triggeredAt（與 SQL CASE WHEN 邏輯一致）
    const triggeredAt = status === 'running' ? new Date().toISOString() : instance.triggeredAt ?? undefined;
    const isTerminal = status === 'completed' || status === 'error' || status === 'skipped';
    const completedAt = isTerminal ? new Date().toISOString() : instance.completedAt ?? undefined;

    socketService.emitToCanvas(runContext.canvasId, WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, {
      runId: runContext.runId,
      canvasId: runContext.canvasId,
      podId,
      status,
      errorMessage: options?.errorMessage ?? instance.errorMessage ?? undefined,
      triggeredAt,
      completedAt,
      autoPathwaySettled: instance.autoPathwaySettled,
      directPathwaySettled: instance.directPathwaySettled,
    } satisfies RunPodStatusChangedPayload);

    if (options?.evaluateRun) {
      this.evaluateRunStatus(runContext.runId, runContext.canvasId);
    }
  }

  /**
   * 判斷規則：
   * - 全部 completed/skipped → completed
   * - 有 error 且無 running/pending/summarizing → error
   * - 其他 → 維持 running（不更新）
   * 巢狀條件超過閾值，加此說明
   */
  private evaluateRunStatus(runId: string, canvasId: string): void {
    this.settleUnreachablePaths(runId, canvasId);

    const instances = runStore.getPodInstancesByRunId(runId);
    if (instances.length === 0) return;

    const hasError = instances.some((i) => i.status === 'error');
    const hasInProgress = instances.some(
      (i) => i.status === 'running' || i.status === 'pending' || i.status === 'summarizing' || i.status === 'deciding',
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
