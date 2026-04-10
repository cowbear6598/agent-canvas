import { canvasStore } from "../services/canvasStore.js";
import { socketService } from "../services/socketService.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import { jsonResponse, requireCanvas, requireJsonBody } from "./apiHelpers.js";
import { HTTP_STATUS } from "../constants.js";
import { getResultErrorString } from "../types/result.js";

// 廣播 Canvas 鎖定狀態變更事件給所有連線
function broadcastLockChanged(canvasId: string, isLocked: boolean): void {
  socketService.emitToAll(WebSocketResponseEvents.CANVAS_LOCK_CHANGED, {
    canvasId,
    isLocked,
  });
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

// POST /api/canvas/:id/password
export async function handleSetCanvasPassword(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  if (canvasStore.isLocked(canvas.id)) {
    return jsonResponse(
      { error: "此畫布已設定密碼，請使用修改密碼功能" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const body = asRecord(await req.json());
  const { password } = body;

  if (typeof password !== "string" || password === "") {
    return jsonResponse({ error: "密碼不能為空" }, HTTP_STATUS.BAD_REQUEST);
  }

  if (password.length > 128) {
    return jsonResponse(
      { error: "密碼長度不能超過 128 個字元" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const result = await canvasStore.setPassword(canvas.id, password);

  if (!result.success) {
    return jsonResponse(
      { error: getResultErrorString(result.error) },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  broadcastLockChanged(canvas.id, true);

  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}

// PUT /api/canvas/:id/password
export async function handleChangeCanvasPassword(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const body = asRecord(await req.json());
  const { oldPassword, newPassword } = body;

  if (
    typeof oldPassword !== "string" ||
    oldPassword === "" ||
    typeof newPassword !== "string" ||
    newPassword === ""
  ) {
    return jsonResponse(
      { error: "舊密碼和新密碼不能為空" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (oldPassword.length > 128 || newPassword.length > 128) {
    return jsonResponse(
      { error: "密碼長度不能超過 128 個字元" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const result = await canvasStore.changePassword(
    canvas.id,
    oldPassword,
    newPassword,
  );

  if (!result.success) {
    return jsonResponse(
      { error: getResultErrorString(result.error) },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}

// DELETE /api/canvas/:id/password
export async function handleRemoveCanvasPassword(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const body = asRecord(await req.json());
  const { password } = body;

  if (typeof password !== "string" || password === "") {
    return jsonResponse({ error: "密碼不能為空" }, HTTP_STATUS.BAD_REQUEST);
  }

  if (password.length > 128) {
    return jsonResponse(
      { error: "密碼長度不能超過 128 個字元" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const result = await canvasStore.removePassword(canvas.id, password);

  if (!result.success) {
    return jsonResponse(
      { error: getResultErrorString(result.error) },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  broadcastLockChanged(canvas.id, false);

  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}

// POST /api/canvas/:id/verify-password
export async function handleVerifyCanvasPassword(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const body = asRecord(await req.json());
  const { password } = body;

  if (typeof password !== "string" || password === "") {
    return jsonResponse({ error: "密碼不能為空" }, HTTP_STATUS.BAD_REQUEST);
  }

  if (password.length > 128) {
    return jsonResponse(
      { error: "密碼長度不能超過 128 個字元" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const isValid = await canvasStore.verifyPassword(canvas.id, password);

  return jsonResponse({ success: isValid }, HTTP_STATUS.OK);
}
