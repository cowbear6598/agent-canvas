import {WebSocketResponseEvents} from '../../schemas/index.js';
import type {
  WorkflowSourcesMergedPayload,
  Connection,
  AutoTriggerMode,
} from '../../types/index.js';
import { isPodBusy } from '../../types/index.js';
import type { ExecutionServiceMethods, TriggerStrategy, HandleMultiInputForConnectionParams } from './types.js';
import type { RunContext } from '../../types/run.js';
import {podStore} from '../podStore.js';
import {socketService} from '../socketService.js';
import {pendingTargetStore} from '../pendingTargetStore.js';
import {workflowQueueService} from './workflowQueueService.js';
import {workflowStateService} from './workflowStateService.js';
import {logger} from '../../utils/logger.js';
import {formatMergedSummaries} from './workflowHelpers.js';
import { LazyInitializable } from './lazyInitializable.js';
import { MERGED_CONTENT_PREVIEW_MAX_LENGTH } from './constants.js';
import { fireAndForget } from '../../utils/operationHelpers.js';

interface MultiInputServiceDeps {
  executionService: ExecutionServiceMethods;
  strategies: { auto: TriggerStrategy; direct: TriggerStrategy; 'ai-decide': TriggerStrategy };
}

class WorkflowMultiInputService extends LazyInitializable<MultiInputServiceDeps> {
  private isTargetPodBusy(targetPod: ReturnType<typeof podStore.getById>): boolean {
    if (targetPod === undefined) return false;
    return isPodBusy(targetPod.status);
  }

  private enqueueIfBusy(
    canvasId: string,
    connection: Connection,
    completedSummaries: Map<string, string>,
    mergedContent: string,
    triggerMode: AutoTriggerMode,
    runContext?: RunContext
  ): void {
    const targetPod = podStore.getById(canvasId, connection.targetPodId);
    logger.log('Workflow', 'Update', `目標 Pod "${targetPod?.name ?? connection.targetPodId}" 忙碌中，將合併的 workflow 加入佇列`);

    const primarySourcePodId = Array.from(completedSummaries.keys())[0];

    workflowQueueService.enqueue({
      canvasId,
      connectionId: connection.id,
      sourcePodId: primarySourcePodId,
      targetPodId: connection.targetPodId,
      summary: mergedContent,
      isSummarized: true,
      triggerMode,
      runContext,
    });

    const pendingKey = runContext ? `${runContext.runId}:${connection.targetPodId}` : connection.targetPodId;
    pendingTargetStore.clearPendingTarget(pendingKey);
  }

  private recordAndCheckAllSourcesReady(
    targetPodId: string,
    sourcePodId: string,
    requiredSourcePodIds: string[],
    summary: string,
    runContext?: RunContext
  ): { ready: boolean; hasRejection: boolean } {
    const pendingKey = runContext ? `${runContext.runId}:${targetPodId}` : targetPodId;
    const { allSourcesResponded, hasRejection } = pendingTargetStore.recordSourceCompletion(
      pendingKey,
      sourcePodId,
      summary,
      requiredSourcePodIds
    );

    return { ready: allSourcesResponded, hasRejection };
  }

  private getMergedContentOrNull(
    canvasId: string,
    targetPodId: string,
    runContext?: RunContext
  ): { completedSummaries: Map<string, string>; mergedContent: string } | null {
    const pendingKey = runContext ? `${runContext.runId}:${targetPodId}` : targetPodId;
    const completedSummaries = pendingTargetStore.getCompletedSummaries(pendingKey);
    if (!completedSummaries) {
      logger.error('Workflow', 'Error', '無法取得已完成的摘要');
      return null;
    }

    const mergedContent = formatMergedSummaries(
      completedSummaries,
      (podId) => podStore.getById(canvasId, podId)
    );

    return { completedSummaries, mergedContent };
  }

  private async checkMultiInputReadiness(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    requiredSourcePodIds: string[],
    summary: string,
    runContext?: RunContext
  ): Promise<'not-ready' | 'rejected' | 'ready'> {
    const { ready, hasRejection } = this.recordAndCheckAllSourcesReady(
      connection.targetPodId,
      sourcePodId,
      requiredSourcePodIds,
      summary,
      runContext
    );

    if (!ready) {
      workflowStateService.emitPendingStatus(canvasId, connection.targetPodId);
      return 'not-ready';
    }

    if (hasRejection) {
      const targetPod = podStore.getById(canvasId, connection.targetPodId);
      logger.log('Workflow', 'Update', `目標「${targetPod?.name ?? connection.targetPodId}」有被拒絕的來源，不觸發`);
      workflowStateService.emitPendingStatus(canvasId, connection.targetPodId);
      return 'rejected';
    }

    return 'ready';
  }

  async handleMultiInputForConnection(params: HandleMultiInputForConnectionParams): Promise<void> {
    const {canvasId, sourcePodId, connection, requiredSourcePodIds, summary, triggerMode, runContext} = params;

    const readiness = await this.checkMultiInputReadiness(canvasId, sourcePodId, connection, requiredSourcePodIds, summary, runContext);
    if (readiness !== 'ready') return;

    const merged = this.getMergedContentOrNull(canvasId, connection.targetPodId, runContext);
    if (!merged) return;

    // run mode 下直接觸發，不進行忙碌檢查
    if (!runContext) {
      const targetPod = podStore.getById(canvasId, connection.targetPodId);
      if (this.isTargetPodBusy(targetPod)) {
        this.enqueueIfBusy(canvasId, connection, merged.completedSummaries, merged.mergedContent, triggerMode);
        return;
      }
    }

    this.triggerMergedWorkflow(canvasId, connection, triggerMode, runContext);
  }

  triggerMergedWorkflow(
    canvasId: string,
    connection: Connection,
    triggerMode: AutoTriggerMode,
    runContext?: RunContext
  ): void {
    const merged = this.getMergedContentOrNull(canvasId, connection.targetPodId, runContext);
    if (!merged) return;

    const { completedSummaries, mergedContent } = merged;

    if (!runContext) {
      podStore.setStatus(canvasId, connection.targetPodId, 'chatting');
    }

    const mergedPreview = mergedContent.substring(0, MERGED_CONTENT_PREVIEW_MAX_LENGTH);

    const sourcePodIds = Array.from(completedSummaries.keys());
    const mergedPayload: WorkflowSourcesMergedPayload = {
      canvasId,
      targetPodId: connection.targetPodId,
      sourcePodIds,
      mergedContentPreview: mergedPreview,
    };

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_SOURCES_MERGED,
      mergedPayload
    );

    const strategy = this.deps.strategies[triggerMode];
    // 刻意不 await：合併工作流程是長時間操作，結果透過 WebSocket 通知
    fireAndForget(
      this.deps.executionService.triggerWorkflowWithSummary({
        canvasId,
        connectionId: connection.id,
        summary: mergedContent,
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy,
        runContext,
      }),
      'Workflow',
      `觸發合併工作流程失敗 ${connection.id}`
    );

    const pendingKey = runContext ? `${runContext.runId}:${connection.targetPodId}` : connection.targetPodId;
    pendingTargetStore.clearPendingTarget(pendingKey);
  }
}

export const workflowMultiInputService = new WorkflowMultiInputService();
