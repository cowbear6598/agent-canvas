import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { websocketClient } from "@/services/websocket/WebSocketClient";
import type { WebSocketMessage } from "@/types/websocket";

let mockWebSocketInstances: MockWebSocket[] = [];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  url: string;

  constructor(url: string) {
    this.url = url;
    mockWebSocketInstances.push(this);
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  triggerClose(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      const event = new CloseEvent("close", { code, reason });
      this.onclose(event);
    }
  }

  triggerError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  triggerMessage(data: string): void {
    if (this.onmessage) {
      const event = new MessageEvent("message", { data });
      this.onmessage(event);
    }
  }
}

describe("WebSocketClient", () => {
  beforeEach(() => {
    mockWebSocketInstances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    websocketClient.disconnect();
  });

  afterEach(() => {
    websocketClient.disconnect();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
  });

  describe("connect", () => {
    it("應該建立 WebSocket 實例", () => {
      websocketClient.connect("http://localhost:3001");

      expect(mockWebSocketInstances.length).toBe(1);
      expect(mockWebSocketInstances[0]!.url).toBe("ws://localhost:3001");
    });

    it("應該在 dev 模式下使用 port 3001", () => {
      vi.stubGlobal("window", {
        ...window,
        location: {
          ...window.location,
          port: "5173",
          hostname: "localhost",
        },
      });

      websocketClient.connect();

      expect(mockWebSocketInstances[0]!.url).toContain("ws://");
      expect(mockWebSocketInstances[0]!.url).toContain("localhost:3001");

      vi.unstubAllGlobals();
      vi.stubGlobal("WebSocket", MockWebSocket);
    });

    it("應該不重複連線已連線的 socket", () => {
      websocketClient.connect("http://localhost:3001");
      mockWebSocketInstances[0]!.triggerOpen();

      websocketClient.connect("http://localhost:3001");

      expect(mockWebSocketInstances.length).toBe(1);
    });

    it("應該設定 socket 事件處理器", () => {
      websocketClient.connect("http://localhost:3001");

      const instance = mockWebSocketInstances[0]!;
      expect(instance.onopen).not.toBeNull();
      expect(instance.onclose).not.toBeNull();
      expect(instance.onerror).not.toBeNull();
      expect(instance.onmessage).not.toBeNull();
    });

    it("應該在連線成功時設定 isConnected 為 true", () => {
      websocketClient.connect("http://localhost:3001");

      expect(websocketClient.isConnected.value).toBe(false);

      mockWebSocketInstances[0]!.triggerOpen();

      expect(websocketClient.isConnected.value).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("應該清理 socket", () => {
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      websocketClient.disconnect();

      expect(instance.close).toHaveBeenCalled();
      expect(instance.onopen).toBeNull();
      expect(instance.onclose).toBeNull();
      expect(instance.onerror).toBeNull();
      expect(instance.onmessage).toBeNull();
    });

    it("應該設定 isConnected 為 false", () => {
      websocketClient.connect("http://localhost:3001");
      mockWebSocketInstances[0]!.triggerOpen();
      expect(websocketClient.isConnected.value).toBe(true);

      websocketClient.disconnect();

      expect(websocketClient.isConnected.value).toBe(false);
    });

    it("應該停止重連計時器", () => {
      vi.useFakeTimers();
      websocketClient.connect("http://localhost:3001");
      const initialCount = mockWebSocketInstances.length;
      mockWebSocketInstances[0]!.triggerClose(1006, "異常關閉");

      websocketClient.disconnect();

      vi.advanceTimersByTime(10000);
      expect(mockWebSocketInstances.length).toBe(initialCount);

      vi.useRealTimers();
    });
  });

  describe("emit", () => {
    it("應該在未連線時不發送訊息", () => {
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.readyState = MockWebSocket.CONNECTING;

      websocketClient.emit("testEvent", { data: "test" });

      expect(instance.send).not.toHaveBeenCalled();
    });

    it("應該在已連線時透過 send 發送 JSON", () => {
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      websocketClient.emit("testEvent", { data: "test" });

      expect(instance.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "testEvent",
          payload: { data: "test" },
          requestId: undefined,
        }),
      );
    });

    it("應該包含 type, payload 和 requestId", () => {
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      websocketClient.emit("testEvent", { data: "test", requestId: "req-123" });

      const sentMessage = JSON.parse(instance.send.mock.calls[0]![0] as string);
      expect(sentMessage).toEqual({
        type: "testEvent",
        payload: { data: "test", requestId: "req-123" },
        requestId: "req-123",
      });
    });
  });

  describe("on / off", () => {
    it("應該註冊監聽器", () => {
      const callback = vi.fn();

      websocketClient.on("testEvent", callback);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const message: WebSocketMessage = {
        type: "testEvent",
        payload: { data: "test" },
      };
      instance.triggerMessage(JSON.stringify(message));

      expect(callback).toHaveBeenCalledWith({ data: "test" });
    });

    it("應該取消監聽器", () => {
      const callback = vi.fn();

      websocketClient.on("testEvent", callback);
      websocketClient.off("testEvent", callback);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const message: WebSocketMessage = {
        type: "testEvent",
        payload: { data: "test" },
      };
      instance.triggerMessage(JSON.stringify(message));

      expect(callback).not.toHaveBeenCalled();
    });

    it("應該收到訊息時觸發對應 listener", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      websocketClient.on("event1", callback1);
      websocketClient.on("event2", callback2);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const message: WebSocketMessage = {
        type: "event1",
        payload: { data: "test" },
      };
      instance.triggerMessage(JSON.stringify(message));

      expect(callback1).toHaveBeenCalledWith({ data: "test" });
      expect(callback2).not.toHaveBeenCalled();
    });

    it("應該支援多個監聽器註冊到同一事件", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      websocketClient.on("testEvent", callback1);
      websocketClient.on("testEvent", callback2);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const message: WebSocketMessage = {
        type: "testEvent",
        payload: { data: "test" },
      };
      instance.triggerMessage(JSON.stringify(message));

      expect(callback1).toHaveBeenCalledWith({ data: "test" });
      expect(callback2).toHaveBeenCalledWith({ data: "test" });
    });
  });

  describe("offAll", () => {
    it("offAll 應清空指定事件的所有 listener", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      websocketClient.on("testEvent", callback1);
      websocketClient.on("testEvent", callback2);
      websocketClient.offAll("testEvent");
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const message: WebSocketMessage = {
        type: "testEvent",
        payload: { data: "test" },
      };
      instance.triggerMessage(JSON.stringify(message));

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("offAll 後觸發該事件不應呼叫任何 callback", () => {
      const callback = vi.fn();

      websocketClient.on("myEvent", callback);
      websocketClient.offAll("myEvent");
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const message: WebSocketMessage = {
        type: "myEvent",
        payload: {},
      };
      instance.triggerMessage(JSON.stringify(message));

      expect(callback).toHaveBeenCalledTimes(0);
    });

    it("offAll 不影響其他事件的 listener", () => {
      const callbackA = vi.fn();
      const callbackB = vi.fn();

      websocketClient.on("eventA", callbackA);
      websocketClient.on("eventB", callbackB);
      websocketClient.offAll("eventA");
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const messageB: WebSocketMessage = {
        type: "eventB",
        payload: { data: "hello" },
      };
      instance.triggerMessage(JSON.stringify(messageB));

      expect(callbackA).not.toHaveBeenCalled();
      expect(callbackB).toHaveBeenCalledWith({ data: "hello" });
    });
  });

  describe("handleMessage", () => {
    it("應該分發正常訊息到對應監聽器", () => {
      const callback = vi.fn();
      websocketClient.on("normalEvent", callback);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const message: WebSocketMessage = {
        type: "normalEvent",
        payload: { data: "test" },
      };
      instance.triggerMessage(JSON.stringify(message));

      expect(callback).toHaveBeenCalledWith({ data: "test" });
    });

    it("應該在 JSON 解析錯誤時不崩潰", () => {
      const callback = vi.fn();
      websocketClient.on("testEvent", callback);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      expect(() => {
        instance.triggerMessage("invalid json");
      }).not.toThrow();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("斷線重連", () => {
    it("應該在 handleClose 時觸發 disconnect listener", () => {
      const disconnectCallback = vi.fn();

      websocketClient.onDisconnect(disconnectCallback);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      instance.triggerClose(1006, "異常關閉");

      expect(disconnectCallback).toHaveBeenCalledWith("異常關閉");
      expect(websocketClient.disconnectReason.value).toBe("異常關閉");
    });

    it("應該在斷線時啟動重連機制", () => {
      vi.useFakeTimers();
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const initialCount = mockWebSocketInstances.length;

      instance.triggerClose(1006, "異常關閉");

      vi.advanceTimersByTime(3000);

      expect(mockWebSocketInstances.length).toBe(initialCount + 1);

      vi.useRealTimers();
    });

    it("應該在重連成功時停止重連計時器", () => {
      vi.useFakeTimers();
      websocketClient.connect("http://localhost:3001");
      const firstInstance = mockWebSocketInstances[0]!;
      firstInstance.triggerOpen();

      firstInstance.triggerClose(1006, "異常關閉");

      vi.advanceTimersByTime(3000);

      mockWebSocketInstances[1]!.triggerOpen();

      const countAfterReconnect = mockWebSocketInstances.length;
      vi.advanceTimersByTime(10000);

      expect(mockWebSocketInstances.length).toBe(countAfterReconnect);

      vi.useRealTimers();
    });

    it("應該在 disconnect 時移除 disconnect listener", () => {
      const disconnectCallback = vi.fn();

      websocketClient.onDisconnect(disconnectCallback);
      websocketClient.offDisconnect(disconnectCallback);
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      instance.triggerClose(1006, "異常關閉");

      expect(disconnectCallback).not.toHaveBeenCalled();
    });

    it("應該在 handleClose 沒有 reason 時使用 code", () => {
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      instance.triggerClose(1006, "");

      expect(websocketClient.disconnectReason.value).toBe("code 1006");
    });
  });
});
