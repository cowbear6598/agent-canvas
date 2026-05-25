import { WebSocketResponseEvents } from "../schemas/events.js";
import type {
  AuthBootstrapPayload,
  AuthUnlockCanvasPayload,
  AuthUnlockWorkspacePayload,
  AuthUpdateWorkspacePasswordPayload,
} from "../schemas/authSchemas.js";
import { connectionManager } from "../services/connectionManager.js";
import { socketService } from "../services/socketService.js";
import { authAccessService } from "../services/auth/authAccessService.js";
import { passwordService } from "../services/auth/passwordService.js";
import { sessionStore } from "../services/auth/sessionStore.js";
import { unlockRateLimiter } from "../services/auth/unlockRateLimiter.js";
import { createI18nError } from "../utils/i18nError.js";

export async function handleAuthBootstrap(
  connectionId: string,
  _payload: AuthBootstrapPayload,
  requestId: string,
): Promise<void> {
  const sessionId = connectionManager.getSessionId(connectionId);
  const transportSecurity =
    connectionManager.getTransportSecurity(connectionId);

  if (!transportSecurity) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_BOOTSTRAP_RESULT,
      {
        requestId,
        success: false,
        error: createI18nError("errors.auth.transportSecurityMissing"),
      },
    );
    return;
  }

  const bootstrapState = authAccessService.buildBootstrapState(
    sessionId,
    transportSecurity,
  );

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.AUTH_BOOTSTRAP_RESULT,
    {
      requestId,
      success: true,
      ...bootstrapState,
    },
  );
}

export async function handleAuthUnlockWorkspace(
  connectionId: string,
  payload: AuthUnlockWorkspacePayload,
  requestId: string,
): Promise<void> {
  const remoteIp = connectionManager.getRemoteIp(connectionId);
  const rateLimitResult = unlockRateLimiter.check(connectionId, remoteIp);
  if (rateLimitResult.blocked) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_WORKSPACE_UNLOCK_RESULT,
      {
        requestId,
        success: false,
        error: createI18nError("errors.auth.rateLimited", {
          seconds: rateLimitResult.retryAfterSeconds,
        }),
        errorCode: "AUTH_RATE_LIMITED",
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      },
    );
    return;
  }

  const verifyResult = await passwordService.verifyWorkspaceUnlock(
    payload.password,
  );

  if (!verifyResult.success) {
    unlockRateLimiter.recordFailure(connectionId, remoteIp);
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_WORKSPACE_UNLOCK_RESULT,
      {
        requestId,
        success: false,
        error: verifyResult.error,
      },
    );
    return;
  }

  unlockRateLimiter.reset(connectionId, remoteIp);

  const workspacePasswordVersion = verifyResult.data.passwordVersion;
  let sessionId = connectionManager.getSessionId(connectionId);
  let session = sessionStore.getSession(sessionId);

  if (!session) {
    session = sessionStore.createSession({
      workspaceUnlocked: true,
      workspacePasswordVersion,
    });
    sessionId = session.id;
    connectionManager.setSessionId(connectionId, session.id);
  } else {
    sessionStore.markWorkspaceUnlocked(session.id, workspacePasswordVersion);
  }

  const reconnectGrant = sessionStore.createReconnectGrant(
    sessionId ?? session.id,
  );

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.AUTH_WORKSPACE_UNLOCK_RESULT,
    {
      requestId,
      success: true,
      reconnectGrant,
    },
  );
}

export async function handleAuthUnlockCanvas(
  connectionId: string,
  payload: AuthUnlockCanvasPayload,
  requestId: string,
): Promise<void> {
  const remoteIp = connectionManager.getRemoteIp(connectionId);
  const rateLimitResult = unlockRateLimiter.check(connectionId, remoteIp);
  if (rateLimitResult.blocked) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
      {
        requestId,
        success: false,
        error: createI18nError("errors.auth.rateLimited", {
          seconds: rateLimitResult.retryAfterSeconds,
        }),
        errorCode: "AUTH_RATE_LIMITED",
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      },
    );
    return;
  }

  const sessionId = connectionManager.getSessionId(connectionId);
  if (!authAccessService.isWorkspaceAccessible(sessionId)) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
      {
        requestId,
        success: false,
        error: createI18nError("errors.auth.workspaceLocked"),
      },
    );
    return;
  }

  if (!sessionId) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
      {
        requestId,
        success: false,
        error: createI18nError("errors.auth.sessionMissing"),
      },
    );
    return;
  }

  const verifyResult = await passwordService.verifyCanvasUnlock(
    payload.canvasId,
    payload.password,
  );
  if (!verifyResult.success) {
    unlockRateLimiter.recordFailure(connectionId, remoteIp);
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
      {
        requestId,
        success: false,
        error: verifyResult.error,
      },
    );
    return;
  }

  unlockRateLimiter.reset(connectionId, remoteIp);

  sessionStore.unlockCanvas(
    sessionId,
    payload.canvasId,
    verifyResult.data.passwordVersion,
  );

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
    {
      requestId,
      success: true,
      canvasId: payload.canvasId,
      unlockedCanvasIds:
        authAccessService.getAccessibleUnlockedCanvasIds(sessionId),
    },
  );
}

export async function handleAuthUpdateWorkspacePassword(
  connectionId: string,
  payload: AuthUpdateWorkspacePasswordPayload,
  requestId: string,
): Promise<void> {
  const sessionId = connectionManager.getSessionId(connectionId);
  if (!authAccessService.isWorkspaceAccessible(sessionId)) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_WORKSPACE_PASSWORD_UPDATED,
      {
        requestId,
        success: false,
        error: createI18nError("errors.auth.workspaceLocked"),
      },
    );
    return;
  }

  const updateResult = await passwordService.updateWorkspacePassword(
    payload.passwordUpdate,
  );
  if (!updateResult.success) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.AUTH_WORKSPACE_PASSWORD_UPDATED,
      {
        requestId,
        success: false,
        error: updateResult.error,
      },
    );
    return;
  }

  if (payload.passwordUpdate.action !== "remove" && sessionId) {
    sessionStore.markWorkspaceUnlocked(
      sessionId,
      updateResult.data.passwordVersion,
    );
    authAccessService.resetWorkspaceAccess(
      "workspace-password-changed",
      sessionId,
    );
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.AUTH_WORKSPACE_PASSWORD_UPDATED,
    {
      requestId,
      success: true,
      hasWorkspacePassword: updateResult.data.hasWorkspacePassword,
    },
  );
}
