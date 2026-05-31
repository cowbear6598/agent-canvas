import { handleImportBundle } from "./bundleImportApi.js";
import { handleInternalIntegrationReply } from "./internalIntegrationReplyApi.js";
import { handleDownloadPodDirectory } from "./podDownloadApi.js";
import { handleRedeemReconnectGrant } from "./reconnectGrantApi.js";
import { handleUpload } from "./uploadApi.js";

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
