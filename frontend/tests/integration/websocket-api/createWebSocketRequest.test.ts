import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import type { WebSocketRequestConfig } from "@/services/websocket/createWebSocketRequest";
import { generateRequestId } from "@/services/utils";

vi.mock("@/services/utils", () => ({
  generateRequestId: vi.fn(() => "test-request-id"),
  generateUUID: vi.fn(() => "test-uuid"),
}));

vi.mock("@/services/websocket/WebSocketClient", () => {
  const mockIsConnected = { value: true };
  const capturedCallbacks = new Map<string, Function>();
  const disconnectCallbacks = new Set<Function>();

  const mockOn = vi.fn((event: string, callback: Function) => {
    capturedCallbacks.set(event, callback);
  });

  const mockOff = vi.fn();
  const mockEmit = vi.fn(() => ({ ok: true }));
  const mockOnDisconnect = vi.fn((callback: Function) => {
    disconnectCallbacks.add(callback);
  });
  const mockOffDisconnect = vi.fn((callback: Function) => {
    disconnectCallbacks.delete(callback);
  });

  return {
    websocketClient: {
      isConnected: mockIsConnected,
      on: mockOn,
      off: mockOff,
      emit: mockEmit,
      onDisconnect: mockOnDisconnect,
      offDisconnect: mockOffDisconnect,
    },
    __capturedCallbacks: capturedCallbacks,
    __disconnectCallbacks: disconnectCallbacks,
    __mockIsConnected: mockIsConnected,
  };
});

const CUSTOM_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const BEFORE_DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS - 1;
const RESPONSE_DELAY_MS = 2_000;
const MISMATCHED_RESPONSE_DELAY_MS = 100;

describe("createWebSocketRequest", () => {
  let mockModule: any;
  let capturedCallbacks: Map<string, Function>;
  let mockIsConnected: { value: boolean };
  let mockOn: any;
  let mockOff: any;
  let mockEmit: any;
  let disconnectCallbacks: Set<Function>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockModule = await import("@/services/websocket/WebSocketClient");
    capturedCallbacks = (mockModule as any).__capturedCallbacks;
    mockIsConnected = (mockModule as any).__mockIsConnected;
    mockOn = mockModule.websocketClient.on;
    mockOff = mockModule.websocketClient.off;
    mockEmit = mockModule.websocketClient.emit;
    disconnectCallbacks = (mockModule as any).__disconnectCallbacks;
    capturedCallbacks.clear();
    mockIsConnected.value = true;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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

    it("相同 responseEvent 的並行 request 應共用 listener", async () => {
      vi.mocked(generateRequestId)
        .mockReturnValueOnce("request-1")
        .mockReturnValueOnce("request-2");

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const firstPromise = createWebSocketRequest(config);
      const secondPromise = createWebSocketRequest(config);

      expect(mockOn).toHaveBeenCalledTimes(1);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ requestId: "request-1", result: "first" });

      await expect(firstPromise).resolves.toEqual({
        requestId: "request-1",
        result: "first",
      });
      expect(mockOff).not.toHaveBeenCalled();

      responseCallback?.({ requestId: "request-2", result: "second" });

      await expect(secondPromise).resolves.toEqual({
        requestId: "request-2",
        result: "second",
      });
      expect(mockOff).toHaveBeenCalledWith("test:response", responseCallback);
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

      await expect(promise).rejects.toThrow("未知錯誤");
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

    it("應該讓 alias_model_duplicate 使用後端原文錯誤訊息", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        {
          requestId: string;
          success: boolean;
          error: { code: string; message: string };
        }
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
        error: {
          code: "alias_model_duplicate",
          message: "此 model 已有 alias",
        },
      });

      await expect(promise).rejects.toThrow("此 model 已有 alias");
    });

    it("應該允許 OpenCode model 不存在錯誤顯示後端訊息", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        {
          requestId: string;
          success: boolean;
          error: { code: string; message: string };
        }
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
        error: {
          code: "opencode_model_not_found",
          message: "找不到指定的 OpenCode model",
        },
      });

      await expect(promise).rejects.toThrow(
        "找不到指定的 OpenCode model",
      );
    });

    it("非白名單 error code 不應直接顯示後端 message", async () => {
      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        {
          requestId: string;
          success: boolean;
          error: { code: string; message: string };
        }
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
        error: {
          code: "unknown_backend_error",
          message: "內部堆疊與敏感資訊",
        },
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
        error: { code: "alias_duplicate", message: "alias 已存在" },
      });

      await expect(promise).rejects.toThrow();

      expect(mockOff).toHaveBeenCalledWith("test:response", responseCallback);
    });

    it("emit 失敗時應立即 reject 並清除 pending request", async () => {
      mockEmit.mockReturnValueOnce({
        ok: false,
        error: new Error("送出失敗"),
      });

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

      await expect(promise).rejects.toThrow("送出失敗");
      expect(mockOff).toHaveBeenCalledWith("test:response", responseCallback);
    });

    it("disconnect 時應批次 reject 所有 pending requests", async () => {
      vi.mocked(generateRequestId)
        .mockReturnValueOnce("request-1")
        .mockReturnValueOnce("request-2");

      const config: WebSocketRequestConfig<
        { requestId: string; data: string },
        { requestId: string; result: string }
      > = {
        requestEvent: "test:request",
        responseEvent: "test:response",
        payload: { data: "test" },
      };

      const firstPromise = createWebSocketRequest(config);
      const secondPromise = createWebSocketRequest(config);
      const responseCallback = capturedCallbacks.get("test:response");

      disconnectCallbacks.forEach((callback) => callback({ reason: "1006" }));

      await expect(firstPromise).rejects.toThrow("WebSocket 尚未連線");
      await expect(secondPromise).rejects.toThrow("WebSocket 尚未連線");
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
        timeout: CUSTOM_TIMEOUT_MS,
      };

      const promise = createWebSocketRequest(config);

      vi.advanceTimersByTime(CUSTOM_TIMEOUT_MS);

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
        timeout: CUSTOM_TIMEOUT_MS,
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");

      vi.advanceTimersByTime(CUSTOM_TIMEOUT_MS);

      await expect(promise).rejects.toThrow();

      expect(mockOff).toHaveBeenCalledWith("test:response", responseCallback);

      vi.useRealTimers();
    });

    it("應該使用預設 timeout", async () => {
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

      vi.advanceTimersByTime(BEFORE_DEFAULT_TIMEOUT_MS);
      await Promise.resolve();

      vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS - BEFORE_DEFAULT_TIMEOUT_MS);

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
        timeout: CUSTOM_TIMEOUT_MS,
      };

      const promise = createWebSocketRequest(config);

      vi.advanceTimersByTime(RESPONSE_DELAY_MS);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ requestId: "test-request-id", result: "success" });

      const result = await promise;

      expect(result).toEqual({
        requestId: "test-request-id",
        result: "success",
      });

      vi.advanceTimersByTime(CUSTOM_TIMEOUT_MS);

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
        timeout: CUSTOM_TIMEOUT_MS,
      };

      const promise = createWebSocketRequest(config);

      const responseCallback = capturedCallbacks.get("test:response");
      responseCallback?.({ requestId: "wrong-request-id", result: "success" });

      vi.advanceTimersByTime(MISMATCHED_RESPONSE_DELAY_MS);

      vi.advanceTimersByTime(CUSTOM_TIMEOUT_MS);

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
