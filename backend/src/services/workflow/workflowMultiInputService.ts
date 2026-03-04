import {WebSocketResponseEvents} from '../../schemas/index.js';
import type {
  WorkflowSourcesMergedPayload,
  Connection,
  AutoTriggerMode,
} from '../../types/index.js';
import type { ExecutionServiceMethods, TriggerStrategy, HandleMultiInputForConnectionParams } from './types.js';
import {podStore} from '../podStore.js';
import {socketService} from '../socketService.js';
import {pendingTargetStore} from '../pendingTargetStore.js';
import {workflowQueueService} from './workflowQueueService.js';
import {workflowStateService} from './workflowStateService.js';
import {logger} from '../../utils/logger.js';
import {formatMergedSummaries} from './workflowHelpers.js';
import {autoClearService} from '../autoClear/autoClearService.js';
import { LazyInitializable } from './lazyInitializable.js';
import { MERGED_CONTENT_PREVIEW_MAX_LENGTH } from './constants.js';
import { fireAndForget } from '../../utils/operationHelpers.js';

interface MultiInputServiceDeps {
  executionService: ExecutionServiceMethods;
  strategies: { auto: TriggerStrategy; direct: TriggerStrategy; 'ai-decide': TriggerStrategy };
}

class WorkflowMultiInputService extends LazyInitializable<MultiInputServiceDeps> {
  private isTargetPodBusy(targetPod: ReturnType<typeof podStore.getById>): boolean {
    return !!targetPod && (targetPod.status === 'chatting' || targetPod.status === 'summarizing');
  }

  private enqueueIfBusy(
    canvasId: string,
    connection: Connection,
    completedSummaries: Map<string, string>,
    mergedContent: string,
    triggerMode: AutoTriggerMode
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
    });

    pendingTargetStore.clearPendingTarget(connection.targetPodId);
  }

  private recordAndCheckAllSourcesReady(
    targetPodId: string,
    sourcePodId: string,
    requiredSourcePodIds: string[],
    summary: string
  ): { ready: boolean; hasRejection: boolean } {
    if (!pendingTargetStore.hasPendingTarget(targetPodId)) {
      pendingTargetStore.initializePendingTarget(targetPodId, requiredSourcePodIds);
    }

    const { allSourcesResponded, hasRejection } = pendingTargetStore.recordSourceCompletion(
      targetPodId,
      sourcePodId,
      summary
    );

    return { ready: allSourcesResponded, hasRejection };
  }

  private getMergedContentOrNull(
    canvasId: string,
    targetPodId: string
  ): { completedSummaries: Map<string, string>; mergedContent: string } | null {
    const completedSummaries = pendingTargetStore.getCompletedSummaries(targetPodId);
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
    summary: string
  ): Promise<'not-ready' | 'rejected' | 'ready'> {
    const { ready, hasRejection } = this.recordAndCheckAllSourcesReady(
      connection.targetPodId,
      sourcePodId,
      requiredSourcePodIds,
      summary
    );

    if (!ready) {
      workflowStateService.emitPendingStatus(canvasId, connection.targetPodId);
      return 'not-ready';
    }

    if (hasRejection) {
      const targetPod = podStore.getById(canvasId, connection.targetPodId);
      logger.log('Workflow', 'Update', `目標「${targetPod?.name ?? connection.targetPodId}」有被拒絕的來源，不觸發`);
      workflowStateService.emitPendingStatus(canvasId, connection.targetPodId);
      await autoClearService.onGroupNotTriggered(canvasId, connection.targetPodId);
      return 'rejected';
    }

    return 'ready';
  }

  async handleMultiInputForConnection(params: HandleMultiInputForConnectionParams): Promise<void> {
    const {canvasId, sourcePodId, connection, requiredSourcePodIds, summary, triggerMode} = params;

    const readiness = await this.checkMultiInputReadiness(canvasId, sourcePodId, connection, requiredSourcePodIds, summary);
    if (readiness !== 'ready') return;

    const merged = this.getMergedContentOrNull(canvasId, connection.targetPodId);
    if (!merged) return;

    const targetPod = podStore.getById(canvasId, connection.targetPodId);
    if (this.isTargetPodBusy(targetPod)) {
      this.enqueueIfBusy(canvasId, connection, merged.completedSummaries, merged.mergedContent, triggerMode);
      return;
    }

    this.triggerMergedWorkflow(canvasId, connection, triggerMode);
  }

  triggerMergedWorkflow(
    canvasId: string,
    connection: Connection,
    triggerMode: AutoTriggerMode
  ): void {
    this.ensureInitialized();

    const completedSummaries = pendingTargetStore.getCompletedSummaries(connection.targetPodId);
    if (!completedSummaries) {
      logger.error('Workflow', 'Error', '無法取得已完成的摘要');
      return;
    }

    podStore.setStatus(canvasId, connection.targetPodId, 'chatting');

    const mergedContent = formatMergedSummaries(
      completedSummaries,
      (podId) => podStore.getById(canvasId, podId)
    );
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
      }),
      'Workflow',
      `觸發合併工作流程失敗 ${connection.id}`
    );

    pendingTargetStore.clearPendingTarget(connection.targetPodId);
  }
}

export const workflowMultiInputService = new WorkflowMultiInputService();
