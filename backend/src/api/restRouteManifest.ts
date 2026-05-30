import {
  handleCreateCanvas,
  handleDeleteCanvas,
  handleListCanvases,
  handleRenameCanvas,
} from "./canvasApi.js";
import {
  handleCreateConnection,
  handleDeleteConnection,
  handleListConnections,
  handleUpdateConnection,
} from "./connectionApi.js";
import { handleImportBundle } from "./bundleImportApi.js";
import { handleInternalIntegrationReply } from "./internalIntegrationReplyApi.js";
import {
  handleCreatePod,
  handleDeletePod,
  handleListPods,
  handleRenamePod,
} from "./podApi.js";
import { handleDownloadPodDirectory } from "./podDownloadApi.js";
import { handleRedeemReconnectGrant } from "./reconnectGrantApi.js";
import { handleUpload } from "./uploadApi.js";
import {
  handleListWorkflows,
  handleWorkflowChat,
  handleWorkflowStop,
} from "./workflowApi.js";

export type ApiHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

export type RestRouteMethod = "DELETE" | "GET" | "PATCH" | "POST";
export type RestRouteScope = "public" | "workspace" | "canvas";

export interface RestRouteDefinition {
  method: RestRouteMethod;
  path: string;
  handlerName: string;
  handler: ApiHandler;
  scope: RestRouteScope;
  requestSchema: string | null;
  responseSchema: string | null;
  resolveCanvasId?: (
    req: Request,
    params: Record<string, string>,
  ) => Promise<string | null> | string | null;
}

export interface RestRouteManifestEntry {
  method: RestRouteMethod;
  path: string;
  handlerName: string;
  scope: RestRouteScope;
  requestSchema: string | null;
  responseSchema: string | null;
}

export const REST_ROUTE_DEFINITIONS: readonly RestRouteDefinition[] = [
  {
    method: "GET",
    path: "/api/canvas/list",
    handlerName: "handleListCanvases",
    handler: handleListCanvases,
    scope: "workspace",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/canvas",
    handlerName: "handleCreateCanvas",
    handler: handleCreateCanvas,
    scope: "workspace",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "GET",
    path: "/api/canvas/:id/pods",
    handlerName: "handleListPods",
    handler: handleListPods,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/canvas/:id/pods",
    handlerName: "handleCreatePod",
    handler: handleCreatePod,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "DELETE",
    path: "/api/canvas/:id/pods/:podId",
    handlerName: "handleDeletePod",
    handler: handleDeletePod,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "DELETE",
    path: "/api/canvas/:id/connections/:connectionId",
    handlerName: "handleDeleteConnection",
    handler: handleDeleteConnection,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "PATCH",
    path: "/api/canvas/:id/connections/:connectionId",
    handlerName: "handleUpdateConnection",
    handler: handleUpdateConnection,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "GET",
    path: "/api/canvas/:id/connections",
    handlerName: "handleListConnections",
    handler: handleListConnections,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/canvas/:id/connections",
    handlerName: "handleCreateConnection",
    handler: handleCreateConnection,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "DELETE",
    path: "/api/canvas/:id",
    handlerName: "handleDeleteCanvas",
    handler: handleDeleteCanvas,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "PATCH",
    path: "/api/canvas/:id/pods/:podId",
    handlerName: "handleRenamePod",
    handler: handleRenamePod,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "PATCH",
    path: "/api/canvas/:id",
    handlerName: "handleRenameCanvas",
    handler: handleRenameCanvas,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "GET",
    path: "/api/canvas/:id/workflows",
    handlerName: "handleListWorkflows",
    handler: handleListWorkflows,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/canvas/:id/workflows/:podId/chat",
    handlerName: "handleWorkflowChat",
    handler: handleWorkflowChat,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/canvas/:id/workflows/:podId/stop",
    handlerName: "handleWorkflowStop",
    handler: handleWorkflowStop,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "GET",
    path: "/api/canvas/:id/pods/:podId/download",
    handlerName: "handleDownloadPodDirectory",
    handler: handleDownloadPodDirectory,
    scope: "canvas",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/bundles/import",
    handlerName: "handleImportBundle",
    handler: handleImportBundle,
    scope: "workspace",
    requestSchema: "multipart/form-data(bundle=File)",
    responseSchema: "{ bundle }",
  },
  {
    method: "POST",
    path: "/api/upload",
    handlerName: "handleUpload",
    handler: handleUpload,
    scope: "public",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/auth/redeem-reconnect-grant",
    handlerName: "handleRedeemReconnectGrant",
    handler: handleRedeemReconnectGrant,
    scope: "public",
    requestSchema: null,
    responseSchema: null,
  },
  {
    method: "POST",
    path: "/api/internal/integration-reply",
    handlerName: "handleInternalIntegrationReply",
    handler: handleInternalIntegrationReply,
    scope: "public",
    requestSchema: null,
    responseSchema: null,
  },
];

export const REST_ROUTE_MANIFEST: RestRouteManifestEntry[] =
  REST_ROUTE_DEFINITIONS.map(
    ({
      method,
      path,
      handlerName,
      scope,
      requestSchema,
      responseSchema,
    }) => ({
      method,
      path,
      handlerName,
      scope,
      requestSchema,
      responseSchema,
    }),
  );
