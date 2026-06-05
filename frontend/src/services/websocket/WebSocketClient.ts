import { ref } from "vue";
import type { WebSocketMessage } from "@/types/websocket";
import { logger } from "@/utils/logger";
import { safeJsonParse } from "@shared/safeJsonParse";
import { t } from "@/i18n";
import { parseDevBackendPort } from "@/lib/devBackendPort";

type EventCallback<T> = (payload: T) => void;

const RECONNECT_INTERVAL_MS = 3000;
const RECONNECT_GRANT_TIMEOUT_MS = 10000;

type EventHandler = (payload: unknown) => void;

type WebSocketEmitResult =
  | { ok: true }
  | { ok: false; error: Error };

export interface WebSocketDisconnectEvent {
  reason: string;
  silent?: boolean;
  willReconnect?: boolean;
}

interface CleanupSocketOptions {
  disconnectEvent?: WebSocketDisconnectEvent;
}

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
  private disconnectListeners: Set<(event: WebSocketDisconnectEvent) => void> =
    new Set();
  private visibilityChangeHandler: (() => void) | null = null;
  private visibilityListenerRegistered = false;

  public readonly isConnected = ref(false);
  public readonly disconnectReason = ref<string | null>(null);

  private resolveSocketBaseUrl(explicitUrl?: string): string {
    if (explicitUrl) {
      return explicitUrl;
    }

    if (this.wsUrl) {
      return this.wsUrl;
    }

    if (import.meta.env.VITE_WS_URL) {
      return import.meta.env.VITE_WS_URL;
    }

    return this.resolveDefaultWebSocketUrl();
  }

  connect(url?: string): void {
    this.setupVisibilityChangeListener();

    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.wsUrl = this.resolveSocketBaseUrl(url);

    this.socket = new WebSocket(this.createSocketUrl());
    this.setupSocketHandlers(this.socket);
  }

  // dev 模式（port 5173）連到後端 VITE_BACKEND_DEV_PORT；prod 模式（前後端同 port）直接用當前 origin
  private resolveDefaultWebSocketUrl(): string {
    const VITE_DEFAULT_DEV_PORT = "5173";
    const backendDevPort = parseDevBackendPort(
      import.meta.env.VITE_BACKEND_DEV_PORT,
    );

    const isDev = window.location.port === VITE_DEFAULT_DEV_PORT;
    return isDev
      ? `http://${window.location.hostname}:${backendDevPort}`
      : window.location.origin;
  }

  disconnect(): void {
    this.teardownVisibilityChangeListener();
    this.stopReconnect();
    this.cleanupSocket();
    this.wsUrl = "";
  }

  // 強制重連：關閉舊 socket 並啟動重連，但不拆除 visibility listener
  forceReconnect(): void {
    this.cleanupSocket({
      disconnectEvent: {
        reason: "1000",
        silent: true,
        willReconnect: true,
      },
    });
    this.startReconnect();
  }

  async forceReconnectWithGrant(grant: string): Promise<void> {
    await this.redeemGrantAndReconnect(grant);
  }

  private async redeemGrantAndReconnect(grant: string): Promise<void> {
    const apiBase = this.wsUrl ?? this.resolveDefaultWebSocketUrl();
    const redeemUrl =
      apiBase.replace(/^ws/, "http") + "/api/auth/redeem-reconnect-grant";
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(
      () => abortController.abort(),
      RECONNECT_GRANT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(redeemUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ grant }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(t("websocket.reconnectGrantRedeemFailed"));
      }
    } catch (error) {
      logger.error("[WebSocket] grant 換發失敗:", error);
      throw error instanceof Error
        ? error
        : new Error(t("websocket.reconnectGrantRedeemFailed"));
    } finally {
      window.clearTimeout(timeoutId);
    }

    this.forceReconnect();
  }

  private notifyDisconnect(event: WebSocketDisconnectEvent): void {
    this.disconnectReason.value = event.reason;
    this.disconnectListeners.forEach((callback) => {
      callback(event);
    });
  }

  private cleanupSocket(options?: CleanupSocketOptions): void {
    if (!this.socket) {
      return;
    }

    if (options?.disconnectEvent && this.isConnected.value) {
      this.notifyDisconnect(options.disconnectEvent);
    }

    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;
    this.socket.onmessage = null;

    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }

    this.socket = null;
    this.isConnected.value = false;
  }

  private setupVisibilityChangeListener(): void {
    if (this.visibilityListenerRegistered) {
      return;
    }

    const handler = (): void => {
      if (document.visibilityState !== "visible") {
        return;
      }

      // 頁面回到前景時主動強制重連，不信任 readyState。
      // 原因：NAT idle timeout 可能造成 TCP 靜默斷線，readyState 仍顯示 OPEN，
      // 若僅依賴 readyState 判斷會導致 UI 卡死，必須強制重建連線。
      logger.log("[WebSocket] 頁面重新顯示，主動強制重連...");
      this.forceReconnect();
    };

    document.addEventListener("visibilitychange", handler);
    this.visibilityChangeHandler = handler;
    this.visibilityListenerRegistered = true;
  }

  private teardownVisibilityChangeListener(): void {
    if (this.visibilityChangeHandler !== null) {
      document.removeEventListener(
        "visibilitychange",
        this.visibilityChangeHandler,
      );
      this.visibilityChangeHandler = null;
    }
    this.visibilityListenerRegistered = false;
  }

  startReconnect(): void {
    this.stopReconnect();

    // 立即嘗試第一次重連，不等 interval
    logger.log("[WebSocket] 嘗試重新連線...");
    this.reconnectOnce();

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
    this.wsUrl = this.resolveSocketBaseUrl();
    this.socket = new WebSocket(this.createSocketUrl());
    this.setupSocketHandlers(this.socket);
  }

  private createSocketUrl(): string {
    const wsProtocol = this.resolveSocketBaseUrl().replace(/^http/, "ws");
    const url = new URL(wsProtocol);

    const pathname = url.pathname === "/" ? "" : url.pathname;
    const search = url.searchParams.toString();

    return `${url.protocol}//${url.host}${pathname}${search ? `?${search}` : ""}`;
  }

  private handleOpen(): void {
    logger.log("[WebSocket] 連線成功");
    this.stopReconnect();
    this.disconnectReason.value = null;
    this.isConnected.value = true;
  }

  private handleClose(event: CloseEvent): void {
    logger.log("[WebSocket] 連線關閉:", event.code, event.reason);
    const disconnectEvent: WebSocketDisconnectEvent = {
      reason: String(event.code),
      willReconnect: true,
    };

    this.isConnected.value = false;
    this.notifyDisconnect(disconnectEvent);

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

  emit<T>(event: string, payload: T): WebSocketEmitResult {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      const error = new Error(t("websocket.notConnected"));
      logger.error("[WebSocket] 無法發送訊息，未連線:", event);
      return { ok: false, error };
    }

    const payloadWithRequestId = payload as T & { requestId?: string };
    const message: WebSocketMessage<T> = {
      type: event,
      payload,
      requestId: payloadWithRequestId.requestId,
    };

    try {
      this.socket.send(JSON.stringify(message));
      return { ok: true };
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(t("websocket.sendFailed"));
      logger.error("[WebSocket] 發送訊息失敗:", event, normalizedError);
      return { ok: false, error: normalizedError };
    }
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

  onDisconnect(callback: (event: WebSocketDisconnectEvent) => void): void {
    this.disconnectListeners.add(callback);
  }

  offDisconnect(callback: (event: WebSocketDisconnectEvent) => void): void {
    this.disconnectListeners.delete(callback);
  }
}

export const websocketClient = new WebSocketClient();
