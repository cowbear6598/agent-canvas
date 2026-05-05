import { WebSocketResponseEvents } from "../schemas/events.js";
import type { CanvasSecurityUpdatePayload } from "../schemas/authSchemas.js";
import { connectionManager } from "../services/connectionManager.js";
import { socketService } from "../services/socketService.js";
import { authAccessService } from "../services/auth/authAccessService.js";
import { passwordService } from "../services/auth/passwordService.js";
import { sessionStore } from "../services/auth/sessionStore.js";
import { toCanvasDto } from "../utils/canvasDto.js";

export async function handleCanvasSecurityUpdate(
  connectionId: string,
  payload: CanvasSecurityUpdatePayload,
  requestId: string,
): Promise<void> {
  const sessionId = connectionManager.getSessionId(connectionId);
  if (!authAccessService.isWorkspaceAccessible(sessionId)) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
      {
        requestId,
        success: false,
        error: "Workspace is locked",
      },
    );
    return;
  }

  const updateResult = await passwordService.updateCanvasPassword(
    payload.canvasId,
    payload.passwordUpdate,
  );
  if (!updateResult.success) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
      {
        requestId,
        success: false,
        error: updateResult.error,
      },
    );
    return;
  }

  if (payload.passwordUpdate.action !== "remove" && sessionId) {
    sessionStore.unlockCanvas(
      sessionId,
      payload.canvasId,
      updateResult.data.passwordVersion,
    );
    authAccessService.resetCanvasAccess(
      payload.canvasId,
      "canvas-password-changed",
      sessionId,
    );
  } else if (payload.passwordUpdate.action === "remove") {
    authAccessService.resetCanvasAccess(payload.canvasId, "canvas-password-removed");
  }

  const responsePayload = {
    requestId,
    success: true,
    canvas: toCanvasDto(updateResult.data.canvas),
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
    responsePayload,
  );
  authAccessService.emitCanvasProtectionUpdated(updateResult.data.canvas);
}
