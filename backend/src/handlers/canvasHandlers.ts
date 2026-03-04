import { WebSocketResponseEvents } from '../schemas';
import type {
  CanvasListResultPayload,
  Result,
} from '../types';
import type {
  CanvasCreatePayload,
  CanvasListPayload,
  CanvasRenamePayload,
  CanvasDeletePayload,
  CanvasSwitchPayload,
  CanvasReorderPayload,
} from '../schemas';
import { canvasStore } from '../services/canvasStore.js';
import { socketService } from '../services/socketService.js';
import { cursorColorManager } from '../services/cursorColorManager.js';
import { logger } from '../utils/logger.js';
import { broadcastCursorLeft } from './cursorHandlers.js';
import { toCanvasDto } from '../utils/canvasDto.js';

type CanvasResultEmitTarget = 'broadcast-all' | 'single-connection';

function handleCanvasResult<T, R extends { requestId: string; success: boolean }>(
  connectionId: string,
  result: Result<T>,
  event: WebSocketResponseEvents,
  requestId: string,
  onSuccess: (data: T) => R,
  emitTarget: CanvasResultEmitTarget = 'single-connection'
): boolean {
  if (!result.success) {
    socketService.emitToConnection(connectionId, event, {
      requestId,
      success: false,
      error: result.error,
    });
    return false;
  }

  const successResponse = onSuccess(result.data);
  if (emitTarget === 'broadcast-all') {
    socketService.emitToAll(event, successResponse);
  } else {
    socketService.emitToConnection(connectionId, event, successResponse);
  }
  return true;
}

export async function handleCanvasCreate(
  connectionId: string,
  payload: CanvasCreatePayload
): Promise<void> {
  const result = await canvasStore.create(payload.name);

  handleCanvasResult(
    connectionId,
    result,
    WebSocketResponseEvents.CANVAS_CREATED,
    payload.requestId,
    (canvas) => ({
      requestId: payload.requestId,
      success: true,
      canvas: toCanvasDto(canvas),
    }),
    'broadcast-all'
  );
}

export async function handleCanvasList(
  connectionId: string,
  payload: CanvasListPayload
): Promise<void> {
  const canvases = canvasStore.list();
  const response: CanvasListResultPayload = {
    requestId: payload.requestId,
    success: true,
    canvases: canvases.map(toCanvasDto),
  };

  socketService.emitToConnection(connectionId, WebSocketResponseEvents.CANVAS_LIST_RESULT, response);
}

export async function handleCanvasRename(
  connectionId: string,
  payload: CanvasRenamePayload
): Promise<void> {
  const result = await canvasStore.rename(payload.canvasId, payload.newName);

  handleCanvasResult(
    connectionId,
    result,
    WebSocketResponseEvents.CANVAS_RENAMED,
    payload.requestId,
    (canvas) => ({
      requestId: payload.requestId,
      success: true,
      canvasId: canvas.id,
      newName: canvas.name,
      canvas: {
        id: canvas.id,
        name: canvas.name,
      },
    }),
    'broadcast-all'
  );
}

export async function handleCanvasDelete(
  connectionId: string,
  payload: CanvasDeletePayload
): Promise<void> {
  const canvas = canvasStore.getById(payload.canvasId);
  if (!canvas) {
    socketService.emitToConnection(connectionId, WebSocketResponseEvents.CANVAS_DELETED, {
      requestId: payload.requestId,
      success: false,
      error: '找不到 Canvas',
    });
    return;
  }

  const activeCanvasId = canvasStore.getActiveCanvas(connectionId);
  if (activeCanvasId === payload.canvasId) {
    socketService.emitToConnection(connectionId, WebSocketResponseEvents.CANVAS_DELETED, {
      requestId: payload.requestId,
      success: false,
      error: '無法刪除正在使用的 Canvas',
    });
    return;
  }

  const result = await canvasStore.delete(payload.canvasId);

  const success = handleCanvasResult(
    connectionId,
    result,
    WebSocketResponseEvents.CANVAS_DELETED,
    payload.requestId,
    () => ({
      requestId: payload.requestId,
      success: true,
      canvasId: payload.canvasId,
    }),
    'broadcast-all'
  );

  if (!success) return;

  cursorColorManager.removeCanvas(payload.canvasId);
}

export async function handleCanvasSwitch(
  connectionId: string,
  payload: CanvasSwitchPayload
): Promise<void> {
  const canvas = canvasStore.getById(payload.canvasId);
  if (!canvas) {
    socketService.emitToConnection(connectionId, WebSocketResponseEvents.CANVAS_SWITCHED, {
      requestId: payload.requestId,
      success: false,
      error: '找不到 Canvas',
    });
    return;
  }

  broadcastCursorLeft(connectionId);

  canvasStore.setActiveCanvas(connectionId, payload.canvasId);
  socketService.joinCanvasRoom(connectionId, payload.canvasId);

  cursorColorManager.assignColor(payload.canvasId, connectionId);

  socketService.emitToConnection(connectionId, WebSocketResponseEvents.CANVAS_SWITCHED, {
    requestId: payload.requestId,
    success: true,
    canvasId: payload.canvasId,
  });

  logger.log('Canvas', 'Switch', `連線 ${connectionId} 切換至畫布 ${canvas.name}`);
}

export async function handleCanvasReorder(
  connectionId: string,
  payload: CanvasReorderPayload
): Promise<void> {
  const result = await canvasStore.reorder(payload.canvasIds);

  const success = handleCanvasResult(
    connectionId,
    result,
    WebSocketResponseEvents.CANVAS_REORDERED,
    payload.requestId,
    () => ({
      requestId: payload.requestId,
      success: true,
      canvasIds: payload.canvasIds,
    }),
    'broadcast-all'
  );

  if (!success) return;

  logger.log('Canvas', 'Reorder', `已重新排序 Canvas：${payload.canvasIds.length} 個`);
}
