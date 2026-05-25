import { describe, expect, it, vi } from "vitest";
import {
  createCanvasScopedPayload,
  createWebSocketActionFailure,
  createWebSocketActionSuccess,
  getWebSocketResponseRequestId,
  mapWebSocketResponse,
  responseMatchesRequest,
} from "@/services/websocket/webSocketResponseMapper";

describe("webSocketResponseMapper", () => {
  it("成功 response 應保留原始 payload 並解析 requestId", () => {
    const response = {
      requestId: "req-1",
      success: true,
      pod: { id: "pod-1" },
    };

    expect(mapWebSocketResponse(response)).toEqual({
      ok: true,
      requestId: "req-1",
      data: response,
    });
  });

  it("success: false 且 error code 在白名單時應使用後端 message", () => {
    const result = mapWebSocketResponse({
      requestId: "req-2",
      success: false,
      error: {
        code: "alias_duplicate",
        message: "Alias 已存在",
      },
    });

    expect(result).toEqual({
      ok: false,
      requestId: "req-2",
      error: "Alias 已存在",
    });
  });

  it("success: false 且 error code 無對應翻譯時應維持既有未知錯誤結果", () => {
    const result = mapWebSocketResponse({
      requestId: "req-3",
      success: false,
      error: "raw backend error",
    });

    expect(result).toEqual({
      ok: false,
      requestId: "req-3",
      error: "未知錯誤",
    });
  });

  it("success: false 且後端使用 top-level code 時應轉成對應翻譯", () => {
    const result = mapWebSocketResponse({
      requestId: "req-locked-canvas",
      success: false,
      error: "Canvas password required",
      code: "CANVAS_PASSWORD_REQUIRED",
    });

    expect(result).toEqual({
      ok: false,
      requestId: "req-locked-canvas",
      error: "此 Canvas 已上鎖，請先解鎖後再操作",
    });
  });

  it("應集中判斷 requestId 對應與自訂 matcher", () => {
    const response = { requestId: "req-4", provider: "claude" };

    expect(getWebSocketResponseRequestId(response)).toBe("req-4");
    expect(responseMatchesRequest(response, "req-4")).toBe(true);
    expect(responseMatchesRequest(response, "req-5")).toBe(false);
    expect(
      responseMatchesRequest(response, "req-5", (payload, requestId) => {
        return payload.provider === "claude" && requestId === "req-5";
      }),
    ).toBe(true);
  });

  it("應集中組裝 canvas scoped command payload", () => {
    const payload = createCanvasScopedPayload<{
      requestId: string;
      canvasId: string;
      podId: string;
      name: string;
    }>({ podId: "pod-1", name: "Pod" }, "canvas-1");

    expect(payload).toEqual({
      canvasId: "canvas-1",
      podId: "pod-1",
      name: "Pod",
    });
  });

  it("應提供 action success/failure 結果 mapper", () => {
    const data = { requestId: "req-6", success: true };

    expect(createWebSocketActionSuccess(data)).toEqual({
      success: true,
      data,
    });
    expect(createWebSocketActionFailure("操作失敗")).toEqual({
      success: false,
      error: "操作失敗",
    });
  });

  it("自訂 matcher 應收到原始 response 與目標 requestId", () => {
    const matcher = vi.fn(() => true);
    const response = { requestId: "req-7" };

    expect(responseMatchesRequest(response, "target-req", matcher)).toBe(true);
    expect(matcher).toHaveBeenCalledWith(response, "target-req");
  });
});
