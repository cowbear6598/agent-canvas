import { JSON_HEADERS } from "./constants.js";
import { logger } from "../utils/logger.js";
import { authAccessService } from "../services/auth/authAccessService.js";
import { handshakeAuthService } from "../services/auth/handshakeAuthService.js";
import { resolveCanvas } from "./apiHelpers.js";
import { HTTP_STATUS } from "../constants.js";
import {
  REST_ROUTE_DEFINITIONS,
  type ApiHandler,
  type RestRouteScope,
} from "./restRouteManifest.js";
import {
  agentAccessTokenStore,
  type AgentAccessScope,
} from "../services/agentAccess/agentAccessTokenStore.js";

interface Route {
  method: string;
  pattern: URLPattern;
  handler: ApiHandler;
  scope: RestRouteScope;
  requiredAgentScope?: AgentAccessScope;
  resolveCanvasId?: (
    req: Request,
    params: Record<string, string>,
  ) => Promise<string | null> | string | null;
}

const ROUTES: Route[] = REST_ROUTE_DEFINITIONS.map((route) => ({
  method: route.method,
  pattern: new URLPattern({ pathname: route.path }),
  handler: route.handler,
  scope: route.scope,
  requiredAgentScope: route.requiredAgentScope,
  resolveCanvasId: "resolveCanvasId" in route ? route.resolveCanvasId : undefined,
}));

function matchRoute(
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;

    const result = route.pattern.exec({ pathname });
    if (result) {
      return {
        route,
        params: result.pathname.groups as Record<string, string>,
      };
    }
  }

  return null;
}

function notFoundApiResponse(): Response {
  return new Response(JSON.stringify({ error: "找不到 API 路徑" }), {
    status: HTTP_STATUS.NOT_FOUND,
    headers: JSON_HEADERS,
  });
}

function forbiddenResponse(error: string, code: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    status: HTTP_STATUS.FORBIDDEN,
    headers: JSON_HEADERS,
  });
}

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Token 無效、已過期或已撤銷", code: "INVALID_TOKEN" }),
    { status: HTTP_STATUS.UNAUTHORIZED, headers: JSON_HEADERS },
  );
}

async function resolveRouteCanvasId(
  req: Request,
  route: Route,
  params: Record<string, string>,
): Promise<string | null> {
  return (await route.resolveCanvasId?.(req, params)) ?? params.id ?? null;
}

async function authorizeAgentRoute(
  req: Request,
  route: Route,
  params: Record<string, string>,
): Promise<Response | null> {
  const token = agentAccessTokenStore.resolveBearer(req);
  if (!token) return unauthorizedResponse();
  if (!route.requiredAgentScope || !token.hasScope(route.requiredAgentScope)) {
    return forbiddenResponse("Token 缺少必要的 scope", "INSUFFICIENT_SCOPE");
  }

  const rawCanvasId = await resolveRouteCanvasId(req, route, params);
  const canvas = rawCanvasId ? resolveCanvas(rawCanvasId) : null;
  if (canvas && !token.canvasIds.includes(canvas.id)) {
    return forbiddenResponse("Token 未授權此 Canvas", "CANVAS_NOT_GRANTED");
  }
  return null;
}

async function authorizeWorkspaceRoute(
  req: Request,
  route: Route,
  params: Record<string, string>,
): Promise<Response | null> {
  const sessionId = handshakeAuthService.resolveRequestSessionId(req);
  if (!authAccessService.isWorkspaceAccessible(sessionId)) {
    return forbiddenResponse(
      "Workspace password required",
      "WORKSPACE_PASSWORD_REQUIRED",
    );
  }
  if (route.scope !== "canvas") return null;

  const rawCanvasId = await resolveRouteCanvasId(req, route, params);
  const canvasId = rawCanvasId ? resolveCanvas(rawCanvasId)?.id : null;
  if (
    canvasId &&
    authAccessService.requiresCanvasUnlockAssumingWorkspace(sessionId, canvasId)
  ) {
    return forbiddenResponse(
      "Canvas password required",
      "CANVAS_PASSWORD_REQUIRED",
    );
  }
  return null;
}

async function authorizeRoute(
  req: Request,
  route: Route,
  params: Record<string, string>,
): Promise<Response | null> {
  if (route.scope === "public") return null;
  if (route.scope === "agent") {
    return authorizeAgentRoute(req, route, params);
  }
  return authorizeWorkspaceRoute(req, route, params);
}

export async function handleApiRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);

  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  const match = matchRoute(req.method, url.pathname);

  if (!match) {
    return notFoundApiResponse();
  }

  try {
    const authFailure = await authorizeRoute(req, match.route, match.params);
    if (authFailure) {
      return authFailure;
    }

    return await match.route.handler(req, match.params);
  } catch (error) {
    logger.error("Canvas", "Error", "處理 API 請求時發生錯誤", error);
    return new Response(JSON.stringify({ error: "伺服器內部錯誤" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
