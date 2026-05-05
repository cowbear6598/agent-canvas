import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  AuthBootstrapPayload,
  AuthUnlockCanvasPayload,
  AuthUnlockWorkspacePayload,
  AuthUpdateWorkspacePasswordPayload,
  CanvasSecurityUpdatePayload,
  PasswordUpdateActionPayload,
} from "@/types/websocket/requests";
import type {
  AuthBootstrapResultPayload,
  AuthUnlockCanvasResultPayload,
  AuthUnlockWorkspaceResultPayload,
  WorkspacePasswordUpdatedPayload,
} from "@/types/websocket/responses";
import type { CanvasCreatedPayload } from "@/types/canvas";

export async function getWorkspaceAccessState(): Promise<AuthBootstrapResultPayload> {
  return createWebSocketRequest<AuthBootstrapPayload, AuthBootstrapResultPayload>(
    {
      requestEvent: WebSocketRequestEvents.AUTH_BOOTSTRAP,
      responseEvent: WebSocketResponseEvents.AUTH_BOOTSTRAP_RESULT,
      payload: {},
    },
  );
}

export async function unlockWorkspace(
  password: string,
): Promise<AuthUnlockWorkspaceResultPayload> {
  return createWebSocketRequest<
    AuthUnlockWorkspacePayload,
    AuthUnlockWorkspaceResultPayload
  >({
    requestEvent: WebSocketRequestEvents.AUTH_UNLOCK_WORKSPACE,
    responseEvent: WebSocketResponseEvents.AUTH_WORKSPACE_UNLOCK_RESULT,
    payload: { password },
  });
}

export async function unlockCanvas(
  canvasId: string,
  password: string,
): Promise<AuthUnlockCanvasResultPayload> {
  return createWebSocketRequest<
    AuthUnlockCanvasPayload,
    AuthUnlockCanvasResultPayload
  >({
    requestEvent: WebSocketRequestEvents.AUTH_UNLOCK_CANVAS,
    responseEvent: WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
    payload: { canvasId, password },
  });
}

export async function updateWorkspacePassword(
  passwordUpdate: PasswordUpdateActionPayload,
): Promise<WorkspacePasswordUpdatedPayload> {
  return createWebSocketRequest<
    AuthUpdateWorkspacePasswordPayload,
    WorkspacePasswordUpdatedPayload
  >({
    requestEvent: WebSocketRequestEvents.AUTH_UPDATE_WORKSPACE_PASSWORD,
    responseEvent: WebSocketResponseEvents.AUTH_WORKSPACE_PASSWORD_UPDATED,
    payload: { passwordUpdate },
  });
}

export async function updateCanvasPassword(
  canvasId: string,
  passwordUpdate: PasswordUpdateActionPayload,
): Promise<CanvasCreatedPayload> {
  return createWebSocketRequest<CanvasSecurityUpdatePayload, CanvasCreatedPayload>(
    {
      requestEvent: WebSocketRequestEvents.CANVAS_SECURITY_UPDATE,
      responseEvent: WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
      payload: { canvasId, passwordUpdate },
    },
  );
}
