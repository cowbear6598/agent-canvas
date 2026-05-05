import { randomUUID } from "crypto";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RECONNECT_GRANT_TTL_MS = 1000 * 30;

export interface AuthSession {
  id: string;
  workspaceUnlocked: boolean;
  workspacePasswordVersion: number;
  unlockedCanvasVersions: Map<string, number>;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface ReconnectGrant {
  id: string;
  sessionId: string;
  expiresAt: number;
  usedAt: number | null;
}

class SessionStore {
  private sessions = new Map<string, AuthSession>();
  private reconnectGrants = new Map<string, ReconnectGrant>();

  createSession(params?: {
    workspaceUnlocked?: boolean;
    workspacePasswordVersion?: number;
  }): AuthSession {
    const now = Date.now();
    const session: AuthSession = {
      id: randomUUID(),
      workspaceUnlocked: params?.workspaceUnlocked ?? false,
      workspacePasswordVersion: params?.workspacePasswordVersion ?? 0,
      unlockedCanvasVersions: new Map(),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string | null | undefined): AuthSession | undefined {
    if (!sessionId) {
      return undefined;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    session.lastSeenAt = Date.now();
    session.expiresAt = session.lastSeenAt + SESSION_TTL_MS;
    return session;
  }

  createReconnectGrant(sessionId: string): string {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const grantId = randomUUID();
    this.reconnectGrants.set(grantId, {
      id: grantId,
      sessionId,
      expiresAt: Date.now() + RECONNECT_GRANT_TTL_MS,
      usedAt: null,
    });

    return grantId;
  }

  /**
   * 非消耗性驗證 grant 是否有效（存在且未過期且未使用）。
   * 用於 REST endpoint 驗證 grant 合法性而不提前消耗它。
   */
  peekReconnectGrant(
    grantId: string | null | undefined,
  ): AuthSession | undefined {
    if (!grantId) {
      return undefined;
    }

    const grant = this.reconnectGrants.get(grantId);
    if (!grant) {
      return undefined;
    }

    if (grant.usedAt !== null || grant.expiresAt <= Date.now()) {
      return undefined;
    }

    return this.getSession(grant.sessionId);
  }

  consumeReconnectGrant(
    grantId: string | null | undefined,
  ): AuthSession | undefined {
    if (!grantId) {
      return undefined;
    }

    const grant = this.reconnectGrants.get(grantId);
    if (!grant) {
      return undefined;
    }

    if (grant.usedAt !== null || grant.expiresAt <= Date.now()) {
      this.reconnectGrants.delete(grantId);
      return undefined;
    }

    grant.usedAt = Date.now();
    this.reconnectGrants.delete(grantId);
    return this.getSession(grant.sessionId);
  }

  markWorkspaceUnlocked(
    sessionId: string,
    workspacePasswordVersion: number,
  ): AuthSession | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    session.workspaceUnlocked = true;
    session.workspacePasswordVersion = workspacePasswordVersion;
    return session;
  }

  clearWorkspaceUnlock(sessionId: string): AuthSession | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    session.workspaceUnlocked = false;
    session.unlockedCanvasVersions.clear();
    return session;
  }

  unlockCanvas(
    sessionId: string,
    canvasId: string,
    passwordVersion: number,
  ): AuthSession | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    session.unlockedCanvasVersions.set(canvasId, passwordVersion);
    return session;
  }

  clearCanvasUnlock(
    sessionId: string,
    canvasId: string,
  ): AuthSession | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    session.unlockedCanvasVersions.delete(canvasId);
    return session;
  }

  clearCanvasUnlockAcrossSessions(canvasId: string): void {
    for (const session of this.sessions.values()) {
      session.unlockedCanvasVersions.delete(canvasId);
    }
  }

  clearAllSessions(): void {
    this.sessions.clear();
    this.reconnectGrants.clear();
  }

  getUnlockedCanvasIds(sessionId: string): string[] {
    const session = this.getSession(sessionId);
    if (!session) {
      return [];
    }

    return Array.from(session.unlockedCanvasVersions.keys());
  }
}

export const sessionStore = new SessionStore();
