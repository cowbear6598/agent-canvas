import { v4 as uuidv4 } from 'uuid';
import { socketService } from '../socketService.js';
import { WebSocketResponseEvents } from '../../schemas/index.js';
import type {
  WorkflowAutoTriggeredPayload,
  WorkflowPendingPayload,
  WorkflowSourcesMergedPayload,
  WorkflowAiDecidePendingPayload,
  WorkflowAiDecideResultPayload,
  WorkflowAiDecideErrorPayload,
  WorkflowAiDecideClearPayload,
  WorkflowAiDecideTriggeredPayload,
  WorkflowDirectTriggeredPayload,
  WorkflowDirectWaitingPayload,
  WorkflowQueuedPayload,
  WorkflowQueueProcessedPayload,
  WorkflowDirectMergedPayload,
} from '../../types/index.js';

class WorkflowEventEmitter {
  emitWorkflowComplete(params: {
    canvasId: string;
    connectionId: string;
    sourcePodId: string;
    targetPodId: string;
    success: boolean;
    error?: string;
    triggerMode: string;
  }): void {
    const { canvasId, connectionId, targetPodId, success, error, triggerMode } = params;
    const payload: {
      canvasId: string;
      requestId: string;
      connectionId: string;
      targetPodId: string;
      success: boolean;
      error?: string;
      triggerMode?: string;
    } = {
      canvasId,
      requestId: uuidv4(),
      connectionId,
      targetPodId,
      success,
    };

    if (error) {
      payload.error = error;
    }

    if (triggerMode) {
      payload.triggerMode = triggerMode;
    }

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_COMPLETE, payload);
  }

  emitWorkflowAutoTriggered(canvasId: string, payload: WorkflowAutoTriggeredPayload): void {
    const fullPayload = {
      ...payload,
      canvasId,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED, fullPayload);
  }

  emitWorkflowPending(canvasId: string, payload: WorkflowPendingPayload): void {
    const fullPayload = {
      ...payload,
      canvasId,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_PENDING, fullPayload);
  }

  emitWorkflowSourcesMerged(canvasId: string, payload: WorkflowSourcesMergedPayload): void {
    const fullPayload = {
      ...payload,
      canvasId,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_SOURCES_MERGED, fullPayload);
  }

  emitAiDecidePending(canvasId: string, connectionIds: string[], sourcePodId: string): void {
    const payload: WorkflowAiDecidePendingPayload = {
      canvasId,
      connectionIds,
      sourcePodId,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_AI_DECIDE_PENDING, payload);
  }

  emitAiDecideResult(params: {
    canvasId: string;
    connectionId: string;
    sourcePodId: string;
    targetPodId: string;
    shouldTrigger: boolean;
    reason: string;
  }): void {
    const payload: WorkflowAiDecideResultPayload = { ...params };
    socketService.emitToCanvas(params.canvasId, WebSocketResponseEvents.WORKFLOW_AI_DECIDE_RESULT, payload);
  }

  emitAiDecideError(params: {
    canvasId: string;
    connectionId: string;
    sourcePodId: string;
    targetPodId: string;
    error: string;
  }): void {
    const payload: WorkflowAiDecideErrorPayload = { ...params };
    socketService.emitToCanvas(params.canvasId, WebSocketResponseEvents.WORKFLOW_AI_DECIDE_ERROR, payload);
  }

  emitAiDecideClear(canvasId: string, connectionIds: string[]): void {
    const payload: WorkflowAiDecideClearPayload = {
      canvasId,
      connectionIds,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_AI_DECIDE_CLEAR, payload);
  }

  emitWorkflowAiDecideTriggered(
    canvasId: string,
    connectionId: string,
    sourcePodId: string,
    targetPodId: string
  ): void {
    const payload: WorkflowAiDecideTriggeredPayload = {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_AI_DECIDE_TRIGGERED, payload);
  }

  emitDirectTriggered(canvasId: string, payload: WorkflowDirectTriggeredPayload): void {
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED, payload);
  }

  emitDirectWaiting(canvasId: string, payload: WorkflowDirectWaitingPayload): void {
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_DIRECT_WAITING, payload);
  }

  emitWorkflowQueued(canvasId: string, payload: WorkflowQueuedPayload): void {
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_QUEUED, payload);
  }

  emitWorkflowQueueProcessed(canvasId: string, payload: WorkflowQueueProcessedPayload): void {
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED, payload);
  }

  emitDirectCountdown(canvasId: string, targetPodId: string, remainingSeconds: number, readySourcePodIds: string[]): void {
    const payload = {
      canvasId,
      targetPodId,
      remainingSeconds,
      readySourcePodIds,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_DIRECT_COUNTDOWN, payload);
  }

  emitDirectMerged(canvasId: string, payload: WorkflowDirectMergedPayload): void {
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_DIRECT_MERGED, payload);
  }
}

export const workflowEventEmitter = new WorkflowEventEmitter();
