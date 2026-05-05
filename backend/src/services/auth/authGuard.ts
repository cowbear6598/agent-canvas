import { WebSocketRequestEvents } from "../../schemas/events.js";
import { WebSocketError } from "../../middleware/wsErrorHandler.js";
import { connectionManager } from "../connectionManager.js";
import { authAccessService } from "./authAccessService.js";

type EventScope = "public" | "workspace" | "canvas";

const PUBLIC_EVENTS = new Set<string>([
  WebSocketRequestEvents.AUTH_BOOTSTRAP,
  WebSocketRequestEvents.AUTH_UNLOCK_WORKSPACE,
  WebSocketRequestEvents.AUTH_UNLOCK_CANVAS,
]);

const WORKSPACE_EVENTS = new Set<string>([
  WebSocketRequestEvents.CANVAS_LIST,
  WebSocketRequestEvents.CANVAS_CREATE,
  WebSocketRequestEvents.CANVAS_REORDER,
  WebSocketRequestEvents.CONFIG_GET,
  WebSocketRequestEvents.CONFIG_UPDATE,
  WebSocketRequestEvents.AUTH_UPDATE_WORKSPACE_PASSWORD,
  WebSocketRequestEvents.INTEGRATION_APP_CREATE,
  WebSocketRequestEvents.INTEGRATION_APP_DELETE,
  WebSocketRequestEvents.INTEGRATION_APP_LIST,
  WebSocketRequestEvents.INTEGRATION_APP_GET,
  WebSocketRequestEvents.INTEGRATION_APP_RESOURCES,
  WebSocketRequestEvents.INTEGRATION_APP_RESOURCES_REFRESH,
  WebSocketRequestEvents.PLUGIN_LIST,
  WebSocketRequestEvents.BACKUP_TEST_CONNECTION,
  WebSocketRequestEvents.BACKUP_TRIGGER,
  WebSocketRequestEvents.PROVIDER_LIST,
]);

const CANVAS_EVENTS = new Set<string>([
  WebSocketRequestEvents.CANVAS_SWITCH,
  WebSocketRequestEvents.CANVAS_RENAME,
  WebSocketRequestEvents.CANVAS_DELETE,
  WebSocketRequestEvents.CANVAS_SECURITY_UPDATE,
  WebSocketRequestEvents.CURSOR_MOVE,
]);

function getEventScope(event: string, payload: unknown): EventScope {
  if (PUBLIC_EVENTS.has(event)) {
    return "public";
  }

  if (WORKSPACE_EVENTS.has(event)) {
    return "workspace";
  }

  if (CANVAS_EVENTS.has(event)) {
    return "canvas";
  }

  if (
    payload &&
    typeof payload === "object" &&
    "canvasId" in (payload as Record<string, unknown>)
  ) {
    return "canvas";
  }

  return "workspace";
}

function getCanvasIdFromPayload(
  event: string,
  payload: unknown,
  connectionId: string,
): string | null {
  if (event === WebSocketRequestEvents.CURSOR_MOVE) {
    return connectionManager.getCanvasId(connectionId);
  }

  if (payload && typeof payload === "object" && "canvasId" in payload) {
    const canvasId = (payload as Record<string, unknown>).canvasId;
    return typeof canvasId === "string" ? canvasId : null;
  }

  return connectionManager.getCanvasId(connectionId);
}

class AuthGuard {
  assertAccess(connectionId: string, event: string, payload: unknown): void {
    const scope = getEventScope(event, payload);
    if (scope === "public") {
      return;
    }

    const sessionId = connectionManager.getSessionId(connectionId);
    // workspace 可存取性只呼叫一次，避免重複查詢
    if (!authAccessService.isWorkspaceAccessible(sessionId)) {
      throw new WebSocketError(
        "WORKSPACE_PASSWORD_REQUIRED",
        "Workspace password required",
      );
    }

    if (scope !== "canvas") {
      return;
    }

    const canvasId = getCanvasIdFromPayload(event, payload, connectionId);
    // workspace 已確認可存取，直接使用 AssumingWorkspace 版本避免重複呼叫。
    // 只有在 canvas 存在且受密碼保護且尚未解鎖時才拒絕；
    // canvas 不存在或未受保護時讓 handler 自行回傳錯誤。
    if (
      canvasId &&
      authAccessService.requiresCanvasUnlockAssumingWorkspace(
        sessionId,
        canvasId,
      )
    ) {
      throw new WebSocketError(
        "CANVAS_PASSWORD_REQUIRED",
        "Canvas password required",
      );
    }
  }
}

export const authGuard = new AuthGuard();
