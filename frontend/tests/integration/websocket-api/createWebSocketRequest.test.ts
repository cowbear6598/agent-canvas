import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import type { WebSocketRequestConfig } from "@/services/websocket/createWebSocketRequest";

vi.mock("@/services/utils", () => ({
  generateRequestId: vi.fn(() => "test-request-id"),
  generateUUID: vi.fn(() => "test-uuid"),
}));

vi.mock("@/services/websocket/WebSocketClient", () => {
  const mockIsConnected = { value: true };
  const capturedCallbacks = new Map<string, Function>();

  const mockOn = vi.fn((event: string, callback: Function) => {
    capturedCallbacks.set(event, callback);
  });

  const mockOff = vi.fn();
  const mockEmit = vi.fn();

  return {
    websocketClient: {
      isConnected: mockIsConnected,
      on: mockOn,
      off: mockOff,
      emit: mockEmit,
    },
    __capturedCallbacks: capturedCallbacks,
    __mockIsConnected: mockIsConnected,
  };
});

describe("createWebSocketRequest", () => {
  let mockModule: any;
  let capturedCallbacks: Map<string, Function>;
  let mockIsConnected: { value: boolean };
  let mockOn: any;
  let mockOff: any;
  let mockEmit: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockModule = await import("@/services/websocket/WebSocketClient");
    capturedCallbacks = (mockModule as any).__capturedCallbacks;
    mockIsConnected = (mockModule as any).__mockIsConnected;
    mockOn = mockModule.websocketClient.on;
    mockOff = mockModule.websocketClient.off;
    mockEmit = mockModule.websocketClient.emit;
    capturedCallbacks.clear();
    mockIsConnected.value = true;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("成功流程", () => {
    it("應該 emit 請求事件並在回應 requestId 匹配時 resolve", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const promise = createWebSocketRequest(config);

      expect(mockEmit).toHaveBeenCalledWith("test:request", {
        data: "test",
        requestId: "test-request-id",
      });

      expect(mockOn).toHaveBeenCalledWith(
        "test:response",
        expect.any(Function),
      );

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ requestId: "test-request-id", result: "success" });

      const result = await promise;

      expect(result).toEqual({
        requestId: "test-request-id",
        result: "success",
      });
    });

    it("應該在成功後清除 listener", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ requestId: "test-request-id", result: "success" });

      await promise;

      expect(mockOff).toHaveBeenCalledWith("test:response", responseCallback);
    });

    it("應該使用自訂 matchResponse 函數驗證", async () => {
      const matchResponse = vi.fn(
        (response: { customId: string }, requestId: string) =>
          response.customId === requestId,
      );

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { customId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
        matchResponse,
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ customId: "test-request-id", result: "success" });

      const result = await promise;

      expect(matchResponse).toHaveBeenCalledWith(
        { customId: "test-request-id", result: "success" },
        "test-request-id",
      );
      expect(result).toEqual({
        customId: "test-request-id",
        result: "success",
      });
    });
  });

  describe("失敗流程", () => {
    it("應該在回應 success: false 時 reject Error", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; success: boolean; error: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({
        requestId: "test-request-id",
        success: false,
        error: "測試錯誤訊息",
      });

      await expect(promise).rejects.toThrow("測試錯誤訊息");
    });

    it("應該在 success: false 但沒有 error 時使用預設錯誤訊息", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; success: boolean }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({
        requestId: "test-request-id",
        success: false,
      });

      await expect(promise).rejects.toThrow("未知錯誤");
    });

    it("應該在失敗後清除 listener", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; success: boolean; error: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({
        requestId: "test-request-id",
        success: false,
        error: "測試錯誤",
      });

      await expect(promise).rejects.toThrow();

      expect(mockOff).toHaveBeenCalledWith("test:response", responseCallback);
    });
  });

  describe("超時流程", () => {
    it("應該在超過 timeout 時 reject Error", async () => {
      vi.useFakeTimers();

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
        timeout: 5000,
      };

      const promise = createWebSocketRequest(config);

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow("請求逾時：test:request");

      vi.useRealTimers();
    });

    it("應該在超時後清除 listener", async () => {
      vi.useFakeTimers();

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
        timeout: 5000,
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow();

      expect(mockOff).toHaveBeenCalledWith("test:response", responseCallback);

      vi.useRealTimers();
    });

    it("應該使用預設 timeout 10000ms", async () => {
      vi.useFakeTimers();

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const promise = createWebSocketRequest(config);

      vi.advanceTimersByTime(9999);
      await Promise.resolve();

      vi.advanceTimersByTime(1);

      await expect(promise).rejects.toThrow("請求逾時：test:request");

      vi.useRealTimers();
    });

    it("應該在回應到達時清除 timeout", async () => {
      vi.useFakeTimers();

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
        timeout: 5000,
      };

      const promise = createWebSocketRequest(config);

      vi.advanceTimersByTime(2000);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ requestId: "test-request-id", result: "success" });

      const result = await promise;

      expect(result).toEqual({
        requestId: "test-request-id",
        result: "success",
      });

      vi.advanceTimersByTime(5000);

      vi.useRealTimers();
    });
  });

  describe("未連線", () => {
    it("應該在 WebSocket 未連線時立即 reject", async () => {
      mockIsConnected.value = false;

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      await expect(createWebSocketRequest(config)).rejects.toThrow(
        "WebSocket 尚未連線",
      );

      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockOn).not.toHaveBeenCalled();
    });
  });

  describe("requestId 匹配", () => {
    it("應該不匹配的 requestId 不觸發 resolve", async () => {
      vi.useFakeTimers();

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
        timeout: 5000,
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ requestId: "wrong-request-id", result: "success" });

      vi.advanceTimersByTime(100);

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow("請求逾時：test:request");

      vi.useRealTimers();
    });

    it("應該驗證 emit 的 payload 包含 requestId", () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      createWebSocketRequest(config);

      expect(mockEmit).toHaveBeenCalledWith("test:request", {
        data: "test",
        requestId: "test-request-id",
      });
    });
  });
});
