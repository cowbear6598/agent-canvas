import type { WebSocketMessage, WebSocketResponse } from '../../src/types/websocket.js';
import { serialize, deserialize } from '../../src/utils/messageSerializer.js';

/**
 * 模擬 Socket.io 的 Socket 介面，但使用原生 WebSocket
 */
export class TestWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  public id: string = '';
  public connected: boolean = false;
  private autoConnect: boolean;

  constructor(url: string, autoConnect: boolean = true) {
    this.url = url;
    this.autoConnect = autoConnect;
    if (autoConnect) {
      this.connect();
    }
  }

  /**
   * 建立 WebSocket 連線
   */
  connect(): void {
    if (this.ws) {
      throw new Error('WebSocket already connected');
    }
    this.ws = new WebSocket(this.url);
    this.setupInternalHandlers();
  }

  private setupInternalHandlers(): void {
    if (!this.ws) {
      throw new Error('WebSocket not initialized');
    }

    this.ws.onmessage = (event) => {
      try {
        const response: WebSocketResponse = deserialize(event.data) as WebSocketResponse;

        if (response.type === 'connection:ready' && response.payload) {
          this.id = (response.payload as any).socketId;
        }

        const handlers = this.listeners.get(response.type);
        if (handlers) {
          handlers.forEach((handler) => handler(response.payload));
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    this.ws.onerror = (error) => {
      const handlers = this.listeners.get('error');
      if (handlers) {
        handlers.forEach((handler) => handler(error));
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      const handlers = this.listeners.get('close');
      if (handlers) {
        handlers.forEach((handler) => handler({}));
      }
    };
  }

  /**
   * 等待連線開啟
   */
  async waitForOpen(): Promise<void> {
    if (!this.ws) {
      throw new Error('WebSocket not initialized. Call connect() first.');
    }

    if (this.ws.readyState === WebSocket.OPEN) {
      this.connected = true;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 5000);

      this.ws!.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      };

      this.ws!.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  /**
   * 註冊事件監聽器
   */
  on(event: string, handler: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /**
   * 移除事件監聽器
   */
  off(event: string, handler: (data: any) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * 發送訊息
   */
  emit(event: string, payload: any): void {
    if (!this.ws) {
      throw new Error('WebSocket not initialized. Call connect() first.');
    }
    const message: WebSocketMessage = {
      type: event,
      requestId: payload.requestId || '',
      payload,
    };
    this.ws.send(serialize(message));
  }

  /**
   * 關閉連線
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

/**
 * 建立並連線 WebSocket Client
 * 並自動切換到預設 Canvas
 */
export async function createSocketClient(baseUrl: string, canvasId?: string): Promise<TestWebSocketClient> {
  const wsUrl = baseUrl.replace(/^http/, 'ws');
  const socket = new TestWebSocketClient(wsUrl, false);
  const readyPromise = waitForEvent(socket, 'connection:ready');
  socket.connect();
  await socket.waitForOpen();
  await readyPromise;

  if (canvasId) {
    const { v4: uuidv4 } = await import('uuid');
    const responsePromise = waitForEvent<unknown>(socket, 'canvas:switched');
    socket.emit('canvas:switch', { requestId: uuidv4(), canvasId });
    await responsePromise;
  }

  return socket;
}

/**
 * 等待特定事件
 * 回傳 Promise 化的事件等待
 */
export function waitForEvent<T>(
  socket: TestWebSocketClient,
  eventName: string,
  timeout: number = 5000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    const handler = (data: T) => {
      clearTimeout(timer);
      socket.off(eventName, handler);
      resolve(data);
    };

    socket.on(eventName, handler);
  });
}

/**
 * 發送請求並等待回應
 * 適用於 Request/Response 模式
 */
export async function emitAndWaitResponse<TReq, TRes>(
  socket: TestWebSocketClient,
  requestEvent: string,
  responseEvent: string,
  payload: TReq,
  timeout: number = 5000
): Promise<TRes> {
  const responsePromise = waitForEvent<TRes>(socket, responseEvent, timeout);
  socket.emit(requestEvent, payload);
  return responsePromise;
}
/**
 * 斷開 Socket 連線
 */
export function disconnectSocket(socket: TestWebSocketClient): Promise<void> {
  return new Promise<void>((resolve) => {
    socket.on('close', () => {
      resolve();
    });
    socket.disconnect();
  });
}

/**
 * 建立 Socket 但不自動連線
 * 適用於需要在連線前設定監聽器的情況
 */
export function createSocketClientNoConnect(baseUrl: string): TestWebSocketClient {
  const wsUrl = baseUrl.replace(/^http/, 'ws');
  return new TestWebSocketClient(wsUrl, false);
}