import { WebSocketResponseEvents } from "../schemas";
import type {
  ConnectionCreatedPayload,
  ConnectionListResultPayload,
  ConnectionDeletedPayload,
  ConnectionUpdatedPayload,
  PodScheduleSetPayload,
  Connection,
  Pod,
  TriggerMode,
} from "../types";
import { toPodPublicView } from "../types/index.js";
import type {
  ConnectionCreatePayload,
  ConnectionListPayload,
  ConnectionDeletePayload,
  ConnectionUpdatePayload,
} from "../schemas";
import type { ProviderName } from "../services/provider/index.js";
import { connectionStore } from "../services/connectionStore.js";
import { podStore } from "../services/podStore.js";
import { workflowStateService } from "../services/workflow";
import { socketService } from "../services/socketService.js";
import {
  emitSuccess,
  emitError,
  emitNotFound,
} from "../utils/websocketResponse.js";
import { logger } from "../utils/logger.js";
import { createI18nError } from "../utils/i18nError.js";
import { withCanvasId, getPodDisplayName } from "../utils/handlerHelpers.js";

function findConnectionOrEmitError(
  wsConnectionId: string,
  canvasId: string,
  connectionId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string,
): Connection | undefined {
  const connection = connectionStore.getById(canvasId, connectionId);

  if (!connection) {
    emitNotFound(
      wsConnectionId,
      responseEvent,
      "Connection",
      connectionId,
      requestId,
      canvasId,
    );
    return undefined;
  }

  return connection;
}

function findPodsOrEmitError(
  wsConnectionId: string,
  canvasId: string,
  sourcePodId: string,
  targetPodId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string,
): { sourcePod: Pod; targetPod: Pod } | undefined {
  const sourcePod = podStore.getById(canvasId, sourcePodId);

  if (!sourcePod) {
    emitError(
      wsConnectionId,
      responseEvent,
      createI18nError("errors.sourcePodNotFound", { id: sourcePodId }),
      canvasId,
      requestId,
      undefined,
      "NOT_FOUND",
    );
    return undefined;
  }

  const targetPod = podStore.getById(canvasId, targetPodId);

  if (!targetPod) {
    emitError(
      wsConnectionId,
      responseEvent,
      createI18nError("errors.targetPodNotFound", { id: targetPodId }),
      canvasId,
      requestId,
      undefined,
      "NOT_FOUND",
    );
    return undefined;
  }

  return { sourcePod, targetPod };
}

export const handleConnectionCreate = withCanvasId<ConnectionCreatePayload>(
  WebSocketResponseEvents.CONNECTION_CREATED,
  async (
    connectionId: string,
    canvasId: string,
    payload: ConnectionCreatePayload,
    requestId: string,
  ): Promise<void> => {
    const {
      sourcePodId,
      sourceAnchor,
      targetPodId,
      targetAnchor,
      summaryModel,
      summaryProvider,
      summaryThinkingLevel,
      label,
      description,
      branchProvider,
      branchModel,
      branchThinkingLevel,
    } = payload;

    const pods = findPodsOrEmitError(
      connectionId,
      canvasId,
      sourcePodId,
      targetPodId,
      WebSocketResponseEvents.CONNECTION_CREATED,
      requestId,
    );
    if (!pods) return;

    const { sourcePod, targetPod } = pods;

    let connection: ReturnType<typeof connectionStore.create>;
    try {
      connection = connectionStore.create(canvasId, {
        sourcePodId,
        sourceAnchor,
        targetPodId,
        targetAnchor,
        ...(summaryModel !== undefined && { summaryModel }),
        ...(summaryProvider !== undefined && { summaryProvider }),
        ...(summaryThinkingLevel !== undefined && { summaryThinkingLevel }),
        label,
        description,
        branchProvider,
        branchModel,
        ...(branchThinkingLevel !== undefined && { branchThinkingLevel }),
      });
    } catch (err) {
      emitError(
        connectionId,
        WebSocketResponseEvents.CONNECTION_CREATED,
        err instanceof Error ? err : new Error(String(err)),
        canvasId,
        requestId,
        undefined,
        "VALIDATION_ERROR",
      );
      return;
    }

    const response: ConnectionCreatedPayload = {
      requestId,
      canvasId,
      success: true,
      connection,
    };

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.CONNECTION_CREATED,
      response,
    );

    if (targetPod.schedule) {
      const result = podStore.update(canvasId, targetPodId, { schedule: null });

      if (result) {
        const podSchedulePayload: PodScheduleSetPayload = {
          requestId: "",
          canvasId,
          success: true,
          pod: toPodPublicView(result.pod),
        };
        socketService.emitToCanvas(
          canvasId,
          WebSocketResponseEvents.POD_SCHEDULE_SET,
          podSchedulePayload,
        );

        logger.log(
          "Connection",
          "Create",
          `已清除目標 Pod「${targetPod.name}」的排程（現為下游節點）`,
        );
      }
    }

    logger.log(
      "Connection",
      "Create",
      `已建立連線「${sourcePod.name} → ${targetPod.name}」`,
    );
  },
);

export const handleConnectionList = withCanvasId<ConnectionListPayload>(
  WebSocketResponseEvents.CONNECTION_LIST_RESULT,
  async (
    connectionId: string,
    canvasId: string,
    _payload: ConnectionListPayload,
    requestId: string,
  ): Promise<void> => {
    const connections = connectionStore.list(canvasId);

    const response: ConnectionListResultPayload = {
      requestId,
      success: true,
      connections,
    };

    emitSuccess(
      connectionId,
      WebSocketResponseEvents.CONNECTION_LIST_RESULT,
      response,
    );
  },
);

export const handleConnectionDelete = withCanvasId<ConnectionDeletePayload>(
  WebSocketResponseEvents.CONNECTION_DELETED,
  async (
    wsConnectionId: string,
    canvasId: string,
    payload: ConnectionDeletePayload,
    requestId: string,
  ): Promise<void> => {
    const { connectionId } = payload;

    const connection = findConnectionOrEmitError(
      wsConnectionId,
      canvasId,
      connectionId,
      WebSocketResponseEvents.CONNECTION_DELETED,
      requestId,
    );
    if (!connection) return;

    workflowStateService.handleConnectionDeletion(canvasId, connectionId);

    const deleted = connectionStore.delete(canvasId, connectionId);

    if (!deleted) {
      emitError(
        wsConnectionId,
        WebSocketResponseEvents.CONNECTION_DELETED,
        createI18nError("errors.connectionDeleteFailed", { id: connectionId }),
        canvasId,
        requestId,
        undefined,
        "INTERNAL_ERROR",
      );
      return;
    }

    const response: ConnectionDeletedPayload = {
      requestId,
      canvasId,
      success: true,
      connectionId,
    };

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.CONNECTION_DELETED,
      response,
    );

    logger.log(
      "Connection",
      "Delete",
      `已刪除連線「${getPodDisplayName(canvasId, connection.sourcePodId)} → ${getPodDisplayName(canvasId, connection.targetPodId)}」`,
    );
  },
);

export const handleConnectionUpdate = withCanvasId<ConnectionUpdatePayload>(
  WebSocketResponseEvents.CONNECTION_UPDATED,
  async (
    wsConnectionId: string,
    canvasId: string,
    payload: ConnectionUpdatePayload,
    requestId: string,
  ): Promise<void> => {
    // 授權邊界說明：本工具為本地單使用者場景，不存在多使用者概念，
    // canvas membership 驗證由 withCanvasId 確保 canvasId 合法即可，
    // 無需額外的使用者身份驗證。
    const {
      connectionId,
      triggerMode,
      summaryModel,
      summaryProvider,
      summaryThinkingLevel,
      label,
      description,
      branchProvider,
      branchModel,
      branchThinkingLevel,
    } = payload;

    const connection = findConnectionOrEmitError(
      wsConnectionId,
      canvasId,
      connectionId,
      WebSocketResponseEvents.CONNECTION_UPDATED,
      requestId,
    );
    if (!connection) return;

    const updates: Partial<{
      triggerMode: TriggerMode;
      summaryModel: string;
      summaryProvider: ProviderName;
      summaryThinkingLevel: string | null;
      label: string;
      description: string | null;
      branchProvider: ProviderName | null;
      branchModel: string | null;
      branchThinkingLevel: string | null;
    }> = {};
    if (triggerMode !== undefined) {
      updates.triggerMode = triggerMode;
    }
    if (summaryModel !== undefined) {
      updates.summaryModel = summaryModel;
    }
    if (summaryProvider !== undefined) {
      // 使用者透過右鍵選單切換 Summary Provider 時更新
      updates.summaryProvider = summaryProvider;
    }
    if (summaryThinkingLevel !== undefined) {
      updates.summaryThinkingLevel = summaryThinkingLevel;
    }
    if (label !== undefined) {
      updates.label = label;
    }
    if (description !== undefined) {
      updates.description = description ?? null;
    }
    if (branchProvider !== undefined) {
      updates.branchProvider = branchProvider;
    }
    if (branchModel !== undefined) {
      updates.branchModel = branchModel;
    }
    if (branchThinkingLevel !== undefined) {
      updates.branchThinkingLevel = branchThinkingLevel;
    }

    let updateResult: ReturnType<
      typeof connectionStore.updateBranchSiblingSettings
    >;
    try {
      updateResult = connectionStore.updateBranchSiblingSettings(
        canvasId,
        connectionId,
        updates,
      );
    } catch (err) {
      emitError(
        wsConnectionId,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        err instanceof Error ? err : new Error(String(err)),
        canvasId,
        requestId,
        undefined,
        "VALIDATION_ERROR",
      );
      return;
    }

    if (!updateResult) {
      emitError(
        wsConnectionId,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        createI18nError("errors.connectionUpdateFailed", { id: connectionId }),
        canvasId,
        requestId,
        undefined,
        "INTERNAL_ERROR",
      );
      return;
    }

    const response: ConnectionUpdatedPayload = {
      requestId,
      canvasId,
      success: true,
      connection: updateResult.targetConnection,
      connections: updateResult.updatedConnections,
    };

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.CONNECTION_UPDATED,
      response,
    );
  },
);
