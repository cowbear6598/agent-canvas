import { canvasStore } from "../services/canvasStore.js";
import { podStore } from "../services/podStore.js";
import { JSON_HEADERS } from "./constants.js";
import { HTTP_STATUS } from "../constants.js";
import type { Canvas, Pod } from "../types/index.js";

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function resolveCanvas(idOrName: string): Canvas | undefined {
  if (!idOrName) return undefined;
  if (UUID_REGEX.test(idOrName)) {
    return canvasStore.getById(idOrName);
  }
  return canvasStore.getByName(idOrName);
}

type RequireCanvasResult =
  | { canvas: Canvas; error: null }
  | { canvas: null; error: Response };

export function requireCanvas(idOrName: string): RequireCanvasResult {
  const canvas = resolveCanvas(idOrName);
  if (!canvas) {
    return {
      canvas: null,
      error: jsonResponse({ error: "找不到 Canvas" }, 404),
    };
  }
  return { canvas, error: null };
}

export function requireJsonBody(req: Request): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  const contentLength = req.headers.get("content-length");
  const hasBody = contentLength !== "0" && contentLength !== null;

  if (!contentType.includes("application/json") || !hasBody) {
    return jsonResponse({ error: "無效的請求格式" }, HTTP_STATUS.BAD_REQUEST);
  }
  return null;
}

export function resolvePod(
  canvasId: string,
  idOrName: string,
): Pod | undefined {
  if (!idOrName) return undefined;
  if (UUID_REGEX.test(idOrName)) {
    return podStore.getById(canvasId, idOrName);
  }
  if (idOrName.length > 100) return undefined;
  return podStore.getByName(canvasId, idOrName);
}

export async function requireCanvasPassword(
  req: Request,
  canvasId: string,
): Promise<Response | null> {
  if (!canvasStore.isLocked(canvasId)) {
    return null;
  }

  const password = req.headers.get("X-Canvas-Password");
  if (!password) {
    return jsonResponse(
      { error: "密碼錯誤或未提供密碼" },
      HTTP_STATUS.FORBIDDEN,
    );
  }

  const isValid = await canvasStore.verifyPassword(canvasId, password);
  if (!isValid) {
    return jsonResponse(
      { error: "密碼錯誤或未提供密碼" },
      HTTP_STATUS.FORBIDDEN,
    );
  }

  return null;
}
