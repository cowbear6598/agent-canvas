import { canvasStore } from "../services/canvasStore.js";
import { socketService } from "../services/socketService.js";
import { cursorColorManager } from "../services/cursorColorManager.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import { toCanvasDto } from "../utils/canvasDto.js";
import { jsonResponse, requireCanvas, requireJsonBody } from "./apiHelpers.js";
import { HTTP_STATUS } from "../constants.js";
import { getResultErrorString } from "../types/result.js";

export async function handleDeleteCanvas(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const { id: canvasId } = canvas;

  const result = await canvasStore.delete(canvasId);
  if (!result.success) {
    return jsonResponse(
      { error: "刪除 Canvas 時發生錯誤" },
      HTTP_STATUS.INTERNAL_ERROR,
    );
  }

  cursorColorManager.removeCanvas(canvasId);
  socketService.emitToAll(WebSocketResponseEvents.CANVAS_DELETED, {
    requestId: "system",
    success: true,
    canvasId,
  });

  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}

function isValidCreateCanvasBody(body: unknown): body is { name: string } {
  return (
    body !== null &&
    typeof body === "object" &&
    "name" in body &&
    typeof (body as Record<string, unknown>).name === "string"
  );
}

export function handleListCanvases(
  _req: Request,
  _params: Record<string, string>,
): Response {
  const canvases = canvasStore.list();
  return jsonResponse({ canvases: canvases.map(toCanvasDto) }, HTTP_STATUS.OK);
}

export async function handleRenameCanvas(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const body = await req.json();

  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  if (!isValidCreateCanvasBody(body)) {
    return jsonResponse(
      { error: "Canvas 名稱不能為空" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const result = await canvasStore.rename(canvas.id, body.name);

  if (!result.success) {
    return jsonResponse({ error: getResultErrorString(result.error) }, HTTP_STATUS.BAD_REQUEST);
  }

  const canvasData = { id: result.data.id, name: result.data.name };

  socketService.emitToAll(WebSocketResponseEvents.CANVAS_RENAMED, {
    requestId: "system",
    success: true,
    canvasId: canvasData.id,
    newName: canvasData.name,
    canvas: canvasData,
  });

  return jsonResponse({ canvas: canvasData }, HTTP_STATUS.OK);
}

export async function handleCreateCanvas(
  req: Request,
  _params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const body = await req.json();

  if (!isValidCreateCanvasBody(body)) {
    return jsonResponse(
      { error: "Canvas 名稱不能為空" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const result = await canvasStore.create(body.name);

  if (!result.success) {
    return jsonResponse({ error: getResultErrorString(result.error) }, HTTP_STATUS.BAD_REQUEST);
  }

  const canvasDto = toCanvasDto(result.data);

  socketService.emitToAll(WebSocketResponseEvents.CANVAS_CREATED, {
    requestId: "system",
    success: true,
    canvas: canvasDto,
  });

  return jsonResponse({ canvas: canvasDto }, HTTP_STATUS.CREATED);
}
