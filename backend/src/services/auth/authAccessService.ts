import { connectionManager } from "../connectionManager.js";
import { socketService } from "../socketService.js";
import { canvasStore } from "../canvasStore.js";
import { configStore } from "../configStore.js";
import { sessionStore } from "./sessionStore.js";
import { toCanvasDto } from "../../utils/canvasDto.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import type { TransportSecurityInfo } from "./transportSecurityService.js";
import type { Canvas } from "../../types/canvas.js";

export interface BootstrapAccessState {
  hasWorkspacePassword: boolean;
  workspaceUnlocked: boolean;
  unlockedCanvasIds: string[];
  transportSecurity: {
    isTls: boolean;
    showInsecureTransportWarning: boolean;
    isLanHost: boolean;
  };
}

class AuthAccessService {
  buildBootstrapState(
    sessionId: string | null,
    transportSecurity: TransportSecurityInfo,
  ): BootstrapAccessState {
    return {
      hasWorkspacePassword:
        configStore.getWorkspacePasswordState().hasWorkspacePassword,
      workspaceUnlocked: this.isWorkspaceAccessible(sessionId),
      unlockedCanvasIds: this.getAccessibleUnlockedCanvasIds(sessionId),
      transportSecurity: {
        isTls: transportSecurity.isTls,
        showInsecureTransportWarning:
          transportSecurity.showInsecureTransportWarning,
        isLanHost: transportSecurity.isLanHost,
      },
    };
  }

  isWorkspaceAccessible(sessionId: string | null): boolean {
    const workspacePassword = configStore.getWorkspacePasswordState();
    if (!workspacePassword.hasWorkspacePassword) {
      return true;
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return false;
    }

    return (
      session.workspaceUnlocked &&
      session.workspacePasswordVersion === workspacePassword.passwordVersion
    );
  }

  isCanvasAccessible(sessionId: string | null, canvasId: string): boolean {
    if (!this.isWorkspaceAccessible(sessionId)) {
      return false;
    }

    const canvas = canvasStore.getById(canvasId);
    if (!canvas) {
      return false;
    }

    if (!canvas.isProtected) {
      return true;
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return false;
    }

    return (
      session.unlockedCanvasVersions.get(canvasId) === canvas.passwordVersion
    );
  }

  /**
   * 判斷指定 canvas 是否需要解鎖才能存取（即：canvas 存在且受密碼保護且尚未解鎖）。
   * canvas 不存在或未受保護時回傳 false，讓 handler 自行處理 404 或正常回應。
   */
  requiresCanvasUnlock(sessionId: string | null, canvasId: string): boolean {
    if (!this.isWorkspaceAccessible(sessionId)) {
      return false;
    }

    const canvas = canvasStore.getById(canvasId);
    if (!canvas || !canvas.isProtected) {
      return false;
    }

    return !this.isCanvasAccessible(sessionId, canvasId);
  }

  getAccessibleUnlockedCanvasIds(sessionId: string | null): string[] {
    const session = sessionStore.getSession(sessionId);
    if (!session || !this.isWorkspaceAccessible(sessionId)) {
      return [];
    }

    return Array.from(session.unlockedCanvasVersions.entries())
      .filter(([canvasId, unlockedVersion]) => {
        const canvas = canvasStore.getById(canvasId);
        if (!canvas) {
          return false;
        }

        if (!canvas.isProtected) {
          return true;
        }

        return unlockedVersion === canvas.passwordVersion;
      })
      .map(([canvasId]) => canvasId);
  }

  bindSessionToConnection(
    connectionId: string,
    sessionId: string | null,
  ): void {
    connectionManager.setSessionId(connectionId, sessionId);
  }

  resetWorkspaceAccess(
    reason: string,
    excludedSessionId?: string | null,
  ): void {
    for (const connection of connectionManager.getAll()) {
      if (excludedSessionId && connection.sessionId === excludedSessionId) {
        continue;
      }

      sessionStore.clearWorkspaceUnlock(connection.sessionId ?? "");
      socketService.leaveCanvasRoom(connection.id);
      canvasStore.removeSocket(connection.id);
      socketService.emitToConnection(
        connection.id,
        WebSocketResponseEvents.AUTH_SESSION_RESET,
        { reason },
      );
    }
  }

  resetCanvasAccess(
    canvasId: string,
    reason: string,
    excludedSessionId?: string | null,
  ): void {
    sessionStore.clearCanvasUnlockAcrossSessions(canvasId);

    if (excludedSessionId) {
      const unlockedVersion = canvasStore.getPasswordVersion(canvasId);
      if (unlockedVersion !== undefined) {
        sessionStore.unlockCanvas(excludedSessionId, canvasId, unlockedVersion);
      }
    }

    for (const connection of connectionManager.getAll()) {
      const connectionSessionId = connection.sessionId;
      if (!connectionSessionId) {
        continue;
      }

      if (excludedSessionId && connectionSessionId === excludedSessionId) {
        continue;
      }

      if (!this.isCanvasAccessible(connectionSessionId, canvasId)) {
        if (connection.canvasId === canvasId) {
          socketService.leaveCanvasRoom(connection.id);
          canvasStore.removeSocket(connection.id);
        }

        socketService.emitToConnection(
          connection.id,
          WebSocketResponseEvents.AUTH_CANVAS_ACCESS_RESET,
          {
            canvasId,
            reason,
          },
        );
      }
    }
  }

  emitCanvasProtectionUpdated(canvas: Canvas): void {
    socketService.emitToAll(WebSocketResponseEvents.CANVAS_SECURITY_UPDATED, {
      requestId: "system",
      success: true,
      canvas: toCanvasDto(canvas),
    });
  }
}

export const authAccessService = new AuthAccessService();
