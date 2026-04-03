import { vi } from "vitest";
import { ref } from "vue";

type EventCallback = (payload: unknown) => void;
type DisconnectCallback = (reason: string) => void;

interface EventListeners {
  callbacks: Set<EventCallback>;
}

const eventListeners = new Map<string, EventListeners>();
const disconnectListeners = new Set<DisconnectCallback>();

export const mockWebSocketClient = {
  isConnected: ref(true),
  disconnectReason: ref<string | null>(null),
  connect: vi.fn(),
  disconnect: vi.fn(),
  startReconnect: vi.fn(),
  forceReconnect: vi.fn(),
  emit: vi.fn(),
  on: vi.fn((event: string, callback: EventCallback) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, { callbacks: new Set() });
    }
    eventListeners.get(event)!.callbacks.add(callback);
  }),
  off: vi.fn((event: string, callback: EventCallback) => {
    const listeners = eventListeners.get(event);
    if (listeners) {
      listeners.callbacks.delete(callback);
    }
  }),
  offAll: vi.fn((event: string) => {
    const listeners = eventListeners.get(event);
    if (listeners) {
      listeners.callbacks.clear();
      eventListeners.delete(event);
    }
  }),
  onDisconnect: vi.fn((callback: DisconnectCallback) => {
    disconnectListeners.add(callback);
  }),
  offDisconnect: vi.fn((callback: DisconnectCallback) => {
    disconnectListeners.delete(callback);
  }),
};

export const mockCreateWebSocketRequest = vi.fn().mockResolvedValue(null);

/**
 * 模擬觸發 WebSocket 事件
 */
export function simulateEvent(eventName: string, payload: unknown): void {
  const listeners = eventListeners.get(eventName);
  if (!listeners) {
    return;
  }

  listeners.callbacks.forEach((callback) => {
    (callback as EventCallback)(payload);
  });
}

/**
 * 模擬觸發斷線事件
 */
export function simulateDisconnect(reason: string): void {
  mockWebSocketClient.isConnected.value = false;
  mockWebSocketClient.disconnectReason.value = reason;

  disconnectListeners.forEach((callback) => {
    callback(reason);
  });
}

/**
 * 重置所有 Mock
 */
export function resetMockWebSocket(): void {
  mockWebSocketClient.isConnected.value = true;
  mockWebSocketClient.disconnectReason.value = null;
  mockWebSocketClient.connect.mockClear();
  mockWebSocketClient.disconnect.mockClear();
  mockWebSocketClient.startReconnect.mockClear();
  mockWebSocketClient.forceReconnect.mockClear();
  mockWebSocketClient.emit.mockClear();
  mockWebSocketClient.on.mockClear();
  mockWebSocketClient.off.mockClear();
  mockWebSocketClient.offAll.mockClear();
  mockWebSocketClient.onDisconnect.mockClear();
  mockWebSocketClient.offDisconnect.mockClear();
  mockCreateWebSocketRequest.mockReset().mockResolvedValue(null);
  eventListeners.clear();
  disconnectListeners.clear();
}

/**
 * 回傳可直接用在 vi.mock() 的物件
 */
export function mockWebSocketModule() {
  return {
    websocketClient: mockWebSocketClient,
    createWebSocketRequest: mockCreateWebSocketRequest,
  };
}

/**
 * 供 vi.mock() 使用的 factory，包含真實的 WebSocketRequestEvents 與 WebSocketResponseEvents
 */
export async function webSocketMockFactory() {
  const actual = await vi.importActual<typeof import("@/services/websocket")>(
    "@/services/websocket",
  );
  return {
    ...mockWebSocketModule(),
    WebSocketRequestEvents: actual.WebSocketRequestEvents,
    WebSocketResponseEvents: actual.WebSocketResponseEvents,
  };
}
