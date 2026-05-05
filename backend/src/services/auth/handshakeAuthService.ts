import { configStore } from "../configStore.js";
import type { ConnectionSocketData } from "../../types/websocket.js";
import { sessionStore } from "./sessionStore.js";
import { sessionCookiePolicy } from "./sessionCookiePolicy.js";
import { transportSecurityService } from "./transportSecurityService.js";
import { parseCookieHeader } from "./cookieUtils.js";
import { SESSION_COOKIE_NAME } from "./sessionCookiePolicy.js";

/** 短效 reconnect grant cookie 名稱（HttpOnly，TTL 30 秒）*/
export const RECONNECT_GRANT_COOKIE_NAME = "ac_reconnect_grant";

export interface UpgradeAuthResolution {
  data: ConnectionSocketData;
  headers?: Record<string, string>;
}

/**
 * 序列化已清除的 reconnect grant cookie（TTL 0，使瀏覽器刪除它）。
 */
function serializeClearedGrantCookie(
  transportSecurity: Parameters<
    typeof sessionCookiePolicy.serializeClearedCookie
  >[0],
): string {
  const secure = transportSecurity.isTls;
  const attrs = [
    `${RECONNECT_GRANT_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Strict",
    "HttpOnly",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

class HandshakeAuthService {
  resolveUpgrade(
    req: Request,
    remoteIp?: string | null,
  ): UpgradeAuthResolution {
    const transportSecurity = transportSecurityService.getRequestInfo(
      req,
      remoteIp,
    );
    const cookies = parseCookieHeader(req.headers.get("cookie"));

    const cookieSessionId = cookies.get(SESSION_COOKIE_NAME) ?? null;
    let session = sessionStore.getSession(cookieSessionId);
    const setCookieValues: string[] = [];

    if (!session) {
      // 從短效 grant cookie（而非 URL query）讀取 reconnect grant，避免 token 出現在 URL
      const reconnectGrant = cookies.get(RECONNECT_GRANT_COOKIE_NAME) ?? null;
      const grantedSession = sessionStore.consumeReconnectGrant(reconnectGrant);
      if (grantedSession) {
        session = grantedSession;
        setCookieValues.push(
          sessionCookiePolicy.serializeSessionCookie(
            grantedSession.id,
            transportSecurity,
          ),
        );
        // 消耗後立即清除 grant cookie
        setCookieValues.push(serializeClearedGrantCookie(transportSecurity));
      }
    }

    if (
      !session &&
      !configStore.getWorkspacePasswordState().hasWorkspacePassword
    ) {
      const workspacePasswordVersion =
        configStore.getWorkspacePasswordState().passwordVersion;
      session = sessionStore.createSession({
        workspaceUnlocked: true,
        workspacePasswordVersion,
      });
      setCookieValues.push(
        sessionCookiePolicy.serializeSessionCookie(
          session.id,
          transportSecurity,
        ),
      );
    }

    if (!session && cookieSessionId) {
      setCookieValues.push(
        sessionCookiePolicy.serializeClearedCookie(transportSecurity),
      );
    }

    // Bun 的 upgrade headers 只支援單一 Set-Cookie 字串；
    // 若需要多個 cookie，以逗號串接（RFC 6265 允許多個 Set-Cookie 欄位，
    // 但 Bun 目前只送出一個 header，故改以分行的 \r\nSet-Cookie: 處理）。
    // 實際上在 upgrade 握手時瀏覽器能正確接受多個 header。
    const headers: Record<string, string> = {};
    if (setCookieValues.length === 1) {
      headers["Set-Cookie"] = setCookieValues[0];
    } else if (setCookieValues.length > 1) {
      // 以第一個為主，其餘透過額外的 header 行送出
      headers["Set-Cookie"] = setCookieValues[0];
      for (let i = 1; i < setCookieValues.length; i++) {
        headers[`Set-Cookie${i}`] = setCookieValues[i];
      }
    }

    return {
      data: {
        connectionId: "",
        sessionId: session?.id ?? null,
        transportSecurity,
        remoteIp: remoteIp ?? null,
      },
      headers: setCookieValues.length > 0 ? headers : undefined,
    };
  }

  resolveRequestSessionId(req: Request): string | null {
    const cookies = parseCookieHeader(req.headers.get("cookie"));
    const sessionId = cookies.get(SESSION_COOKIE_NAME) ?? null;
    return sessionStore.getSession(sessionId)?.id ?? null;
  }
}

export const handshakeAuthService = new HandshakeAuthService();
