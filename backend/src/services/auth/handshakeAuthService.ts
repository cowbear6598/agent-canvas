import { configStore } from "../configStore.js";
import type { ConnectionSocketData } from "../../types/websocket.js";
import { sessionStore } from "./sessionStore.js";
import { sessionCookiePolicy } from "./sessionCookiePolicy.js";
import { transportSecurityService } from "./transportSecurityService.js";
import { parseCookieHeader } from "./cookieUtils.js";
import { SESSION_COOKIE_NAME } from "./sessionCookiePolicy.js";

const WORKSPACE_RECONNECT_GRANT_PARAM = "workspaceReconnectGrant";

export interface UpgradeAuthResolution {
  data: ConnectionSocketData;
  headers?: Record<string, string>;
}

class HandshakeAuthService {
  resolveUpgrade(req: Request): UpgradeAuthResolution {
    const transportSecurity = transportSecurityService.getRequestInfo(req);
    const cookies = parseCookieHeader(req.headers.get("cookie"));
    const requestUrl = new URL(req.url);

    const cookieSessionId = cookies.get(SESSION_COOKIE_NAME) ?? null;
    let session = sessionStore.getSession(cookieSessionId);
    let setCookieValue: string | null = null;

    if (!session) {
      const reconnectGrant = requestUrl.searchParams.get(
        WORKSPACE_RECONNECT_GRANT_PARAM,
      );
      const grantedSession = sessionStore.consumeReconnectGrant(reconnectGrant);
      if (grantedSession) {
        session = grantedSession;
        setCookieValue = sessionCookiePolicy.serializeSessionCookie(
          grantedSession.id,
          transportSecurity,
        );
      }
    }

    if (!session && !configStore.getWorkspacePasswordState().hasWorkspacePassword) {
      const workspacePasswordVersion =
        configStore.getWorkspacePasswordState().passwordVersion;
      session = sessionStore.createSession({
        workspaceUnlocked: true,
        workspacePasswordVersion,
      });
      setCookieValue = sessionCookiePolicy.serializeSessionCookie(
        session.id,
        transportSecurity,
      );
    }

    if (!session && cookieSessionId) {
      setCookieValue = sessionCookiePolicy.serializeClearedCookie(
        transportSecurity,
      );
    }

    return {
      data: {
        connectionId: "",
        sessionId: session?.id ?? null,
        transportSecurity,
      },
      headers: setCookieValue ? { "Set-Cookie": setCookieValue } : undefined,
    };
  }

  resolveRequestSessionId(req: Request): string | null {
    const cookies = parseCookieHeader(req.headers.get("cookie"));
    const sessionId = cookies.get(SESSION_COOKIE_NAME) ?? null;
    return sessionStore.getSession(sessionId)?.id ?? null;
  }
}

export const handshakeAuthService = new HandshakeAuthService();
