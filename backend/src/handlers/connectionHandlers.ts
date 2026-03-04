import { WebSocketResponseEvents } from '../schemas';
import type {
  ConnectionCreatedPayload,
  ConnectionListResultPayload,
  ConnectionDeletedPayload,
  ConnectionUpdatedPayload,
  PodScheduleSetPayload,
  Connection,
  Pod,
  TriggerMode,
} from '../types';
import type {
  ConnectionCreatePayload,
  ConnectionListPayload,
  ConnectionDeletePayload,
  ConnectionUpdatePayload,
} from '../schemas';
import { connectionStore } from '../services/connectionStore.js';
import { podStore } from '../services/podStore.js';
import { workflowStateService } from '../services/workflow';
import { socketService } from '../services/socketService.js';
import { emitSuccess, emitError, emitNotFound } from '../utils/websocketResponse.js';
import { logger } from '../utils/logger.js';
import { withCanvasId, getPodDisplayName } from '../utils/handlerHelpers.js';

function findConnectionOrEmitError(
  wsConnectionId: string,
  canvasId: string,
  connectionId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string,
): Connection | undefined {
  const connection = connectionStore.getById(canvasId, connectionId);

  if (!connection) {
    emitNotFound(wsConnectionId, responseEvent, 'Connection', connectionId, requestId);
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
    emitError(wsConnectionId, responseEvent, `來源 Pod 找不到: ${sourcePodId}`, requestId, undefined, 'NOT_FOUND');
    return undefined;
  }

  const targetPod = podStore.getById(canvasId, targetPodId);

  if (!targetPod) {
    emitError(wsConnectionId, responseEvent, `目標 Pod 找不到: ${targetPodId}`, requestId, undefined, 'NOT_FOUND');
    return undefined;
  }

  return { sourcePod, targetPod };
}

export const handleConnectionCreate = withCanvasId<ConnectionCreatePayload>(
  WebSocketResponseEvents.CONNECTION_CREATED,
  async (connectionId: string, canvasId: string, payload: ConnectionCreatePayload, requestId: string): Promise<void> => {
    const { sourcePodId, sourceAnchor, targetPodId, targetAnchor } = payload;

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

    const connection = connectionStore.create(canvasId, {
      sourcePodId,
      sourceAnchor,
      targetPodId,
      targetAnchor,
    });

    const response: ConnectionCreatedPayload = {
      requestId,
      canvasId,
      success: true,
      connection,
    };

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.CONNECTION_CREATED, response);

    if (targetPod.schedule) {
      const result = podStore.update(canvasId, targetPodId, { schedule: null });

      if (result) {
        const podSchedulePayload: PodScheduleSetPayload = {
          requestId: '',
          canvasId,
          success: true,
          pod: result.pod,
        };
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_SCHEDULE_SET, podSchedulePayload);

        logger.log('Connection', 'Create', `已清除目標 Pod「${targetPod.name}」的排程（現為下游節點）`);
      }
    }

    logger.log('Connection', 'Create', `已建立連線「${sourcePod.name} → ${targetPod.name}」`);
  }
);

export const handleConnectionList = withCanvasId<ConnectionListPayload>(
  WebSocketResponseEvents.CONNECTION_LIST_RESULT,
  async (connectionId: string, canvasId: string, _payload: ConnectionListPayload, requestId: string): Promise<void> => {
    const connections = connectionStore.list(canvasId);

    const response: ConnectionListResultPayload = {
      requestId,
      success: true,
      connections,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.CONNECTION_LIST_RESULT, response);
  }
);

export const handleConnectionDelete = withCanvasId<ConnectionDeletePayload>(
  WebSocketResponseEvents.CONNECTION_DELETED,
  async (wsConnectionId: string, canvasId: string, payload: ConnectionDeletePayload, requestId: string): Promise<void> => {
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
        `無法從 store 刪除 connection: ${connectionId}`,
        requestId,
        undefined,
        'INTERNAL_ERROR'
      );
      return;
    }

    const response: ConnectionDeletedPayload = {
      requestId,
      canvasId,
      success: true,
      connectionId,
    };

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.CONNECTION_DELETED, response);

    logger.log('Connection', 'Delete', `已刪除連線「${getPodDisplayName(canvasId, connection.sourcePodId)} → ${getPodDisplayName(canvasId, connection.targetPodId)}」`);

  }
);

export const handleConnectionUpdate = withCanvasId<ConnectionUpdatePayload>(
  WebSocketResponseEvents.CONNECTION_UPDATED,
  async (wsConnectionId: string, canvasId: string, payload: ConnectionUpdatePayload, requestId: string): Promise<void> => {
    const { connectionId, triggerMode } = payload;

    const connection = findConnectionOrEmitError(
      wsConnectionId,
      canvasId,
      connectionId,
      WebSocketResponseEvents.CONNECTION_UPDATED,
      requestId,
    );
    if (!connection) return;

    const updates: Partial<{ triggerMode: TriggerMode }> = {};
    if (triggerMode !== undefined) {
      updates.triggerMode = triggerMode;
    }

    const updatedConnection = connectionStore.update(canvasId, connectionId, updates);

    if (!updatedConnection) {
      emitError(
        wsConnectionId,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        `無法更新 connection: ${connectionId}`,
        requestId,
        undefined,
        'INTERNAL_ERROR'
      );
      return;
    }

    const response: ConnectionUpdatedPayload = {
      requestId,
      canvasId,
      success: true,
      connection: updatedConnection,
    };

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.CONNECTION_UPDATED, response);
  }
);
