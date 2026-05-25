import { v4 as uuidv4 } from "uuid";
import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/index.js";
import type {
  WorkflowAutoTriggeredPayload,
  WorkflowPendingPayload,
  WorkflowSourcesMergedPayload,
  WorkflowBranchTriggeredPayload,
  WorkflowDirectTriggeredPayload,
  WorkflowQueuedPayload,
  WorkflowQueueProcessedPayload,
} from "../../types/index.js";

class WorkflowEventEmitter {
  private emitWorkflowEvent(
    canvasId: string,
    event: WebSocketResponseEvents,
    payload: object,
  ): void {
    socketService.emitToCanvas(canvasId, event, { ...payload, canvasId });
  }

  emitWorkflowComplete(params: {
    canvasId: string;
    connectionId: string;
    sourcePodId: string;
    targetPodId: string;
    success: boolean;
    error?: string;
    triggerMode: string;
  }): void {
    const { canvasId, connectionId, targetPodId, success, error, triggerMode } =
      params;
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

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_COMPLETE,
      payload,
    );
  }

  emitWorkflowAutoTriggered(
    canvasId: string,
    payload: WorkflowAutoTriggeredPayload,
  ): void {
    this.emitWorkflowEvent(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
      payload,
    );
  }

  emitWorkflowPending(canvasId: string, payload: WorkflowPendingPayload): void {
    this.emitWorkflowEvent(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_PENDING,
      payload,
    );
  }

  emitWorkflowSourcesMerged(
    canvasId: string,
    payload: WorkflowSourcesMergedPayload,
  ): void {
    this.emitWorkflowEvent(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_SOURCES_MERGED,
      payload,
    );
  }

  emitBranchTriggered(
    canvasId: string,
    connectionId: string,
    sourcePodId: string,
    targetPodId: string,
  ): void {
    const payload: WorkflowBranchTriggeredPayload = {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
    };
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_BRANCH_TRIGGERED,
      payload,
    );
  }

  emitDirectTriggered(
    canvasId: string,
    payload: WorkflowDirectTriggeredPayload,
  ): void {
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED,
      payload,
    );
  }

  emitWorkflowQueued(canvasId: string, payload: WorkflowQueuedPayload): void {
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_QUEUED,
      payload,
    );
  }

  emitWorkflowQueueProcessed(
    canvasId: string,
    payload: WorkflowQueueProcessedPayload,
  ): void {
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED,
      payload,
    );
  }
}

export const workflowEventEmitter = new WorkflowEventEmitter();
