import { WebSocketResponseEvents } from "../schemas";
import type {
  WorkflowGetDownstreamPodsResultPayload,
  WorkflowClearResultPayload,
  ConnectionUpdatedPayload,
} from "../types";
import type {
  WorkflowGetDownstreamPodsPayload,
  WorkflowClearPayload,
} from "../schemas";
import { workflowClearService } from "../services/workflowClearService.js";
import { podStore } from "../services/podStore.js";
import { connectionStore } from "../services/connectionStore.js";
import { socketService } from "../services/socketService.js";
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
    emitNotFound(connectionId, event, "Pod", sourcePodId, requestId, canvasId);
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

/**
 * 【授權邊界說明 — handleWorkflowClear】
 *
 * 本專案為本地單使用者場景（single-tenant）：
 * 伺服器僅在本機執行，同一時間只有一位使用者操作同一個 canvas，
 * 不存在多使用者共用同一 canvas 的情況。
 *
 * 因此，此處不需要驗證「發出請求的 connection 是否為該 canvas 的成員」——
 * withCanvasId() 已從 connection session 解析出 canvasId，
 * 確保操作範圍限於自己的 canvas，已符合本地單使用者場景的授權需求。
 *
 * 若未來改為多使用者（multi-tenant）場景，需在此加入 canvas membership 驗證，
 * 確認 connectionId 對應的使用者確實擁有該 canvasId 的存取權限。
 */
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
        canvasId,
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

    for (const connId of result.clearedConnectionIds) {
      const conn = connectionStore.getById(canvasId, connId);
      if (conn) {
        const connUpdatedPayload: ConnectionUpdatedPayload = {
          requestId: "",
          canvasId,
          success: true,
          connection: conn,
        };
        socketService.emitToCanvas(
          canvasId,
          WebSocketResponseEvents.CONNECTION_UPDATED,
          connUpdatedPayload,
        );
      }
    }
  },
);
