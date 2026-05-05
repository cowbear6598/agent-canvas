import {
  handleListCanvases,
  handleCreateCanvas,
  handleDeleteCanvas,
  handleRenameCanvas,
} from "./canvasApi.js";
import {
  handleListPods,
  handleCreatePod,
  handleDeletePod,
  handleRenamePod,
} from "./podApi.js";
import {
  handleListConnections,
  handleCreateConnection,
  handleDeleteConnection,
  handleUpdateConnection,
} from "./connectionApi.js";
import {
  handleListWorkflows,
  handleWorkflowChat,
  handleWorkflowStop,
} from "./workflowApi.js";
import { handleDownloadPodDirectory } from "./podDownloadApi.js";
import { handleUpload } from "./uploadApi.js";
import { handleRedeemReconnectGrant } from "./reconnectGrantApi.js";
import { JSON_HEADERS } from "./constants.js";
import { logger } from "../utils/logger.js";
import { authAccessService } from "../services/auth/authAccessService.js";
import { handshakeAuthService } from "../services/auth/handshakeAuthService.js";
import { resolveCanvas } from "./apiHelpers.js";
import { HTTP_STATUS } from "../constants.js";

type ApiHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

type RouteScope = "public" | "workspace" | "canvas";

interface Route {
  method: string;
  pattern: URLPattern;
  handler: ApiHandler;
  scope: RouteScope;
  resolveCanvasId?: (
    req: Request,
    params: Record<string, string>,
  ) => Promise<string | null> | string | null;
}

const ROUTES: Route[] = [
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/list" }),
    handler: handleListCanvases,
    scope: "workspace",
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/canvas" }),
    handler: handleCreateCanvas,
    scope: "workspace",
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods" }),
    handler: handleListPods,
    scope: "canvas",
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods" }),
    handler: handleCreatePod,
    scope: "canvas",
  },
  {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods/:podId" }),
    handler: handleDeletePod,
    scope: "canvas",
  },
  {
    method: "DELETE",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/connections/:connectionId",
    }),
    handler: handleDeleteConnection,
    scope: "canvas",
  },
  {
    method: "PATCH",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/connections/:connectionId",
    }),
    handler: handleUpdateConnection,
    scope: "canvas",
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/connections" }),
    handler: handleListConnections,
    scope: "canvas",
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/connections" }),
    handler: handleCreateConnection,
    scope: "canvas",
  },
  {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/api/canvas/:id" }),
    handler: handleDeleteCanvas,
    scope: "canvas",
  },
  {
    method: "PATCH",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods/:podId" }),
    handler: handleRenamePod,
    scope: "canvas",
  },
  {
    method: "PATCH",
    pattern: new URLPattern({ pathname: "/api/canvas/:id" }),
    handler: handleRenameCanvas,
    scope: "canvas",
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/workflows" }),
    handler: handleListWorkflows,
    scope: "canvas",
  },
  {
    method: "POST",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/workflows/:podId/chat",
    }),
    handler: handleWorkflowChat,
    scope: "canvas",
  },
  {
    method: "POST",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/workflows/:podId/stop",
    }),
    handler: handleWorkflowStop,
    scope: "canvas",
  },
  {
    method: "GET",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/pods/:podId/download",
    }),
    handler: handleDownloadPodDirectory,
    scope: "canvas",
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/upload" }),
    handler: handleUpload,
    scope: "public",
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/auth/redeem-reconnect-grant" }),
    handler: handleRedeemReconnectGrant,
    scope: "public",
  },
];

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
        params: (result.pathname.groups ?? {}) as Record<string, string>,
      };
    }
  }

  return null;
}

function forbiddenResponse(error: string, code: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    status: HTTP_STATUS.FORBIDDEN,
    headers: JSON_HEADERS,
  });
}

async function authorizeRoute(
  req: Request,
  route: Route,
  params: Record<string, string>,
): Promise<Response | null> {
  if (route.scope === "public") {
    return null;
  }

  const sessionId = handshakeAuthService.resolveRequestSessionId(req);
  // workspace 可存取性只呼叫一次，避免 canvas 檢查時重複查詢
  if (!authAccessService.isWorkspaceAccessible(sessionId)) {
    return forbiddenResponse(
      "Workspace password required",
      "WORKSPACE_PASSWORD_REQUIRED",
    );
  }

  if (route.scope !== "canvas") {
    return null;
  }

  const rawCanvasId =
    (await route.resolveCanvasId?.(req, params)) ?? params.id ?? null;

  // 將 canvas name 或 UUID 解析成實際的 UUID，不存在時為 undefined
  const resolvedCanvas = rawCanvasId ? resolveCanvas(rawCanvasId) : null;
  const canvasId = resolvedCanvas?.id ?? null;

  // workspace 已確認可存取，直接使用 AssumingWorkspace 版本避免重複呼叫。
  // 只有在 canvas 存在且受密碼保護且尚未解鎖時才拒絕；
  // canvas 不存在或未受保護時讓 handler 自行回傳 404 或正常回應。
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

export async function handleApiRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);

  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  const match = matchRoute(req.method, url.pathname);

  if (!match) {
    return new Response(JSON.stringify({ error: "找不到 API 路徑" }), {
      status: 404,
      headers: JSON_HEADERS,
    });
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
