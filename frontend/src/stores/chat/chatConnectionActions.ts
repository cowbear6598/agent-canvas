import { websocketClient, WebSocketRequestEvents } from "@/services/websocket";
import { useToast } from "@/composables/useToast";
import type {
  ConnectionReadyPayload,
  HeartbeatPingPayload,
  PodErrorPayload,
} from "@/types/websocket";
import { t } from "@/i18n";
import type { ChatStoreInstance } from "./chatStore";

const DISCONNECT_REASON_KEY_MAP: Record<string, string> = {
  "transport close": "composable.chat.disconnectReasons.transportClose",
  "transport error": "composable.chat.disconnectReasons.transportError",
  "ping timeout": "composable.chat.disconnectReasons.pingTimeout",
  "io server disconnect": "composable.chat.disconnectReasons.serverDisconnect",
  "io client disconnect": "composable.chat.disconnectReasons.clientDisconnect",
};

const getDisconnectMessage = (reason: string): string => {
  const key = DISCONNECT_REASON_KEY_MAP[reason];
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
  handleSocketDisconnect: (reason: string) => void;
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
        store.connectionStatus = "disconnected";

        const { toast } = useToast();
        toast({
          title: t("composable.chat.heartbeatTimeout"),
          description: t("composable.chat.heartbeatTimeoutDesc"),
        });
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

  const handleSocketDisconnect = (reason: string): void => {
    store.disconnectReason = getDisconnectMessage(reason);
    store.connectionStatus = "disconnected";
    stopHeartbeatCheck();
    resetConnectionState();

    store.isTypingByPodId.clear();

    const { toast } = useToast();
    toast({
      title: t("composable.chat.disconnected"),
      description: getDisconnectMessage(reason),
    });
  };

  const handleError = (payload: PodErrorPayload): void => {
    if (!websocketClient.isConnected.value) {
      store.connectionStatus = "error";
    }

    if (payload.podId) {
      store.setTyping(payload.podId, false);
    }
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
