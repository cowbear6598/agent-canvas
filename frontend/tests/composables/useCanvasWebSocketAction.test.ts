import { describe, it, expect, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../helpers/mockWebSocket";
import { setupStoreTest } from "../helpers/testSetup";
import { useCanvasWebSocketAction } from "@/composables/useCanvasWebSocketAction";
import { useCanvasStore } from "@/stores/canvasStore";

vi.mock("@/services/websocket", () => webSocketMockFactory());

const { mockShowErrorToast } = vi.hoisted(() => ({
  mockShowErrorToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showErrorToast: mockShowErrorToast,
  }),
}));

describe("useCanvasWebSocketAction", () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  describe("executeAction - 成功情境", () => {
    it("成功時應回傳 { success: true, data }", async () => {
      const { executeAction } = useCanvasWebSocketAction();
      const responseData = { success: true, id: "item-1" };

      mockCreateWebSocketRequest.mockResolvedValueOnce(responseData);

      const result = await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: { someField: "value" },
        },
        {
          errorCategory: "Repository",
          errorAction: "操作失敗",
          errorMessage: "操作失敗訊息",
        },
      );

      expect(result).toEqual({ success: true, data: responseData });
    });

    it("應自動將 canvasId 加入 payload", async () => {
      const { executeAction } = useCanvasWebSocketAction();

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true });

      await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: { repositoryId: "repo-1" },
        },
        {
          errorCategory: "Repository",
          errorAction: "操作失敗",
          errorMessage: "操作失敗訊息",
        },
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            canvasId: "canvas-1",
            repositoryId: "repo-1",
          }),
        }),
      );
    });

    it("應傳遞正確的 requestEvent 和 responseEvent", async () => {
      const { executeAction } = useCanvasWebSocketAction();

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true });

      await executeAction(
        {
          requestEvent: "custom:request",
          responseEvent: "custom:response",
          payload: {},
        },
        {
          errorCategory: "Repository",
          errorAction: "操作失敗",
          errorMessage: "操作失敗訊息",
        },
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "custom:request",
          responseEvent: "custom:response",
        }),
      );
    });
  });

  describe("executeAction - WebSocket reject 情境", () => {
    it("WebSocket reject 時應顯示 error toast", async () => {
      const { executeAction } = useCanvasWebSocketAction();

      mockCreateWebSocketRequest.mockRejectedValueOnce(
        new Error("WebSocket failed"),
      );

      await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: {},
        },
        {
          errorCategory: "Repository",
          errorAction: "建立失敗",
          errorMessage: "建立資料夾失敗",
        },
      );

      expect(mockShowErrorToast).toHaveBeenCalledWith("Repository", "建立失敗");
    });

    it("WebSocket reject 時應回傳 { success: false, error }", async () => {
      const { executeAction } = useCanvasWebSocketAction();

      mockCreateWebSocketRequest.mockRejectedValueOnce(
        new Error("WebSocket failed"),
      );

      const result = await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: {},
        },
        {
          errorCategory: "Repository",
          errorAction: "建立失敗",
          errorMessage: "建立資料夾失敗",
        },
      );

      expect(result).toEqual({ success: false, error: "建立資料夾失敗" });
    });

    it("error toast 應使用正確的 errorCategory 和 errorAction", async () => {
      const { executeAction } = useCanvasWebSocketAction();

      mockCreateWebSocketRequest.mockRejectedValueOnce(
        new Error("WebSocket failed"),
      );

      await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: {},
        },
        {
          errorCategory: "Git",
          errorAction: "分支刪除失敗",
          errorMessage: "刪除分支失敗",
        },
      );

      expect(mockShowErrorToast).toHaveBeenCalledWith("Git", "分支刪除失敗");
    });
  });

  describe("executeAction - 沒有 active canvas 情境", () => {
    it("沒有 activeCanvasId 時應回傳 { success: false, error }", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      const { executeAction } = useCanvasWebSocketAction();

      const result = await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: {},
        },
        {
          errorCategory: "Repository",
          errorAction: "操作失敗",
          errorMessage: "操作失敗訊息",
        },
      );

      expect(result.success).toBe(false);
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });
  });

  describe("executeAction - WebSocket 請求失敗情境", () => {
    it("createWebSocketRequest 拋出例外時應回傳 { success: false, error }", async () => {
      const { executeAction } = useCanvasWebSocketAction();

      mockCreateWebSocketRequest.mockRejectedValueOnce(
        new Error("WebSocket 連線失敗"),
      );

      const result = await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: {},
        },
        {
          errorCategory: "Repository",
          errorAction: "操作失敗",
          errorMessage: "操作失敗訊息",
        },
      );

      expect(result).toEqual({ success: false, error: "操作失敗訊息" });
    });

    it("請求失敗時不應顯示兩次 error toast（wrapWebSocketRequest 吞例外）", async () => {
      const { executeAction } = useCanvasWebSocketAction();

      mockCreateWebSocketRequest.mockRejectedValueOnce(new Error("逾時"));

      await executeAction(
        {
          requestEvent: "test:request",
          responseEvent: "test:response",
          payload: {},
        },
        {
          errorCategory: "Repository",
          errorAction: "操作失敗",
          errorMessage: "操作失敗訊息",
        },
      );

      expect(mockShowErrorToast).toHaveBeenCalledTimes(1);
    });
  });
});
