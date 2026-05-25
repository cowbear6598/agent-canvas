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

  it("列出 canvas 與 pod 重要 route 的 method、path 與 handler 對應", () => {
    expect(REST_ROUTE_MANIFEST).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/api/canvas/list",
          handlerName: "handleListCanvases",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/api/canvas",
          handlerName: "handleCreateCanvas",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/api/canvas/:id/pods",
          handlerName: "handleCreatePod",
        }),
        expect.objectContaining({
          method: "PATCH",
          path: "/api/canvas/:id/pods/:podId",
          handlerName: "handleRenamePod",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/api/canvas/:id/workflows/:podId/chat",
          handlerName: "handleWorkflowChat",
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
