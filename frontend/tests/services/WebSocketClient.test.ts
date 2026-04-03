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
      // startReconnect 會立即呼叫一次 reconnectOnce()，所以 disconnect 前已多建立 1 個實例
      expect(mockWebSocketInstances.length).toBe(initialCount + 1);

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

  describe("visibilitychange", () => {
    it("Tab 回來且 socket 已斷線，應觸發重連", () => {
      websocketClient.connect("http://localhost:3001");
      const firstInstance = mockWebSocketInstances[0]!;
      firstInstance.triggerOpen();

      // 模擬 socket 進入 CLOSED 狀態
      firstInstance.readyState = MockWebSocket.CLOSED;

      const countBefore = mockWebSocketInstances.length;

      // 模擬頁面重新顯示
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // 應建立新的 WebSocket 實例（重連被觸發）
      expect(mockWebSocketInstances.length).toBeGreaterThan(countBefore);
    });

    it("Tab 回來但 socket 仍正常連線，不應觸發重連", () => {
      websocketClient.connect("http://localhost:3001");
      const firstInstance = mockWebSocketInstances[0]!;
      firstInstance.triggerOpen();

      // 確保 readyState 為 OPEN
      expect(firstInstance.readyState).toBe(MockWebSocket.OPEN);

      const countBefore = mockWebSocketInstances.length;

      // 模擬頁面重新顯示
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // 不應建立新的 WebSocket 實例
      expect(mockWebSocketInstances.length).toBe(countBefore);
    });

    it("disconnect() 後 visibility listener 應被移除，不再觸發重連", () => {
      websocketClient.connect("http://localhost:3001");
      const firstInstance = mockWebSocketInstances[0]!;
      firstInstance.triggerOpen();

      websocketClient.disconnect();

      const countBefore = mockWebSocketInstances.length;

      // 模擬 socket 狀態為斷線後觸發 visibilitychange
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // listener 已被移除，不應建立新實例
      expect(mockWebSocketInstances.length).toBe(countBefore);
    });

    it("connect() 多次呼叫，visibilitychange 觸發重連只執行一次", () => {
      vi.useFakeTimers();

      // 多次呼叫 connect()
      websocketClient.connect("http://localhost:3001");
      mockWebSocketInstances[0]!.triggerOpen();
      websocketClient.connect("http://localhost:3001");
      websocketClient.connect("http://localhost:3001");

      // 模擬 socket 進入 CLOSED 狀態
      const lastInstance =
        mockWebSocketInstances[mockWebSocketInstances.length - 1]!;
      lastInstance.readyState = MockWebSocket.CLOSED;

      const countBefore = mockWebSocketInstances.length;

      // 模擬頁面重新顯示
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // startReconnect 立即呼叫一次 reconnectOnce()，應只新增 1 個實例
      expect(mockWebSocketInstances.length).toBe(countBefore + 1);

      vi.useRealTimers();
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

      expect(disconnectCallback).toHaveBeenCalledWith("1006");
      expect(websocketClient.disconnectReason.value).toBe("1006");
    });

    it("應該在斷線時啟動重連機制", () => {
      vi.useFakeTimers();
      websocketClient.connect("http://localhost:3001");
      const instance = mockWebSocketInstances[0]!;
      instance.triggerOpen();

      const initialCount = mockWebSocketInstances.length;

      instance.triggerClose(1006, "異常關閉");

      vi.advanceTimersByTime(3000);

      // startReconnect 立即呼叫一次（+1），3000ms 後 interval 再呼叫一次（+1），共 +2
      expect(mockWebSocketInstances.length).toBe(initialCount + 2);

      vi.useRealTimers();
    });

    it("應該在重連成功時停止重連計時器", () => {
      vi.useFakeTimers();
      websocketClient.connect("http://localhost:3001");
      const firstInstance = mockWebSocketInstances[0]!;
      firstInstance.triggerOpen();

      firstInstance.triggerClose(1006, "異常關閉");

      // startReconnect 立即建立 instances[1]，3000ms 後 interval 建立 instances[2]
      vi.advanceTimersByTime(3000);

      // 觸發最新一次重連實例的 open 事件，讓 stopReconnect 被呼叫
      const lastInstance =
        mockWebSocketInstances[mockWebSocketInstances.length - 1]!;
      lastInstance.triggerOpen();

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

      expect(websocketClient.disconnectReason.value).toBe("1006");
    });
  });
});
