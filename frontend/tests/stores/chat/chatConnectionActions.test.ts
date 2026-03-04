import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, resetMockWebSocket, mockWebSocketClient } from '../../helpers/mockWebSocket'
import { useChatStore } from '@/stores/chat/chatStore'
import type { HeartbeatPingPayload, PodErrorPayload } from '@/types/websocket'

// Mock WebSocket
vi.mock('@/services/websocket', async () => {
  const actual = await vi.importActual<typeof import('@/services/websocket')>('@/services/websocket')
  return {
    ...mockWebSocketModule(),
    WebSocketRequestEvents: actual.WebSocketRequestEvents,
    WebSocketResponseEvents: actual.WebSocketResponseEvents,
  }
})

// Mock useToast
const { mockToast, mockShowSuccessToast, mockShowErrorToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}))

describe('chatConnectionActions', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initWebSocket', () => {
    it('設定 connectionStatus 為 connecting', () => {
      const store = useChatStore()

      store.initWebSocket()

      expect(store.connectionStatus).toBe('connecting')
    })

    it('呼叫 websocketClient.connect()', () => {
      const store = useChatStore()

      store.initWebSocket()

      expect(mockWebSocketClient.connect).toHaveBeenCalledOnce()
    })
  })

  describe('disconnectWebSocket', () => {
    it('呼叫 unregisterListeners', () => {
      const store = useChatStore()
      const unregisterSpy = vi.spyOn(store, 'unregisterListeners')

      store.disconnectWebSocket()

      expect(unregisterSpy).toHaveBeenCalledOnce()
    })

    it('呼叫 websocketClient.disconnect()', () => {
      const store = useChatStore()

      store.disconnectWebSocket()

      expect(mockWebSocketClient.disconnect).toHaveBeenCalledOnce()
    })

    it('設定 connectionStatus 為 disconnected', () => {
      const store = useChatStore()
      store.connectionStatus = 'connected'

      store.disconnectWebSocket()

      expect(store.connectionStatus).toBe('disconnected')
    })

    it('清除 socketId', () => {
      const store = useChatStore()
      store.socketId = 'socket-123'

      store.disconnectWebSocket()

      expect(store.socketId).toBeNull()
    })

    it('停止心跳檢查', () => {
      const store = useChatStore()
      store.heartbeatCheckTimer = 12345

      store.disconnectWebSocket()

      expect(store.heartbeatCheckTimer).toBeNull()
    })
  })

  describe('handleConnectionReady', () => {
    it('設定 connectionStatus 為 connected', async () => {
      const store = useChatStore()
      store.connectionStatus = 'connecting'

      await store.handleConnectionReady({ socketId: 'socket-123' })

      expect(store.connectionStatus).toBe('connected')
    })

    it('設定 socketId', async () => {
      const store = useChatStore()

      await store.handleConnectionReady({ socketId: 'socket-456' })

      expect(store.socketId).toBe('socket-456')
    })

    it('啟動心跳檢查', async () => {
      vi.useFakeTimers()
      const store = useChatStore()

      await store.handleConnectionReady({ socketId: 'socket-123' })

      expect(store.heartbeatCheckTimer).not.toBeNull()

      vi.useRealTimers()
    })
  })

  describe('handleHeartbeatPing', () => {
    it('更新 lastHeartbeatAt', () => {
      const store = useChatStore()
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const ack = vi.fn()

      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload, ack)

      expect(store.lastHeartbeatAt).toBe(now)
    })

    it('呼叫 ack 回傳 timestamp', () => {
      const store = useChatStore()
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const ack = vi.fn()

      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload, ack)

      expect(ack).toHaveBeenCalledWith({ timestamp: now })
    })

    it('非 connected 狀態時恢復為 connected', () => {
      const store = useChatStore()
      store.connectionStatus = 'error'
      const ack = vi.fn()

      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload, ack)

      expect(store.connectionStatus).toBe('connected')
    })

    it('已為 connected 狀態時保持 connected', () => {
      const store = useChatStore()
      store.connectionStatus = 'connected'
      const ack = vi.fn()

      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload, ack)

      expect(store.connectionStatus).toBe('connected')
    })
  })

  describe('心跳超時', () => {
    it('超過 20 秒未收到心跳：設定 disconnected、顯示 Toast', async () => {
      vi.useFakeTimers()
      const store = useChatStore()

      await store.handleConnectionReady({ socketId: 'socket-123' })

      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const ack = vi.fn()
      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload, ack)

      vi.spyOn(Date, 'now').mockReturnValue(now + 21000)
      vi.advanceTimersByTime(5000)

      expect(store.connectionStatus).toBe('disconnected')
      expect(mockToast).toHaveBeenCalledWith({
        title: '連線逾時',
        description: '未收到伺服器心跳回應',
      })

      vi.useRealTimers()
    })

    it('lastHeartbeatAt 為 null 時不判斷超時', async () => {
      vi.useFakeTimers()
      const store = useChatStore()

      await store.handleConnectionReady({ socketId: 'socket-123' })

      expect(store.lastHeartbeatAt).toBeNull()

      vi.advanceTimersByTime(25000)

      expect(store.connectionStatus).toBe('connected')
      expect(mockToast).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('心跳檢查間隔為 5 秒', async () => {
      vi.useFakeTimers()
      const store = useChatStore()

      await store.handleConnectionReady({ socketId: 'socket-123' })

      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const ack = vi.fn()
      store.handleHeartbeatPing({} as unknown as HeartbeatPingPayload, ack)

      vi.spyOn(Date, 'now').mockReturnValue(now + 21000)
      vi.advanceTimersByTime(4900)
      expect(store.connectionStatus).toBe('connected')

      vi.advanceTimersByTime(100)
      expect(store.connectionStatus).toBe('disconnected')

      vi.useRealTimers()
    })
  })

  describe('handleSocketDisconnect', () => {
    it('設定 disconnectReason', () => {
      const store = useChatStore()

      store.handleSocketDisconnect('Server shutdown')

      expect(store.disconnectReason).toBe('Server shutdown')
    })

    it('設定 connectionStatus 為 disconnected', () => {
      const store = useChatStore()
      store.connectionStatus = 'connected'

      store.handleSocketDisconnect('Connection lost')

      expect(store.connectionStatus).toBe('disconnected')
    })

    it('重置連線狀態（socketId, historyLoadingStatus 等）', () => {
      const store = useChatStore()
      store.socketId = 'socket-123'
      store.lastHeartbeatAt = 12345
      store.allHistoryLoaded = true
      store.historyLoadingStatus.set('pod-1', 'loaded')
      store.historyLoadingError.set('pod-1', 'some error')

      store.handleSocketDisconnect('Connection lost')

      expect(store.socketId).toBeNull()
      expect(store.lastHeartbeatAt).toBeNull()
      expect(store.allHistoryLoaded).toBe(false)
      expect(store.historyLoadingStatus.size).toBe(0)
      expect(store.historyLoadingError.size).toBe(0)
    })

    it('顯示斷線 Toast（已知 reason 顯示友善訊息）', () => {
      const store = useChatStore()

      store.handleSocketDisconnect('transport close')

      expect(mockToast).toHaveBeenCalledWith({
        title: '連線中斷',
        description: '連線已關閉',
      })
    })

    it('顯示斷線 Toast（未知 reason 顯示未知原因）', () => {
      const store = useChatStore()

      store.handleSocketDisconnect('Network error')

      expect(mockToast).toHaveBeenCalledWith({
        title: '連線中斷',
        description: '未知原因',
      })
    })

    it('所有已知 reason 皆有對應友善訊息', () => {
      const knownReasons: Record<string, string> = {
        'transport close': '連線已關閉',
        'transport error': '連線傳輸錯誤',
        'ping timeout': '心跳超時',
        'io server disconnect': '伺服器主動斷開',
        'io client disconnect': '客戶端主動斷開',
      }

      for (const [reason, expectedMessage] of Object.entries(knownReasons)) {
        vi.clearAllMocks()
        const store = useChatStore()

        store.handleSocketDisconnect(reason)

        expect(mockToast).toHaveBeenCalledWith({
          title: '連線中斷',
          description: expectedMessage,
        })
      }
    })

    it('斷線時清除所有 Pod typing 狀態', () => {
      const store = useChatStore()
      store.isTypingByPodId.set('pod-1', true)
      store.isTypingByPodId.set('pod-2', true)

      store.handleSocketDisconnect('transport close')

      expect(store.isTypingByPodId.size).toBe(0)
    })

    it('停止心跳檢查', () => {
      vi.useFakeTimers()
      const store = useChatStore()
      store.heartbeatCheckTimer = 12345

      store.handleSocketDisconnect('Connection lost')

      expect(store.heartbeatCheckTimer).toBeNull()

      vi.useRealTimers()
    })
  })

  describe('handleError', () => {
    it('websocketClient 未連線時設定 connectionStatus 為 error', () => {
      const store = useChatStore()
      mockWebSocketClient.isConnected.value = false
      store.connectionStatus = 'connecting'

      store.handleError({ error: 'Some error' } as unknown as PodErrorPayload)

      expect(store.connectionStatus).toBe('error')
    })

    it('websocketClient 已連線時不改變 connectionStatus', () => {
      const store = useChatStore()
      mockWebSocketClient.isConnected.value = true
      store.connectionStatus = 'connected'

      store.handleError({ error: 'Some error' } as unknown as PodErrorPayload)

      expect(store.connectionStatus).toBe('connected')
    })

    it('有 podId 時設定該 pod 的 typing 為 false', () => {
      const store = useChatStore()
      mockWebSocketClient.isConnected.value = true
      store.isTypingByPodId.set('pod-1', true)

      store.handleError({ error: 'Some error', podId: 'pod-1' } as unknown as PodErrorPayload)

      expect(store.isTypingByPodId.get('pod-1')).toBe(false)
    })

    it('無 podId 時不影響 typing 狀態', () => {
      const store = useChatStore()
      mockWebSocketClient.isConnected.value = true
      store.isTypingByPodId.set('pod-1', true)

      store.handleError({ error: 'Some error' } as unknown as PodErrorPayload)

      expect(store.isTypingByPodId.get('pod-1')).toBe(true)
    })

    it('podId 不存在時設定 typing 為 false', () => {
      const store = useChatStore()
      mockWebSocketClient.isConnected.value = true

      store.handleError({ error: 'Some error', podId: 'pod-new' } as unknown as PodErrorPayload)

      expect(store.isTypingByPodId.get('pod-new')).toBe(false)
    })
  })

  describe('startHeartbeatCheck', () => {
    it('清除既有的計時器', async () => {
      vi.useFakeTimers()
      const store = useChatStore()
      const originalTimer = 99999
      store.heartbeatCheckTimer = originalTimer

      const connectionActions = store.getConnectionActions()
      connectionActions.startHeartbeatCheck()

      expect(store.heartbeatCheckTimer).not.toBe(originalTimer)
      expect(store.heartbeatCheckTimer).not.toBeNull()

      vi.useRealTimers()
    })

    it('設定 lastHeartbeatAt 為 null', async () => {
      vi.useFakeTimers()
      const store = useChatStore()
      store.lastHeartbeatAt = 12345

      const connectionActions = store.getConnectionActions()
      connectionActions.startHeartbeatCheck()

      expect(store.lastHeartbeatAt).toBeNull()

      vi.useRealTimers()
    })

    it('建立新的計時器', async () => {
      vi.useFakeTimers()
      const store = useChatStore()

      const connectionActions = store.getConnectionActions()
      connectionActions.startHeartbeatCheck()

      expect(store.heartbeatCheckTimer).not.toBeNull()

      vi.useRealTimers()
    })
  })

  describe('stopHeartbeatCheck', () => {
    it('清除計時器並設定為 null', () => {
      vi.useFakeTimers()
      const store = useChatStore()
      store.heartbeatCheckTimer = 12345

      const connectionActions = store.getConnectionActions()
      connectionActions.stopHeartbeatCheck()

      expect(store.heartbeatCheckTimer).toBeNull()

      vi.useRealTimers()
    })

    it('計時器為 null 時不報錯', () => {
      const store = useChatStore()
      store.heartbeatCheckTimer = null

      const connectionActions = store.getConnectionActions()

      expect(() => connectionActions.stopHeartbeatCheck()).not.toThrow()
    })
  })
})
