import type {TestWebSocketClient} from '../setup';
import {emitAndWaitResponse} from '../setup';
import {v4 as uuidv4} from 'uuid';
import {
    type CanvasCreatePayload,
    type CanvasReorderPayload,
    type CanvasSwitchPayload,
    WebSocketRequestEvents,
    WebSocketResponseEvents,
} from '../../src/schemas';
import {
  type CanvasCreatedPayload,
  type CanvasReorderedPayload,
  type CanvasSwitchedPayload,
} from '../../src/types';

export async function getCanvasId(client: TestWebSocketClient): Promise<string> {
  if (!client.id) {
    throw new Error('Socket not connected');
  }

  const canvasModule = await import('../../src/services/canvasStore.js');
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error('No active canvas for socket');
  }

  return canvasId;
}

export async function createCanvas(
  client: TestWebSocketClient,
  name?: string
): Promise<{ id: string; name: string; sortIndex: number }> {
  if (!client.id) {
    throw new Error('Socket not connected');
  }

  const payload: CanvasCreatePayload = {
    requestId: uuidv4(),
    name: name || 'Test Canvas',
  };

  const response = await emitAndWaitResponse<CanvasCreatePayload, CanvasCreatedPayload>(
    client,
    WebSocketRequestEvents.CANVAS_CREATE,
    WebSocketResponseEvents.CANVAS_CREATED,
    payload
  );

  return response.canvas!;
}

export async function switchCanvas(
  client: TestWebSocketClient,
  canvasId: string,
): Promise<CanvasSwitchedPayload> {
  return emitAndWaitResponse<CanvasSwitchPayload, CanvasSwitchedPayload>(
    client,
    WebSocketRequestEvents.CANVAS_SWITCH,
    WebSocketResponseEvents.CANVAS_SWITCHED,
    { requestId: uuidv4(), canvasId },
  );
}

export async function reorderCanvases(
  client: TestWebSocketClient,
  canvasIds: string[]
): Promise<CanvasReorderedPayload> {
  if (!client.id) {
    throw new Error('Socket not connected');
  }

  const payload: CanvasReorderPayload = {
    requestId: uuidv4(),
    canvasIds,
  };

  return await emitAndWaitResponse<CanvasReorderPayload, CanvasReorderedPayload>(
      client,
      WebSocketRequestEvents.CANVAS_REORDER,
      WebSocketResponseEvents.CANVAS_REORDERED,
      payload
  );
}
