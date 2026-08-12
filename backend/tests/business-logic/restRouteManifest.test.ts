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
      });
      expect(route.handler.name).toBe(route.handlerName);
    }
  });

  it("只保留產品目前需要的 HTTP route", () => {
    expect(REST_ROUTE_MANIFEST).toEqual([
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
    ]);
  });

  it("manifest 不再暴露已移除的 canvas、pod、connection 與 workflow route", () => {
    const removedPaths = [
      "/api/canvas/list",
      "/api/canvas",
      "/api/canvas/:id/pods",
      "/api/canvas/:id/pods/:podId",
      "/api/canvas/:id/connections",
      "/api/canvas/:id/connections/:connectionId",
      "/api/canvas/:id/workflows",
      "/api/canvas/:id/workflows/:podId/chat",
      "/api/canvas/:id/workflows/:podId/stop",
    ];

    for (const path of removedPaths) {
      expect(REST_ROUTE_MANIFEST).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
    }
  });

  it("manifest 不暴露 runtime handler，並保留 schema 對應欄位", () => {
    for (const route of REST_ROUTE_MANIFEST) {
      expect(route).not.toHaveProperty("handler");
      expect(route).toHaveProperty("requestSchema");
      expect(route).toHaveProperty("responseSchema");
    }
  });
});
