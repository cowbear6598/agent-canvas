import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  webSocketMockFactory,
  mockWebSocketClient,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import { WebSocketRequestEvents } from "@/types/websocket/events";
import type { HeartbeatPingPayload, PodErrorPayload } from "@/types/websocket";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
const { mockToast, mockShowSuccessToast, mockShowErrorToast } = vi.hoisted(
  () => ({
    mockToast: vi.fn(),
    mockShowSuccessToast: vi.fn(),
    mockShowErrorToast: vi.fn(),
  }),
);

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

describe("chatConnectionActions", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initWebSocket", () => {
    it("設定 connectionStatus 為 connecting", () => {
      const store = useChatStore();

      store.initWebSocket();

      expect(store.connectionStatus).toBe("connecting");
    });

    it("呼叫 websocketClient.connect()", () => {
      const store = useChatStore();

      store.initWebSocket();

      expect(mockWebSocketClient.connect).toHaveBeenCalledOnce();
    });
  });

  describe("disconnectWebSocket", () => {
    it("呼叫 unregisterListeners", () => {
      const store = useChatStore();
      const unregisterSpy = vi.spyOn(store, "unregisterListeners");

      store.disconnectWebSocket();

      expect(unregisterSpy).toHaveBeenCalledOnce();
    });

    it("呼叫 websocketClient.disconnect()", () => {
      const store = useChatStore();

      store.disconnectWebSocket();

      expect(mockWebSocketClient.disconnect).toHaveBeenCalledOnce();
    });

    it("設定 connectionStatus 為 disconnected", () => {
      const store = useChatStore();
      store.connectionStatus = "connected";

      store.disconnectWebSocket();

      expect(store.connectionStatus).toBe("disconnected");
    });

    it("清除 socketId", () => {
      const store = useChatStore();
      store.socketId = "socket-123";

      store.disconnectWebSocket();

      expect(store.socketId).toBeNull();
    });

    it("停止心跳檢查", () => {
      const store = useChatStore();
      store.heartbeatCheckTimer = 12345;

      store.disconnectWebSocket();

      expect(store.heartbeatCheckTimer).toBeNull();
    });
  });

  describe("handleConnectionReady", () => {
    it("設定 connectionStatus 為 connected", async () => {
      const store = useChatStore();
      store.connectionStatus = "connecting";

      await store.handleConnectionReady({ socketId: "socket-123" });

      expect(store.connectionStatus).toBe("connected");
    });

    it("設定 socketId", async () => {
      const store = useChatStore();

      await store.handleConnectionReady({ socketId: "socket-456" });

      expect(store.socketId).toBe("socket-456");
    });

    it("啟動心跳檢查", async () => {
      vi.useFakeTimers();
      const store = useChatStore();

      await store.handleConnectionReady({ socketId: "socket-123" });

      expect(store.heartbeatCheckTimer).not.toBeNull();

      vi.useRealTimers();
    });
  });

  describe("handleHeartbeatPing", () => {
    it("更新 lastHeartbeatAt", () => {
      const store = useChatStore();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload);

      expect(store.lastHeartbeatAt).toBe(now);
    });

    it("emit heartbeat:pong 並帶上 timestamp", () => {
      const store = useChatStore();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload);

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith(
        WebSocketRequestEvents.HEARTBEAT_PONG,
        { timestamp: now },
      );
    });

    it("非 connected 狀態時恢復為 connected", () => {
      const store = useChatStore();
      store.connectionStatus = "error";

      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload);

      expect(store.connectionStatus).toBe("connected");
    });
  });

  describe("心跳超時", () => {
    it("超過 20 秒未收到心跳：呼叫 forceReconnect，不顯示 Toast", async () => {
      vi.useFakeTimers();
      const store = useChatStore();

      await store.handleConnectionReady({ socketId: "socket-123" });

      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload);

      vi.spyOn(Date, "now").mockReturnValue(now + 21000);
      vi.advanceTimersByTime(5000);

      expect(mockWebSocketClient.forceReconnect).toHaveBeenCalledOnce();
      expect(mockWebSocketClient.disconnect).not.toHaveBeenCalled();
      expect(mockWebSocketClient.startReconnect).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("handleConnectionReady 後 lastHeartbeatAt 初始化為當前時間，連線建立起即有有效偵測基準", async () => {
      vi.useFakeTimers();
      const store = useChatStore();

      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      await store.handleConnectionReady({ socketId: "socket-123" });

      // 初始值應為 Date.now()，消除死區
      expect(store.lastHeartbeatAt).toBe(now);

      // 在 HEARTBEAT_TIMEOUT_MS（20 秒）內不應觸發重連
      vi.advanceTimersByTime(19000);
      expect(mockWebSocketClient.forceReconnect).not.toHaveBeenCalled();
      expect(store.connectionStatus).toBe("connected");
      expect(mockToast).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("心跳檢查間隔為 5 秒", async () => {
      vi.useFakeTimers();
      const store = useChatStore();

      await store.handleConnectionReady({ socketId: "socket-123" });

      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload);

      vi.spyOn(Date, "now").mockReturnValue(now + 21000);
      vi.advanceTimersByTime(4900);
      expect(mockWebSocketClient.forceReconnect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(mockWebSocketClient.forceReconnect).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });
  });

  describe("handleSocketDisconnect", () => {
    it("設定 disconnectReason", () => {
      const store = useChatStore();

      store.handleSocketDisconnect({ reason: "Server shutdown" });

      expect(store.disconnectReason).toBe("未知原因");
    });

    it("設定 connectionStatus 為 disconnected", () => {
      const store = useChatStore();
      store.connectionStatus = "connected";

      store.handleSocketDisconnect({ reason: "Connection lost" });

      expect(store.connectionStatus).toBe("disconnected");
    });

    it("重置連線狀態（socketId, lastHeartbeatAt）", () => {
      const store = useChatStore();
      store.socketId = "socket-123";
      store.lastHeartbeatAt = 12345;

      store.handleSocketDisconnect({ reason: "Connection lost" });

      expect(store.socketId).toBeNull();
      expect(store.lastHeartbeatAt).toBeNull();
    });

    it("顯示斷線 Toast（已知 close code 顯示友善訊息）", () => {
      const store = useChatStore();

      store.handleSocketDisconnect({ reason: "1000" });

      expect(mockToast).toHaveBeenCalledWith({
        title: "連線中斷",
        description: "正常關閉",
      });
    });

    it("顯示斷線 Toast（未知 close code 顯示未知原因）", () => {
      const store = useChatStore();

      store.handleSocketDisconnect({ reason: "9999" });

      expect(mockToast).toHaveBeenCalledWith({
        title: "連線中斷",
        description: "未知原因",
      });
    });

    it("所有已知 close code 皆有對應友善訊息", () => {
      const knownCodes: Record<string, string> = {
        "1000": "正常關閉",
        "1001": "端點離開（頁面導航）",
        "1006": "連線異常中斷",
        "1011": "伺服器端錯誤",
        "1012": "伺服器重啟",
      };

      for (const [code, expectedMessage] of Object.entries(knownCodes)) {
        vi.clearAllMocks();
        resetChatActionsCache(); // 重置快取使每次迭代都得到新的 disconnectToastShown 旗標
        const store = useChatStore();

        store.handleSocketDisconnect({ reason: code });

        expect(mockToast).toHaveBeenCalledWith({
          title: "連線中斷",
          description: expectedMessage,
        });
      }
    });

    it("斷線時清除所有 Pod typing 狀態", () => {
      const store = useChatStore();
      store.isTypingByPodId.set("pod-1", true);
      store.isTypingByPodId.set("pod-2", true);

      store.handleSocketDisconnect({ reason: "1000" });

      expect(store.isTypingByPodId.size).toBe(0);
    });

    it("停止心跳檢查", () => {
      vi.useFakeTimers();
      const store = useChatStore();
      store.heartbeatCheckTimer = 12345;

      store.handleSocketDisconnect({ reason: "Connection lost" });

      expect(store.heartbeatCheckTimer).toBeNull();

      vi.useRealTimers();
    });

    it("silent reconnect 時重置狀態但不顯示 Toast", () => {
      const store = useChatStore();
      store.socketId = "socket-123";
      store.lastHeartbeatAt = 12345;
      store.isTypingByPodId.set("pod-1", true);

      store.handleSocketDisconnect({
        reason: "1000",
        silent: true,
        willReconnect: true,
      });

      expect(store.connectionStatus).toBe("disconnected");
      expect(store.isSilentReconnectInProgress).toBe(true);
      expect(store.disconnectReason).toBeNull();
      expect(store.socketId).toBeNull();
      expect(store.lastHeartbeatAt).toBeNull();
      expect(store.isTypingByPodId.size).toBe(0);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("重新連線成功後清掉 silent reconnect 狀態", async () => {
      const store = useChatStore();
      store.isSilentReconnectInProgress = true;
      store.disconnectReason = "正常關閉";

      await store.handleConnectionReady({ socketId: "socket-123" });

      expect(store.connectionStatus).toBe("connected");
      expect(store.isSilentReconnectInProgress).toBe(false);
      expect(store.disconnectReason).toBeNull();
    });
  });

  describe("handleError", () => {
    it("websocketClient 未連線時設定 connectionStatus 為 error", () => {
      const store = useChatStore();
      mockWebSocketClient.isConnected.value = false;
      store.connectionStatus = "connecting";

      store.handleError({ error: "Some error" } as unknown as PodErrorPayload);

      expect(store.connectionStatus).toBe("error");
    });

    it("websocketClient 已連線時不改變 connectionStatus", () => {
      const store = useChatStore();
      mockWebSocketClient.isConnected.value = true;
      store.connectionStatus = "connected";

      store.handleError({ error: "Some error" } as unknown as PodErrorPayload);

      expect(store.connectionStatus).toBe("connected");
    });

    it("有 podId 時設定該 pod 的 typing 為 false", () => {
      const store = useChatStore();
      mockWebSocketClient.isConnected.value = true;
      store.isTypingByPodId.set("pod-1", true);

      store.handleError({
        error: "Some error",
        podId: "pod-1",
      } as unknown as PodErrorPayload);

      expect(store.isTypingByPodId.get("pod-1")).toBe(false);
    });

    it("有 podId 時將錯誤寫入 transcript，不顯示 destructive toast", () => {
      const store = useChatStore();
      mockWebSocketClient.isConnected.value = true;

      store.handleError({
        error: "Authentication failed",
        podId: "pod-1",
        code: "AUTH_ERROR",
      } as PodErrorPayload);

      const messages = store.messagesByPodId.get("pod-1");
      expect(messages).toHaveLength(1);
      expect(messages?.[0]).toMatchObject({
        role: "system",
        content: "Authentication failed",
        metadata: {
          code: "AUTH_ERROR",
          severity: "error",
          rawContent: "Authentication failed",
        },
      });
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("無 podId 時不影響 typing 狀態", () => {
      const store = useChatStore();
      mockWebSocketClient.isConnected.value = true;
      store.isTypingByPodId.set("pod-1", true);

      store.handleError({ error: "Some error" } as unknown as PodErrorPayload);

      expect(store.isTypingByPodId.get("pod-1")).toBe(true);
    });

    it("podId 不存在時設定 typing 為 false", () => {
      const store = useChatStore();
      mockWebSocketClient.isConnected.value = true;

      store.handleError({
        error: "Some error",
        podId: "pod-new",
      } as unknown as PodErrorPayload);

      expect(store.isTypingByPodId.get("pod-new")).toBe(false);
    });

    it("無 podId 時仍以 toast 顯示全域錯誤", () => {
      const store = useChatStore();
      mockWebSocketClient.isConnected.value = true;

      store.handleError({
        error: "Global error",
        code: "GLOBAL_ERROR",
      } as PodErrorPayload);

      expect(mockToast).toHaveBeenCalledWith({
        title: "Global error",
        variant: "destructive",
      });
    });
  });

  describe("startHeartbeatCheck", () => {
    it("清除既有的計時器", async () => {
      vi.useFakeTimers();
      const store = useChatStore();
      const originalTimer = 99999;
      store.heartbeatCheckTimer = originalTimer;

      const connectionActions = store.getConnectionActions();
      connectionActions.startHeartbeatCheck();

      expect(store.heartbeatCheckTimer).not.toBe(originalTimer);
      expect(store.heartbeatCheckTimer).not.toBeNull();

      vi.useRealTimers();
    });

    it("設定 lastHeartbeatAt 為 Date.now()（消除偵測死區）", async () => {
      vi.useFakeTimers();
      const store = useChatStore();

      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const connectionActions = store.getConnectionActions();
      connectionActions.startHeartbeatCheck();

      // 應設為 Date.now() 而非 null，確保連線建立後立即有有效的超時偵測基準
      expect(store.lastHeartbeatAt).toBe(now);

      vi.useRealTimers();
    });

    it("建立新的計時器", async () => {
      vi.useFakeTimers();
      const store = useChatStore();

      const connectionActions = store.getConnectionActions();
      connectionActions.startHeartbeatCheck();

      expect(store.heartbeatCheckTimer).not.toBeNull();

      vi.useRealTimers();
    });
  });

  describe("stopHeartbeatCheck", () => {
    it("清除計時器並設定為 null", () => {
      vi.useFakeTimers();
      const store = useChatStore();
      store.heartbeatCheckTimer = 12345;

      const connectionActions = store.getConnectionActions();
      connectionActions.stopHeartbeatCheck();

      expect(store.heartbeatCheckTimer).toBeNull();

      vi.useRealTimers();
    });

    it("計時器為 null 時不報錯", () => {
      const store = useChatStore();
      store.heartbeatCheckTimer = null;

      const connectionActions = store.getConnectionActions();

      expect(() => connectionActions.stopHeartbeatCheck()).not.toThrow();
    });
  });
});
