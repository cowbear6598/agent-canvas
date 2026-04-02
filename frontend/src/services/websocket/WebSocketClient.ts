import { ref } from "vue";
import type { WebSocketMessage } from "@/types/websocket";
import { logger } from "@/utils/logger";
import { safeJsonParse } from "@/utils/safeJsonParse";

type EventCallback<T> = (payload: T) => void;

const RECONNECT_INTERVAL_MS = 3000;

type EventHandler = (payload: unknown) => void;

// EventCallback<T> 與 EventHandler 在 runtime 完全相同（都是接收單一參數的函式）。
// 泛型 T 只在編譯期存在，不影響實際函式簽名，因此此轉換在 runtime 是安全的。
function castToEventHandler<T>(callback: EventCallback<T>): EventHandler {
  return callback as unknown as EventHandler;
}

class WebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private wsUrl: string = "";
  private eventListeners: Map<string, Set<EventHandler>> = new Map();
  private disconnectListeners: Set<(reason: string) => void> = new Set();

  public readonly isConnected = ref(false);
  public readonly disconnectReason = ref<string | null>(null);

  connect(url?: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.wsUrl =
      url ?? import.meta.env.VITE_WS_URL ?? this.resolveDefaultWebSocketUrl();

    const wsProtocol = this.wsUrl.replace(/^http/, "ws");

    this.socket = new WebSocket(wsProtocol);
    this.setupSocketHandlers(this.socket);
  }

  // dev 模式（port 5173）連到後端 port 3001；prod 模式（前後端同 port）直接用當前 origin
  private resolveDefaultWebSocketUrl(): string {
    const VITE_DEFAULT_DEV_PORT = "5173";
    const BACKEND_DEV_PORT = 3001;

    const isDev = window.location.port === VITE_DEFAULT_DEV_PORT;
    return isDev
      ? `http://${window.location.hostname}:${BACKEND_DEV_PORT}`
      : window.location.origin;
  }

  disconnect(): void {
    this.stopReconnect();
    this.cleanupSocket();
  }

  private cleanupSocket(): void {
    if (!this.socket) {
      return;
    }

    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;
    this.socket.onmessage = null;

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }

    this.socket = null;
    this.isConnected.value = false;
  }

  private startReconnect(): void {
    this.stopReconnect();

    this.reconnectTimer = setInterval(() => {
      logger.log("[WebSocket] 嘗試重新連線...");
      this.reconnectOnce();
    }, RECONNECT_INTERVAL_MS);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setupSocketHandlers(socket: WebSocket): void {
    socket.onopen = this.handleOpen.bind(this);
    socket.onclose = this.handleClose.bind(this);
    socket.onerror = this.handleError.bind(this);
    socket.onmessage = this.handleMessage.bind(this);
  }

  private reconnectOnce(): void {
    this.cleanupSocket();

    const wsProtocol = this.wsUrl.replace(/^http/, "ws");
    this.socket = new WebSocket(wsProtocol);
    this.setupSocketHandlers(this.socket);
  }

  private handleOpen(): void {
    logger.log("[WebSocket] 連線成功");
    this.stopReconnect();
    this.disconnectReason.value = null;
    this.isConnected.value = true;
  }

  private handleClose(event: CloseEvent): void {
    logger.log("[WebSocket] 連線關閉:", event.code, event.reason);
    this.isConnected.value = false;
    this.disconnectReason.value = event.reason || `code ${event.code}`;

    this.disconnectListeners.forEach((callback) => {
      callback(this.disconnectReason.value ?? "");
    });

    this.startReconnect();
  }

  private handleError(event: Event): void {
    logger.error("[WebSocket] 連線錯誤:", event);
  }

  private invokeListener(
    callback: EventHandler,
    message: WebSocketMessage,
  ): void {
    (callback as EventCallback<unknown>)(message.payload);
  }

  private dispatchToListeners(message: WebSocketMessage): void {
    const listeners = this.eventListeners.get(message.type);
    if (!listeners) return;

    listeners.forEach((callback) => {
      this.invokeListener(callback, message);
    });
  }

  private handleMessage(event: MessageEvent): void {
    const message = safeJsonParse<WebSocketMessage>(event.data);
    if (!message) {
      logger.error("[WebSocket] 訊息解析錯誤，資料格式無效");
      return;
    }

    this.dispatchToListeners(message);
  }

  emit<T>(event: string, payload: T): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      logger.error("[WebSocket] 無法發送訊息，未連線:", event);
      return;
    }

    const payloadWithRequestId = payload as T & { requestId?: string };
    const message: WebSocketMessage<T> = {
      type: event,
      payload,
      requestId: payloadWithRequestId.requestId,
    };

    this.socket.send(JSON.stringify(message));
  }

  private registerEventListener<T>(
    event: string,
    callback: EventCallback<T>,
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(castToEventHandler(callback));
  }

  private unregisterEventListener<T>(
    event: string,
    callback: EventCallback<T>,
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(castToEventHandler(callback));
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  on<T>(event: string, callback: EventCallback<T>): void {
    this.registerEventListener(event, callback);
  }

  off<T>(event: string, callback: EventCallback<T>): void {
    this.unregisterEventListener(event, callback);
  }

  offAll(event: string): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
    listeners.clear();
    this.eventListeners.delete(event);
  }

  onDisconnect(callback: (reason: string) => void): void {
    this.disconnectListeners.add(callback);
  }

  offDisconnect(callback: (reason: string) => void): void {
    this.disconnectListeners.delete(callback);
  }
}

export const websocketClient = new WebSocketClient();
