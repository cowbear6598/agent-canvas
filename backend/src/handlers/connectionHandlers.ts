import { WebSocketResponseEvents } from "../schemas";
import type { Connection, Pod } from "../types";
import type {
  ConnectionCreatePayload,
  ConnectionListPayload,
  ConnectionDeletePayload,
  ConnectionUpdatePayload,
} from "../schemas";
import { connectionStore } from "../services/connectionStore.js";
import { podStore } from "../services/podStore.js";
import {
  emitNotFound,
  emitError,
} from "../utils/websocketResponse.js";
import { createI18nError } from "../utils/i18nError.js";
import { withCanvasId } from "../utils/handlerHelpers.js";
import { dispatchApplicationCommand } from "../services/commands/applicationCommand.js";
import { connectionCommandService } from "../services/commands/connectionCommandService.js";

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
      targetPodId,
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

    dispatchApplicationCommand(
      connectionCommandService.create({
        canvasId,
        requestId,
        payload,
        sourcePod: pods.sourcePod,
        targetPod: pods.targetPod,
      }),
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
    dispatchApplicationCommand(
      connectionCommandService.list({
        connectionId,
        canvasId,
        requestId,
      }),
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

    dispatchApplicationCommand(
      connectionCommandService.delete({
        canvasId,
        requestId,
        connectionId,
        connection,
      }),
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
    const { connectionId } = payload;

    const connection = findConnectionOrEmitError(
      wsConnectionId,
      canvasId,
      connectionId,
      WebSocketResponseEvents.CONNECTION_UPDATED,
      requestId,
    );
    if (!connection) return;

    dispatchApplicationCommand(
      connectionCommandService.update({
        canvasId,
        requestId,
        payload,
      }),
    );
  },
);
