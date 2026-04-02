import { WebSocketResponseEvents } from "../schemas";
import type {
  WorkflowGetDownstreamPodsResultPayload,
  WorkflowClearResultPayload,
} from "../types";
import type {
  WorkflowGetDownstreamPodsPayload,
  WorkflowClearPayload,
} from "../schemas";
import { workflowClearService } from "../services/workflowClearService.js";
import { podStore } from "../services/podStore.js";
import { socketService } from "../services/socketService.js";
import { workflowEventEmitter } from "../services/workflow";
import {
  emitSuccess,
  emitError,
  emitNotFound,
} from "../utils/websocketResponse.js";
import { withCanvasId } from "../utils/handlerHelpers.js";
import type { Pod } from "../types/index.js";
import { createI18nError } from "../utils/i18nError.js";

function findSourcePodOrEmitNotFound(
  connectionId: string,
  canvasId: string,
  sourcePodId: string,
  event: WebSocketResponseEvents,
  requestId: string,
): Pod | undefined {
  const sourcePod = podStore.getById(canvasId, sourcePodId);
  if (!sourcePod) {
    emitNotFound(connectionId, event, "Pod", sourcePodId, requestId);
    return undefined;
  }
  return sourcePod;
}

export const handleWorkflowGetDownstreamPods =
  withCanvasId<WorkflowGetDownstreamPodsPayload>(
    WebSocketResponseEvents.WORKFLOW_GET_DOWNSTREAM_PODS_RESULT,
    async (
      connectionId: string,
      canvasId: string,
      payload: WorkflowGetDownstreamPodsPayload,
      requestId: string,
    ): Promise<void> => {
      const { sourcePodId } = payload;

      if (
        !findSourcePodOrEmitNotFound(
          connectionId,
          canvasId,
          sourcePodId,
          WebSocketResponseEvents.WORKFLOW_GET_DOWNSTREAM_PODS_RESULT,
          requestId,
        )
      )
        return;

      const pods = workflowClearService.getDownstreamPods(
        canvasId,
        sourcePodId,
      );

      const response: WorkflowGetDownstreamPodsResultPayload = {
        requestId,
        success: true,
        pods,
      };

      emitSuccess(
        connectionId,
        WebSocketResponseEvents.WORKFLOW_GET_DOWNSTREAM_PODS_RESULT,
        response,
      );
    },
  );

export const handleWorkflowClear = withCanvasId<WorkflowClearPayload>(
  WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT,
  async (
    connectionId: string,
    canvasId: string,
    payload: WorkflowClearPayload,
    requestId: string,
  ): Promise<void> => {
    const { sourcePodId } = payload;

    if (
      !findSourcePodOrEmitNotFound(
        connectionId,
        canvasId,
        sourcePodId,
        WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT,
        requestId,
      )
    )
      return;

    const result = await workflowClearService.clearWorkflow(
      canvasId,
      sourcePodId,
    );

    if (!result.success) {
      emitError(
        connectionId,
        WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT,
        result.error ?? createI18nError("errors.workflowClearFailed"),
        requestId,
        undefined,
        "INTERNAL_ERROR",
      );
      return;
    }

    const response: WorkflowClearResultPayload = {
      requestId,
      canvasId,
      success: true,
      clearedPodIds: result.clearedPodIds,
      clearedPodNames: result.clearedPodNames,
    };

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT,
      response,
    );

    if (result.clearedConnectionIds.length > 0) {
      workflowEventEmitter.emitAiDecideClear(
        canvasId,
        result.clearedConnectionIds,
      );
    }
  },
);
