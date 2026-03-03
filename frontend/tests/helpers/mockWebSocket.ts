import { vi } from 'vitest'
import { ref } from 'vue'

type EventCallback = (payload: unknown) => void
type EventCallbackWithAck = (payload: unknown, ack: (response?: unknown) => void) => void
type DisconnectCallback = (reason: string) => void

interface EventListeners {
  callbacks: Set<EventCallback | EventCallbackWithAck>
  hasAck: boolean
}

const eventListeners = new Map<string, EventListeners>()
const disconnectListeners = new Set<DisconnectCallback>()

export const mockWebSocketClient = {
  isConnected: ref(true),
  disconnectReason: ref<string | null>(null),
  connect: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
  on: vi.fn((event: string, callback: EventCallback) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, { callbacks: new Set(), hasAck: false })
    }
    eventListeners.get(event)!.callbacks.add(callback)
  }),
  off: vi.fn((event: string, callback: EventCallback) => {
    const listeners = eventListeners.get(event)
    if (listeners) {
      listeners.callbacks.delete(callback)
    }
  }),
  onWithAck: vi.fn((event: string, callback: EventCallbackWithAck) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, { callbacks: new Set(), hasAck: true })
    }
    const listeners = eventListeners.get(event)!
    listeners.hasAck = true
    listeners.callbacks.add(callback)
  }),
  offWithAck: vi.fn((event: string, callback: EventCallbackWithAck) => {
    const listeners = eventListeners.get(event)
    if (listeners) {
      listeners.callbacks.delete(callback)
    }
  }),
  onDisconnect: vi.fn((callback: DisconnectCallback) => {
    disconnectListeners.add(callback)
  }),
  offDisconnect: vi.fn((callback: DisconnectCallback) => {
    disconnectListeners.delete(callback)
  }),
}

export const mockCreateWebSocketRequest = vi.fn().mockResolvedValue(null)

/**
 * 模擬觸發 WebSocket 事件
 */
export function simulateEvent(eventName: string, payload: unknown): void {
  const listeners = eventListeners.get(eventName)
  if (!listeners) {
    return
  }

  listeners.callbacks.forEach((callback) => {
    if (listeners.hasAck) {
      const ack = vi.fn()
      ;(callback as EventCallbackWithAck)(payload, ack)
    } else {
      ;(callback as EventCallback)(payload)
    }
  })
}

/**
 * 模擬觸發斷線事件
 */
export function simulateDisconnect(reason: string): void {
  mockWebSocketClient.isConnected.value = false
  mockWebSocketClient.disconnectReason.value = reason

  disconnectListeners.forEach((callback) => {
    callback(reason)
  })
}

/**
 * 重置所有 Mock
 */
export function resetMockWebSocket(): void {
  mockWebSocketClient.isConnected.value = true
  mockWebSocketClient.disconnectReason.value = null
  mockWebSocketClient.connect.mockClear()
  mockWebSocketClient.disconnect.mockClear()
  mockWebSocketClient.emit.mockClear()
  mockWebSocketClient.on.mockClear()
  mockWebSocketClient.off.mockClear()
  mockWebSocketClient.onWithAck.mockClear()
  mockWebSocketClient.offWithAck.mockClear()
  mockWebSocketClient.onDisconnect.mockClear()
  mockWebSocketClient.offDisconnect.mockClear()
  mockCreateWebSocketRequest.mockReset().mockResolvedValue(null)
  eventListeners.clear()
  disconnectListeners.clear()
}

/**
 * 回傳可直接用在 vi.mock() 的物件
 */
export function mockWebSocketModule() {
  return {
    websocketClient: mockWebSocketClient,
    createWebSocketRequest: mockCreateWebSocketRequest,
  }
}
