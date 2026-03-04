import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket, mockWebSocketClient } from '../../helpers/mockWebSocket'
import { useChatStore } from '@/stores/chat/chatStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type { PodChatHistoryResultPayload, PersistedMessage } from '@/types/websocket/responses'

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

// Mock useWebSocketErrorHandler
const { mockWrapWebSocketRequest } = vi.hoisted(() => ({
  mockWrapWebSocketRequest: vi.fn(),
}))

vi.mock('@/composables/useWebSocketErrorHandler', () => ({
  useWebSocketErrorHandler: () => ({
    wrapWebSocketRequest: mockWrapWebSocketRequest,
  }),
}))

describe('chatHistoryActions', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()

    mockWebSocketClient.isConnected.value = true
    const chatStore = useChatStore()
    chatStore.connectionStatus = 'connected'

    mockWrapWebSocketRequest.mockImplementation(async (promise) => promise)
  })

  describe('loadPodChatHistory', () => {
    it('成功時應設定 messages 和 status 為 loaded', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi there',
          timestamp: new Date().toISOString(),
          subMessages: [
            {
              id: 'msg-2-sub-0',
              content: 'Hi there',
            },
          ],
        },
      ]

      const payload: PodChatHistoryResultPayload = {
        requestId: 'req-1',
        success: true,
        messages: persistedMessages,
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce(payload)

      await chatStore.loadPodChatHistory('pod-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'pod:chat:history',
        responseEvent: 'pod:chat:history:result',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
        },
        timeout: 10000,
      })
      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('loaded')
      expect(chatStore.getMessages('pod-1')).toHaveLength(2)
      expect(chatStore.getMessages('pod-1')[0]?.role).toBe('user')
      expect(chatStore.getMessages('pod-1')[1]?.role).toBe('assistant')
    })

    it('loading 過程中應設定 status 為 loading', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      let resolveRequest: (value: PodChatHistoryResultPayload) => void
      const requestPromise = new Promise<PodChatHistoryResultPayload>((resolve) => {
        resolveRequest = resolve
      })

      mockCreateWebSocketRequest.mockReturnValueOnce(requestPromise)

      const loadPromise = chatStore.loadPodChatHistory('pod-1')

      // 在 promise resolve 之前檢查 status
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('loading')

      // 完成請求
      resolveRequest!({
        requestId: 'req-1',
        success: true,
        messages: [],
      })

      await loadPromise

      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('loaded')
    })

    it('已 loaded 時不應重複載入', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      chatStore.historyLoadingStatus.set('pod-1', 'loaded')

      await chatStore.loadPodChatHistory('pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('正在 loading 時不應重複載入', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      chatStore.historyLoadingStatus.set('pod-1', 'loading')

      await chatStore.loadPodChatHistory('pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('未連線時應設定 error 並 throw', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      mockWebSocketClient.isConnected.value = false
      chatStore.connectionStatus = 'disconnected'

      await expect(chatStore.loadPodChatHistory('pod-1')).rejects.toThrow('WebSocket 尚未連線')

      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('error')
      expect(chatStore.historyLoadingError.get('pod-1')).toBe('WebSocket 尚未連線')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('WebSocket 回應為 null 時應設定 status 為 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      mockWrapWebSocketRequest.mockResolvedValueOnce(null)

      await chatStore.loadPodChatHistory('pod-1')

      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('error')
    })

    it('WebSocket 失敗時應設定 status 為 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      // wrapWebSocketRequest 在失敗時會回傳 null
      mockWrapWebSocketRequest.mockResolvedValueOnce(null)

      await chatStore.loadPodChatHistory('pod-1')

      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('error')
    })

    it('messages 為空陣列時應正確處理', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      const payload: PodChatHistoryResultPayload = {
        requestId: 'req-1',
        success: true,
        messages: [],
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce(payload)

      await chatStore.loadPodChatHistory('pod-1')

      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('loaded')
      expect(chatStore.getMessages('pod-1')).toEqual([])
    })

    it('messages 為 undefined 時應正確處理', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      const payload: PodChatHistoryResultPayload = {
        requestId: 'req-1',
        success: true,
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce(payload)

      await chatStore.loadPodChatHistory('pod-1')

      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('loaded')
      expect(chatStore.getMessages('pod-1')).toEqual([])
    })

    it('應正確轉換 PersistedMessage 為 Message（assistant 訊息）', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Response content',
          timestamp: '2026-01-01T00:00:00.000Z',
          subMessages: [
            {
              id: 'msg-1-sub-0',
              content: 'Sub content',
              toolUse: [
                {
                  toolUseId: 'tool-1',
                  toolName: 'Bash',
                  input: { command: 'ls' },
                  output: 'file.txt',
                  status: 'completed',
                },
              ],
            },
          ],
        },
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        requestId: 'req-1',
        success: true,
        messages: persistedMessages,
      })

      await chatStore.loadPodChatHistory('pod-1')

      const messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.id).toBe('msg-1')
      expect(messages[0]?.role).toBe('assistant')
      expect(messages[0]?.content).toBe('Response content')
      expect(messages[0]?.timestamp).toBe('2026-01-01T00:00:00.000Z')
      expect(messages[0]?.isPartial).toBe(false)
      expect(messages[0]?.subMessages).toHaveLength(1)
      expect(messages[0]?.subMessages?.[0]?.content).toBe('Sub content')
      expect(messages[0]?.subMessages?.[0]?.isPartial).toBe(false)
      expect(messages[0]?.subMessages?.[0]?.toolUse).toHaveLength(1)
      expect(messages[0]?.subMessages?.[0]?.toolUse?.[0]?.toolUseId).toBe('tool-1')
      expect(messages[0]?.toolUse).toHaveLength(1)
      expect(messages[0]?.toolUse?.[0]?.toolName).toBe('Bash')
    })

    it('應正確轉換 PersistedMessage 為 Message（user 訊息）', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'User message',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        requestId: 'req-1',
        success: true,
        messages: persistedMessages,
      })

      await chatStore.loadPodChatHistory('pod-1')

      const messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.id).toBe('msg-1')
      expect(messages[0]?.role).toBe('user')
      expect(messages[0]?.content).toBe('User message')
      expect(messages[0]?.isPartial).toBe(false)
      expect(messages[0]?.subMessages).toBeUndefined()
    })

    it('assistant 訊息沒有 subMessages 時應建立預設 subMessage', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Simple response',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        requestId: 'req-1',
        success: true,
        messages: persistedMessages,
      })

      await chatStore.loadPodChatHistory('pod-1')

      const messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.subMessages).toHaveLength(1)
      expect(messages[0]?.subMessages?.[0]?.id).toBe('msg-1-sub-0')
      expect(messages[0]?.subMessages?.[0]?.content).toBe('Simple response')
      expect(messages[0]?.subMessages?.[0]?.isPartial).toBe(false)
    })
  })

  describe('loadAllPodsHistory', () => {
    it('應批量載入所有 Pod 的歷史', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      mockCreateWebSocketRequest.mockResolvedValue({
        requestId: 'req-1',
        success: true,
        messages: [],
      })

      await chatStore.loadAllPodsHistory(['pod-1', 'pod-2', 'pod-3'])

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(3)
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ podId: 'pod-1' }),
        })
      )
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ podId: 'pod-2' }),
        })
      )
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ podId: 'pod-3' }),
        })
      )
      expect(chatStore.allHistoryLoaded).toBe(true)
    })

    it('完成後應設定 allHistoryLoaded 為 true', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      mockCreateWebSocketRequest.mockResolvedValue({
        requestId: 'req-1',
        success: true,
        messages: [],
      })

      expect(chatStore.allHistoryLoaded).toBe(false)

      await chatStore.loadAllPodsHistory(['pod-1'])

      expect(chatStore.allHistoryLoaded).toBe(true)
    })

    it('空 podIds 時應直接設定 allHistoryLoaded', async () => {
      const chatStore = useChatStore()

      await chatStore.loadAllPodsHistory([])

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(chatStore.allHistoryLoaded).toBe(true)
    })

    it('使用 Promise.allSettled 平行載入，部分失敗不影響其他', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      // pod-1 成功，pod-2 失敗（wrapWebSocketRequest 回傳 null），pod-3 成功
      let callCount = 0
      mockWrapWebSocketRequest.mockImplementation(async (promise) => {
        callCount++
        if (callCount === 2) {
          // pod-2 失敗
          return null
        }
        return promise
      })

      mockCreateWebSocketRequest
        .mockResolvedValueOnce({
          requestId: 'req-1',
          success: true,
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Pod 1 message',
              timestamp: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({
          requestId: 'req-2',
          success: true,
          messages: [],
        })
        .mockResolvedValueOnce({
          requestId: 'req-3',
          success: true,
          messages: [
            {
              id: 'msg-3',
              role: 'user',
              content: 'Pod 3 message',
              timestamp: new Date().toISOString(),
            },
          ],
        })

      await chatStore.loadAllPodsHistory(['pod-1', 'pod-2', 'pod-3'])

      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('loaded')
      expect(chatStore.getHistoryLoadingStatus('pod-2')).toBe('error')
      expect(chatStore.getHistoryLoadingStatus('pod-3')).toBe('loaded')
      expect(chatStore.getMessages('pod-1')).toHaveLength(1)
      expect(chatStore.getMessages('pod-3')).toHaveLength(1)
      expect(chatStore.allHistoryLoaded).toBe(true)
    })

    it('已載入的 Pod 不應重複載入', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      chatStore.historyLoadingStatus.set('pod-1', 'loaded')

      mockCreateWebSocketRequest.mockResolvedValue({
        requestId: 'req-1',
        success: true,
        messages: [],
      })

      await chatStore.loadAllPodsHistory(['pod-1', 'pod-2'])

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1)
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ podId: 'pod-2' }),
        })
      )
      expect(chatStore.allHistoryLoaded).toBe(true)
    })

    it('全部 Pod 都已載入時應不發送任何請求', async () => {
      const chatStore = useChatStore()

      chatStore.historyLoadingStatus.set('pod-1', 'loaded')
      chatStore.historyLoadingStatus.set('pod-2', 'loaded')

      await chatStore.loadAllPodsHistory(['pod-1', 'pod-2'])

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(chatStore.allHistoryLoaded).toBe(true)
    })

    it('正在 loading 的 Pod 不應重複載入', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      chatStore.historyLoadingStatus.set('pod-1', 'loading')

      mockCreateWebSocketRequest.mockResolvedValue({
        requestId: 'req-1',
        success: true,
        messages: [],
      })

      await chatStore.loadAllPodsHistory(['pod-1', 'pod-2'])

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1)
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ podId: 'pod-2' }),
        })
      )
    })
  })
})
