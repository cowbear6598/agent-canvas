import {
  REST_ROUTE_DEFINITIONS,
  REST_ROUTE_MANIFEST,
} from "../../src/api/restRouteManifest.js";

describe("REST route manifest", () => {
  it("manifest 與 router route definitions 使用同一份 route 定義來源", () => {
    expect(REST_ROUTE_MANIFEST).toHaveLength(REST_ROUTE_DEFINITIONS.length);

    for (const route of REST_ROUTE_DEFINITIONS) {
      expect(REST_ROUTE_MANIFEST).toContainEqual({
        method: route.method,
        path: route.path,
        handlerName: route.handlerName,
        scope: route.scope,
        requestSchema: route.requestSchema,
        responseSchema: route.responseSchema,
        ...(route.requiredAgentScope && {
          requiredAgentScope: route.requiredAgentScope,
        }),
      });
      expect(route.handler.name).toBe(route.handlerName);
    }
  });

  it("保留既有 HTTP route，並新增 AI 存取與版本化 Canvas API", () => {
    expect(REST_ROUTE_MANIFEST).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "GET",
        path: "/api/ai-access",
        handlerName: "handleAgentAccessInfo",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/ai-access/tokens",
        handlerName: "handleAgentAccessTokenCreate",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/drafts",
        handlerName: "handleAgentDraftCreate",
        requiredAgentScope: "canvas:create",
      }),
      expect.objectContaining({
        method: "PATCH",
        path: "/api/v1/canvases/:id/pods/:podId",
        handlerName: "handleAgentPodUpdate",
        requiredAgentScope: "canvas:write",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/canvases/:id/workflows/:podId/runs",
        handlerName: "handleAgentWorkflowStart",
        requiredAgentScope: "canvas:execute",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/pod-packs/export",
        handlerName: "handleExportPodPack",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/pod-packs/preview",
        handlerName: "handlePreviewPodPack",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/pod-packs/import",
        handlerName: "handleImportPodPack",
      }),
      expect.objectContaining({
        method: "GET",
        path: "/api/canvas/:id/pods/:podId/download",
        handlerName: "handleDownloadPodDirectory",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/bundles/import",
        handlerName: "handleImportBundle",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/upload",
        handlerName: "handleUpload",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/auth/redeem-reconnect-grant",
        handlerName: "handleRedeemReconnectGrant",
      }),
      expect.objectContaining({
        method: "POST",
        path: "/api/internal/integration-reply",
        handlerName: "handleInternalIntegrationReply",
      }),
    ]));
  });

  it("不暴露一般破壞性 AI API，只允許停止仍在執行的 Run", () => {
    const removedRoutes = [
      ["DELETE", "/api/v1/canvases/:id"],
      ["DELETE", "/api/v1/canvases/:id/pods/:podId"],
      ["DELETE", "/api/v1/canvases/:id/connections/:connectionId"],
    ];

    for (const [method, path] of removedRoutes) {
      expect(REST_ROUTE_MANIFEST).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ method, path })]),
      );
    }
    expect(REST_ROUTE_MANIFEST).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "DELETE",
          path: "/api/v1/canvases/:id/runs/:runId",
          requiredAgentScope: "canvas:execute",
        }),
      ]),
    );
  });

  it("manifest 不暴露 runtime handler，並保留 schema 對應欄位", () => {
    for (const route of REST_ROUTE_MANIFEST) {
      expect(route).not.toHaveProperty("handler");
      expect(route).toHaveProperty("requestSchema");
      expect(route).toHaveProperty("responseSchema");
    }
  });
});
