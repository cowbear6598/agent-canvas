import { websocketClient, WebSocketRequestEvents } from "@/services/websocket";
import { useToast } from "@/composables/useToast";
import type {
  ConnectionReadyPayload,
  HeartbeatPingPayload,
  PodErrorPayload,
  I18nErrorPayload,
} from "@/types/websocket";
import { t } from "@/i18n";
import type { ChatStoreInstance } from "./chatStore";
import { usePodStore } from "../pod/podStore";

const CLOSE_CODE_I18N_MAP: Record<string, string> = {
  "1000": "composable.chat.disconnectReasons.1000",
  "1001": "composable.chat.disconnectReasons.1001",
  "1006": "composable.chat.disconnectReasons.1006",
  "1011": "composable.chat.disconnectReasons.1011",
  "1012": "composable.chat.disconnectReasons.1012",
};

// 接收原生 WebSocket close code 字串，查表取得對應的 i18n 訊息
const getDisconnectMessage = (code: string): string => {
  const key = CLOSE_CODE_I18N_MAP[code];
  return key ? t(key) : t("composable.chat.disconnectReasons.unknown");
};

const HEARTBEAT_CHECK_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 20000;

export function createConnectionActions(store: ChatStoreInstance): {
  initWebSocket: () => void;
  disconnectWebSocket: () => void;
  handleConnectionReady: (payload: ConnectionReadyPayload) => Promise<void>;
  handleHeartbeatPing: (payload: HeartbeatPingPayload) => void;
  startHeartbeatCheck: () => void;
  stopHeartbeatCheck: () => void;
  handleSocketDisconnect: (code: string) => void;
  handleError: (payload: PodErrorPayload) => void;
} {
  const initWebSocket = (): void => {
    store.connectionStatus = "connecting";
    websocketClient.connect();
  };

  const disconnectWebSocket = (): void => {
    stopHeartbeatCheck();
    store.unregisterListeners();
    websocketClient.disconnect();

    store.connectionStatus = "disconnected";
    store.socketId = null;
  };

  const handleConnectionReady = async (
    payload: ConnectionReadyPayload,
  ): Promise<void> => {
    store.connectionStatus = "connected";
    store.socketId = payload.socketId;

    startHeartbeatCheck();
  };

  const handleHeartbeatPing = (_payload: HeartbeatPingPayload): void => {
    store.lastHeartbeatAt = Date.now();

    websocketClient.emit(WebSocketRequestEvents.HEARTBEAT_PONG, {
      timestamp: Date.now(),
    });

    if (store.connectionStatus !== "connected") {
      store.connectionStatus = "connected";
    }
  };

  const startHeartbeatCheck = (): void => {
    if (store.heartbeatCheckTimer !== null) {
      clearInterval(store.heartbeatCheckTimer);
    }

    store.lastHeartbeatAt = null;

    store.heartbeatCheckTimer = window.setInterval(() => {
      if (store.lastHeartbeatAt === null) {
        return;
      }

      const now = Date.now();
      const elapsed = now - store.lastHeartbeatAt;

      if (elapsed > HEARTBEAT_TIMEOUT_MS) {
        stopHeartbeatCheck();
        // 使用 forceReconnect 關閉舊連線並重連，保留 visibility listener
        websocketClient.forceReconnect();
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  };

  const stopHeartbeatCheck = (): void => {
    if (store.heartbeatCheckTimer !== null) {
      clearInterval(store.heartbeatCheckTimer);
      store.heartbeatCheckTimer = null;
    }
  };

  const resetConnectionState = (): void => {
    store.socketId = null;
    store.lastHeartbeatAt = null;
    store.allHistoryLoaded = false;
    store.historyLoadingStatus.clear();
    store.historyLoadingError.clear();
  };

  const handleSocketDisconnect = (code: string): void => {
    store.disconnectReason = getDisconnectMessage(code);
    store.connectionStatus = "disconnected";
    stopHeartbeatCheck();
    resetConnectionState();

    store.isTypingByPodId.clear();

    const { toast } = useToast();
    toast({
      title: t("composable.chat.disconnected"),
      description: getDisconnectMessage(code),
    });
  };

  /**
   * 將後端 error 欄位（純字串或 i18nError 物件）轉為使用者可讀的翻譯訊息
   */
  const resolveErrorMessage = (error: string | I18nErrorPayload): string => {
    if (typeof error === "string") {
      return error;
    }
    // I18nErrorPayload：用 key 查找翻譯，帶入插值參數
    return t(error.key, error.params ?? {});
  };

  const appendErrorToTranscript = (
    podId: string,
    content: string,
    provider: string,
    code?: string,
  ): void => {
    store.handleChatMessage({
      podId,
      messageId: crypto.randomUUID(),
      content,
      isPartial: false,
      role: "system",
      metadata: {
        provider,
        code: code ?? null,
        severity: "error",
        rawContent: content,
      },
    });
  };

  const handleError = (payload: PodErrorPayload): void => {
    if (!websocketClient.isConnected.value) {
      store.connectionStatus = "error";
    }

    const resolvedMessage = resolveErrorMessage(payload.error);

    if (payload.podId) {
      store.setTyping(payload.podId, false);
      // 後端回傳錯誤時，pod 可能已被樂觀更新為 chatting，需回滾為 idle
      const podStore = usePodStore();
      podStore.updatePodStatus(payload.podId, "idle");
      // 從 podStore 取得 provider，未知來源時 fallback 為 "unknown"
      const pod = podStore.pods.find((p) => p.id === payload.podId);
      const provider = pod?.provider ?? "unknown";
      appendErrorToTranscript(
        payload.podId,
        resolvedMessage,
        provider,
        payload.code,
      );
      return;
    }

    // 只有沒有 transcript destination 的全域錯誤才保留 toast。
    const { toast } = useToast();
    toast({
      title: resolvedMessage,
      variant: "destructive",
    });
  };

  return {
    initWebSocket,
    disconnectWebSocket,
    handleConnectionReady,
    handleHeartbeatPing,
    startHeartbeatCheck,
    stopHeartbeatCheck,
    handleSocketDisconnect,
    handleError,
  };
}
