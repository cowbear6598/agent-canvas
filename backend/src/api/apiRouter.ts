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
import { JSON_HEADERS } from "./constants.js";
import { logger } from "../utils/logger.js";

type ApiHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: ApiHandler;
}

const ROUTES: Route[] = [
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/list" }),
    handler: handleListCanvases,
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/canvas" }),
    handler: handleCreateCanvas,
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods" }),
    handler: handleListPods,
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods" }),
    handler: handleCreatePod,
  },
  {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods/:podId" }),
    handler: handleDeletePod,
  },
  {
    method: "DELETE",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/connections/:connectionId",
    }),
    handler: handleDeleteConnection,
  },
  {
    method: "PATCH",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/connections/:connectionId",
    }),
    handler: handleUpdateConnection,
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/connections" }),
    handler: handleListConnections,
  },
  {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/connections" }),
    handler: handleCreateConnection,
  },
  {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/api/canvas/:id" }),
    handler: handleDeleteCanvas,
  },
  {
    method: "PATCH",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/pods/:podId" }),
    handler: handleRenamePod,
  },
  {
    method: "PATCH",
    pattern: new URLPattern({ pathname: "/api/canvas/:id" }),
    handler: handleRenameCanvas,
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/canvas/:id/workflows" }),
    handler: handleListWorkflows,
  },
  {
    method: "POST",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/workflows/:podId/chat",
    }),
    handler: handleWorkflowChat,
  },
  {
    method: "POST",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/workflows/:podId/stop",
    }),
    handler: handleWorkflowStop,
  },
  {
    method: "GET",
    pattern: new URLPattern({
      pathname: "/api/canvas/:id/pods/:podId/download",
    }),
    handler: handleDownloadPodDirectory,
  },
];

function matchRoute(
  method: string,
  pathname: string,
): { handler: ApiHandler; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;

    const result = route.pattern.exec({ pathname });
    if (result) {
      return {
        handler: route.handler,
        params: (result.pathname.groups ?? {}) as Record<string, string>,
      };
    }
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
    return await match.handler(req, match.params);
  } catch (error) {
    logger.error("Canvas", "Error", "處理 API 請求時發生錯誤", error);
    return new Response(JSON.stringify({ error: "伺服器內部錯誤" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
