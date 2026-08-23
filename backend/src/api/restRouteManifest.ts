import { handleImportBundle } from "./bundleImportApi.js";
import { handleInternalIntegrationReply } from "./internalIntegrationReplyApi.js";
import { handleDownloadPodDirectory } from "./podDownloadApi.js";
import { handleRedeemReconnectGrant } from "./reconnectGrantApi.js";
import { handleUpload } from "./uploadApi.js";
import {
  handleCancelPodPackTransfer,
  handleDownloadPodPack,
  handleExportPodPack,
  handleImportPodPack,
  handlePreviewPodPack,
} from "./podPackApi.js";
import {
  handleAgentAccessInfo,
  handleAgentAccessSettingsUpdate,
  handleAgentAccessSkillDownload,
  handleAgentAccessTokenCreate,
  handleAgentAccessTokenList,
  handleAgentAccessTokenRevoke,
} from "./agentAccessManagementApi.js";
import {
  handleAgentCanvasCreate,
  handleAgentCanvasGet,
  handleAgentCanvasList,
  handleAgentConnectionCreate,
  handleAgentConnectionList,
  handleAgentConnectionUpdate,
  handleAgentDraftCreate,
  handleAgentPodCreate,
  handleAgentPodList,
  handleAgentPodUpdate,
  handleAgentResourceList,
  handleAgentRunGet,
  handleAgentRunStop,
  handleAgentWorkflowList,
  handleAgentWorkflowStart,
} from "./agentCanvasApi.js";
import type { AgentAccessScope } from "../services/agentAccess/agentAccessTokenStore.js";
import { handleInternalAgentCanvas } from "./internalAgentCanvasApi.js";

export type ApiHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

export type RestRouteMethod = "DELETE" | "GET" | "PATCH" | "POST";
export type RestRouteScope = "public" | "workspace" | "canvas" | "agent";

export interface RestRouteDefinition {
  method: RestRouteMethod;
  path: string;
  handlerName: string;
  handler: ApiHandler;
  scope: RestRouteScope;
  requestSchema: string | null;
  responseSchema: string | null;
  requiredAgentScope?: AgentAccessScope;
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
  requiredAgentScope?: AgentAccessScope;
}

export const REST_ROUTE_DEFINITIONS: readonly RestRouteDefinition[] = [
  {
    method: "GET",
    path: "/api/ai-access",
    handlerName: "handleAgentAccessInfo",
    handler: handleAgentAccessInfo,
    scope: "workspace",
    requestSchema: null,
    responseSchema: "AgentAccessInfo",
  },
  {
    method: "PATCH",
    path: "/api/ai-access",
    handlerName: "handleAgentAccessSettingsUpdate",
    handler: handleAgentAccessSettingsUpdate,
    scope: "workspace",
    requestSchema: "AgentAccessSettingsUpdate",
    responseSchema: "AgentAccessInfo",
  },
  {
    method: "GET",
    path: "/api/ai-access/tokens",
    handlerName: "handleAgentAccessTokenList",
    handler: handleAgentAccessTokenList,
    scope: "workspace",
    requestSchema: null,
    responseSchema: "AgentAccessTokenList",
  },
  {
    method: "POST",
    path: "/api/internal/agent-canvas",
    handlerName: "handleInternalAgentCanvas",
    handler: handleInternalAgentCanvas,
    scope: "public",
    requestSchema: "AgentCanvasCapabilityRequest",
    responseSchema: "AgentCanvasCapabilityResponse",
  },
  {
    method: "POST",
    path: "/api/ai-access/tokens",
    handlerName: "handleAgentAccessTokenCreate",
    handler: handleAgentAccessTokenCreate,
    scope: "workspace",
    requestSchema: "AgentAccessTokenCreate",
    responseSchema: "AgentAccessTokenCreated",
  },
  {
    method: "DELETE",
    path: "/api/ai-access/tokens/:tokenId",
    handlerName: "handleAgentAccessTokenRevoke",
    handler: handleAgentAccessTokenRevoke,
    scope: "workspace",
    requestSchema: null,
    responseSchema: "{ success }",
  },
  {
    method: "GET",
    path: "/api/ai-access/skill",
    handlerName: "handleAgentAccessSkillDownload",
    handler: handleAgentAccessSkillDownload,
    scope: "workspace",
    requestSchema: null,
    responseSchema: "application/zip",
  },
  {
    method: "GET",
    path: "/api/v1/canvases",
    handlerName: "handleAgentCanvasList",
    handler: handleAgentCanvasList,
    scope: "agent",
    requiredAgentScope: "canvas:read",
    requestSchema: null,
    responseSchema: "AgentCanvasList",
  },
  {
    method: "POST",
    path: "/api/v1/canvases",
    handlerName: "handleAgentCanvasCreate",
    handler: handleAgentCanvasCreate,
    scope: "agent",
    requiredAgentScope: "canvas:create",
    requestSchema: "AgentCanvasCreate",
    responseSchema: "AgentCanvasCreated",
  },
  {
    method: "POST",
    path: "/api/v1/drafts",
    handlerName: "handleAgentDraftCreate",
    handler: handleAgentDraftCreate,
    scope: "agent",
    requiredAgentScope: "canvas:create",
    requestSchema: "AgentCanvasDraftCreate",
    responseSchema: "AgentCanvasDraftCreated",
  },
  {
    method: "GET",
    path: "/api/v1/canvases/:id",
    handlerName: "handleAgentCanvasGet",
    handler: handleAgentCanvasGet,
    scope: "agent",
    requiredAgentScope: "canvas:read",
    requestSchema: null,
    responseSchema: "AgentCanvasDetail",
  },
  {
    method: "GET",
    path: "/api/v1/canvases/:id/pods",
    handlerName: "handleAgentPodList",
    handler: handleAgentPodList,
    scope: "agent",
    requiredAgentScope: "canvas:read",
    requestSchema: null,
    responseSchema: "AgentPodList",
  },
  {
    method: "POST",
    path: "/api/v1/canvases/:id/pods",
    handlerName: "handleAgentPodCreate",
    handler: handleAgentPodCreate,
    scope: "agent",
    requiredAgentScope: "canvas:write",
    requestSchema: "AgentPodCreate",
    responseSchema: "AgentPodCreated",
  },
  {
    method: "PATCH",
    path: "/api/v1/canvases/:id/pods/:podId",
    handlerName: "handleAgentPodUpdate",
    handler: handleAgentPodUpdate,
    scope: "agent",
    requiredAgentScope: "canvas:write",
    requestSchema: "AgentPodUpdate",
    responseSchema: "AgentPodUpdated",
  },
  {
    method: "GET",
    path: "/api/v1/canvases/:id/connections",
    handlerName: "handleAgentConnectionList",
    handler: handleAgentConnectionList,
    scope: "agent",
    requiredAgentScope: "canvas:read",
    requestSchema: null,
    responseSchema: "AgentConnectionList",
  },
  {
    method: "POST",
    path: "/api/v1/canvases/:id/connections",
    handlerName: "handleAgentConnectionCreate",
    handler: handleAgentConnectionCreate,
    scope: "agent",
    requiredAgentScope: "canvas:write",
    requestSchema: "AgentConnectionCreate",
    responseSchema: "AgentConnectionCreated",
  },
  {
    method: "PATCH",
    path: "/api/v1/canvases/:id/connections/:connectionId",
    handlerName: "handleAgentConnectionUpdate",
    handler: handleAgentConnectionUpdate,
    scope: "agent",
    requiredAgentScope: "canvas:write",
    requestSchema: "AgentConnectionUpdate",
    responseSchema: "AgentConnectionUpdated",
  },
  {
    method: "GET",
    path: "/api/v1/canvases/:id/workflows",
    handlerName: "handleAgentWorkflowList",
    handler: handleAgentWorkflowList,
    scope: "agent",
    requiredAgentScope: "canvas:execute",
    requestSchema: null,
    responseSchema: "AgentWorkflowList",
  },
  {
    method: "POST",
    path: "/api/v1/canvases/:id/workflows/:podId/runs",
    handlerName: "handleAgentWorkflowStart",
    handler: handleAgentWorkflowStart,
    scope: "agent",
    requiredAgentScope: "canvas:execute",
    requestSchema: "AgentRunCreate",
    responseSchema: "AgentRunAccepted",
  },
  {
    method: "GET",
    path: "/api/v1/canvases/:id/runs/:runId",
    handlerName: "handleAgentRunGet",
    handler: handleAgentRunGet,
    scope: "agent",
    requiredAgentScope: "canvas:execute",
    requestSchema: null,
    responseSchema: "AgentRunStatus",
  },
  {
    method: "DELETE",
    path: "/api/v1/canvases/:id/runs/:runId",
    handlerName: "handleAgentRunStop",
    handler: handleAgentRunStop,
    scope: "agent",
    requiredAgentScope: "canvas:execute",
    requestSchema: null,
    responseSchema: "{ success, runId }",
  },
  {
    method: "GET",
    path: "/api/v1/resources/:kind",
    handlerName: "handleAgentResourceList",
    handler: handleAgentResourceList,
    scope: "agent",
    requiredAgentScope: "canvas:read",
    requestSchema: null,
    responseSchema: "AgentResourceList",
  },
  {
    method: "POST",
    path: "/api/pod-packs/export",
    handlerName: "handleExportPodPack",
    handler: handleExportPodPack,
    scope: "workspace",
    requestSchema: "PodPackExportRequest",
    responseSchema: "application/vnd.agent-canvas.podpack+zip",
  },
  {
    method: "POST",
    path: "/api/pod-packs/preview",
    handlerName: "handlePreviewPodPack",
    handler: handlePreviewPodPack,
    scope: "workspace",
    requestSchema: "application/vnd.agent-canvas.podpack+zip",
    responseSchema: "{ transferId, filename, size, preview }",
  },
  {
    method: "POST",
    path: "/api/pod-packs/import",
    handlerName: "handleImportPodPack",
    handler: handleImportPodPack,
    scope: "canvas",
    requestSchema: "{ transferId, canvasId, targetX, targetY }",
    responseSchema: "PodPackImportResult",
    resolveCanvasId: async (req): Promise<string | null> => {
      const body = await req.clone().json().catch(() => null) as { canvasId?: string } | null;
      return body?.canvasId ?? null;
    },
  },
  {
    method: "GET",
    path: "/api/pod-packs/transfers/:transferId/download",
    handlerName: "handleDownloadPodPack",
    handler: handleDownloadPodPack,
    scope: "workspace",
    requestSchema: null,
    responseSchema: "application/vnd.agent-canvas.podpack+zip",
  },
  {
    method: "DELETE",
    path: "/api/pod-packs/transfers/:transferId",
    handlerName: "handleCancelPodPackTransfer",
    handler: handleCancelPodPackTransfer,
    scope: "workspace",
    requestSchema: null,
    responseSchema: "{ success }",
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
      requiredAgentScope,
    }) => ({
      method,
      path,
      handlerName,
      scope,
      requestSchema,
      responseSchema,
      ...(requiredAgentScope && { requiredAgentScope }),
    }),
  );
