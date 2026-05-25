import { sessionStore } from "../services/auth/sessionStore.js";
import { transportSecurityService } from "../services/auth/transportSecurityService.js";
import { RECONNECT_GRANT_COOKIE_NAME } from "../services/auth/handshakeAuthService.js";
import { JSON_HEADERS } from "./constants.js";

const RECONNECT_GRANT_TTL_SECONDS = 30;

/**
 * POST /api/auth/redeem-reconnect-grant
 *
 * 前端在 workspace 解鎖後，將 reconnect grant 換成短效 HttpOnly cookie。
 * 之後的 WS 重連由 cookie 帶 grant，不再出現在 URL query string。
 *
 * Request body: { grant: string }
 * Response:
 *   - 200 + Set-Cookie ac_reconnect_grant（HttpOnly，TTL 30s）→ 換發成功
 *   - 400 → 請求格式錯誤
 *   - 401 → grant 無效或已過期
 */
export async function handleRedeemReconnectGrant(
  req: Request,
): Promise<Response> {
  const transportSecurity = transportSecurityService.getRequestInfo(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "請求格式錯誤，需要 JSON body" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).grant !== "string"
  ) {
    return new Response(JSON.stringify({ error: "缺少 grant 欄位" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const grant = (body as { grant: string }).grant;

  // 驗證 grant 有效（不消耗，讓 WS handshake 時再消耗）
  const session = sessionStore.peekReconnectGrant(grant);
  if (!session) {
    return new Response(JSON.stringify({ error: "grant 無效或已過期" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const secure = transportSecurity.isTls;

  const cookieAttrs = [
    `${RECONNECT_GRANT_COOKIE_NAME}=${encodeURIComponent(grant)}`,
    "Path=/",
    `Max-Age=${RECONNECT_GRANT_TTL_SECONDS}`,
    "SameSite=Strict",
    "HttpOnly",
  ];
  if (secure) cookieAttrs.push("Secure");
  const cookieValue = cookieAttrs.join("; ");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      "Set-Cookie": cookieValue,
    },
  });
}
