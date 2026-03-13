import { connectionStore } from '../connectionStore.js';
import { pendingTargetStore } from '../pendingTargetStore.js';
import { podStore } from '../podStore.js';
import { directTriggerStore } from '../directTriggerStore.js';
import { workflowEventEmitter } from './workflowEventEmitter.js';
import { formatMergedSummaries, isAutoTriggerable } from './workflowHelpers.js';
import { workflowDirectTriggerService } from './workflowDirectTriggerService.js';
import {
  type WorkflowPendingPayload,
  type WorkflowSourcesMergedPayload,
} from '../../types/index.js';
import type { RunContext } from '../../types/run.js';
import { logger } from '../../utils/logger.js';
import { MERGED_CONTENT_PREVIEW_MAX_LENGTH } from './constants.js';

function emitMergedIfAllComplete(
  canvasId: string,
  targetPodId: string,
  emitPendingStatus: (canvasId: string, targetPodId: string, runContext?: RunContext) => void,
  runContext?: RunContext
): boolean {
  const pending = pendingTargetStore.getPendingTarget(targetPodId);
  if (!pending) {
    return false;
  }

  if (pending.requiredSourcePodIds.length === 0) {
    pendingTargetStore.clearPendingTarget(targetPodId);
    return true;
  }

  const allComplete = pending.completedSources.size >= pending.requiredSourcePodIds.length;
  if (!allComplete) {
    emitPendingStatus(canvasId, targetPodId, runContext);
    return false;
  }

  const completedSummaries = pendingTargetStore.getCompletedSummaries(targetPodId);
  if (!completedSummaries) {
    return false;
  }

  const mergedContent = formatMergedSummaries(completedSummaries, (podId) => podStore.getById(canvasId, podId));
  const sourcePodIds = Array.from(completedSummaries.keys());

  const mergedPayload: WorkflowSourcesMergedPayload = {
    canvasId,
    targetPodId,
    sourcePodIds,
    mergedContentPreview: mergedContent.substring(0, MERGED_CONTENT_PREVIEW_MAX_LENGTH),
  };

  if (!runContext) {
    workflowEventEmitter.emitWorkflowSourcesMerged(canvasId, mergedPayload);
  }
  return true;
}

class WorkflowStateService {

  checkMultiInputScenario(canvasId: string, targetPodId: string): { isMultiInput: boolean; requiredSourcePodIds: string[] } {
    const incomingConnections = connectionStore.findByTargetPodId(canvasId, targetPodId);
    const triggerableConnections = incomingConnections.filter((connection) => isAutoTriggerable(connection.triggerMode));
    const requiredSourcePodIds = triggerableConnections.map((connection) => connection.sourcePodId);

    return {
      isMultiInput: triggerableConnections.length > 1,
      requiredSourcePodIds,
    };
  }

  getDirectConnectionCount(canvasId: string, targetPodId: string): number {
    const incomingConnections = connectionStore.findByTargetPodId(canvasId, targetPodId);
    return incomingConnections.filter((connection) => connection.triggerMode === 'direct').length;
  }

  emitPendingStatus(canvasId: string, targetPodId: string, runContext?: RunContext): void {
    if (runContext) return;

    const pending = pendingTargetStore.getPendingTarget(targetPodId);
    if (!pending) {
      return;
    }

    const completedSourcePodIds = Array.from(pending.completedSources.keys());
    const rejectedSourcePodIds = Array.from(pending.rejectedSources.keys());
    const pendingSourcePodIds = pending.requiredSourcePodIds.filter(
      (id) => !completedSourcePodIds.includes(id) && !rejectedSourcePodIds.includes(id)
    );

    const pendingPayload: WorkflowPendingPayload = {
      canvasId,
      targetPodId,
      completedSourcePodIds,
      pendingSourcePodIds,
      totalSources: pending.requiredSourcePodIds.length,
      completedCount: pending.completedSources.size,
      rejectedSourcePodIds,
      hasRejectedSources: rejectedSourcePodIds.length > 0,
    };

    workflowEventEmitter.emitWorkflowPending(canvasId, pendingPayload);
  }

  private tryCompletePendingOrClear(canvasId: string, targetPodId: string, logReason: string, runContext?: RunContext): void {
    const pending = pendingTargetStore.getPendingTarget(targetPodId);
    if (!pending) {
      return;
    }

    if (pending.requiredSourcePodIds.length === 0) {
      pendingTargetStore.clearPendingTarget(targetPodId);
      logger.log('Workflow', 'Delete', `已清除等待目標 ${targetPodId} - ${logReason}`);
      return;
    }

    logger.log('Workflow', 'Update', `${logReason}，但目標 ${targetPodId} 的剩餘來源已全部完成`);
    emitMergedIfAllComplete(canvasId, targetPodId, this.emitPendingStatus.bind(this), runContext);
  }

  private processAffectedTarget(canvasId: string, targetPodId: string): void {
    this.tryCompletePendingOrClear(canvasId, targetPodId, '來源已刪除，無剩餘來源');
  }

  handleSourceDeletion(canvasId: string, sourcePodId: string): string[] {
    const affectedTargetIds = pendingTargetStore.removeSourceFromAllPending(sourcePodId);

    for (const targetPodId of affectedTargetIds) {
      this.processAffectedTarget(canvasId, targetPodId);
    }

    return affectedTargetIds;
  }

  private handleDirectConnectionDeletion(targetPodId: string): void {
    if (directTriggerStore.hasDirectPending(targetPodId)) {
      directTriggerStore.clearDirectPending(targetPodId);
      logger.log('Workflow', 'Delete', `已清除目標 ${targetPodId} 的 direct 等待狀態 - 連線已刪除`);
    }

    workflowDirectTriggerService.cancelPendingResolver(targetPodId);
  }

  private handleMultiInputConnectionDeletion(canvasId: string, sourcePodId: string, targetPodId: string): void {
    if (!pendingTargetStore.hasPendingTarget(targetPodId)) {
      return;
    }

    pendingTargetStore.removeSourceFromPending(targetPodId, sourcePodId);

    this.tryCompletePendingOrClear(canvasId, targetPodId, '連線已刪除，無剩餘來源');
  }

  handleConnectionDeletion(canvasId: string, connectionId: string): void {
    const connection = connectionStore.getById(canvasId, connectionId);
    if (!connection) {
      return;
    }

    const { sourcePodId, targetPodId, triggerMode } = connection;

    if (triggerMode === 'direct') {
      this.handleDirectConnectionDeletion(targetPodId);
      return;
    }

    if (!isAutoTriggerable(triggerMode)) {
      return;
    }

    this.handleMultiInputConnectionDeletion(canvasId, sourcePodId, targetPodId);
  }
}

export const workflowStateService = new WorkflowStateService();
