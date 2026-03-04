import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket, mockWebSocketClient } from '../helpers/mockWebSocket'
import { createMockPod } from '../helpers/factories'
import { useChatStore } from '@/stores/chat/chatStore'
import { usePodStore } from '@/stores/pod/podStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type {
  PodChatMessagePayload,
  PodChatToolUsePayload,
  PodChatToolResultPayload,
  PodChatCompletePayload,
  PodChatAbortedPayload,
  WorkflowAutoClearedPayload,
  PersistedMessage
} from '@/types/websocket'

vi.mock('@/services/websocket', async () => {
  const actual = await vi.importActual<typeof import('@/services/websocket')>('@/services/websocket')
  return {
    ...mockWebSocketModule(),
    WebSocketRequestEvents: actual.WebSocketRequestEvents,
    WebSocketResponseEvents: actual.WebSocketResponseEvents,
  }
})

const { mockShowSuccessToast, mockShowErrorToast, mockToast } = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
  mockToast: vi.fn(),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}))

const { mockWrapWebSocketRequest } = vi.hoisted(() => ({
  mockWrapWebSocketRequest: vi.fn(),
}))

vi.mock('@/composables/useWebSocketErrorHandler', () => ({
  useWebSocketErrorHandler: () => ({
    wrapWebSocketRequest: mockWrapWebSocketRequest,
  }),
}))

describe('Chat 對話完整流程', () => {
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

  describe('發送訊息到串流接收', () => {
    it('sendMessage -> handleChatMessage（多次 delta）-> handleChatComplete', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'pod-1', output: [] })
      podStore.pods = [pod]
      const chatStore = useChatStore()

      await chatStore.sendMessage('pod-1', 'Hello Agent')

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith('pod:chat:send', {
        requestId: expect.any(String),
        canvasId: 'canvas-1',
        podId: 'pod-1',
        message: 'Hello Agent',
      })

      expect(chatStore.isTyping('pod-1')).toBe(true)

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Hello! ',
        isPartial: true,
      } as PodChatMessagePayload)

      let messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.role).toBe('assistant')
      expect(messages[0]?.content).toBe('Hello! ')
      expect(messages[0]?.isPartial).toBe(true)
      expect(chatStore.isTyping('pod-1')).toBe(true)
      expect(chatStore.currentStreamingMessageId).toBe('msg-1')

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Hello! How can ',
        isPartial: true,
      } as PodChatMessagePayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.content).toBe('Hello! How can ')
      expect(messages[0]?.isPartial).toBe(true)

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Hello! How can I help you?',
        isPartial: true,
      } as PodChatMessagePayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.content).toBe('Hello! How can I help you?')
      expect(messages[0]?.isPartial).toBe(true)

      chatStore.handleChatComplete({
        podId: 'pod-1',
        messageId: 'msg-1',
        fullContent: 'Hello! How can I help you?',
      } as PodChatCompletePayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.content).toBe('Hello! How can I help you?')
      expect(messages[0]?.isPartial).toBe(false)
      expect(chatStore.isTyping('pod-1')).toBe(false)
      expect(chatStore.currentStreamingMessageId).toBeNull()

      await vi.waitFor(() => {
        const updatedPod = podStore.pods.find(p => p.id === 'pod-1')
        expect(updatedPod!.output.length).toBeGreaterThan(0)
      })

      const updatedPod = podStore.pods.find(p => p.id === 'pod-1')
      expect(updatedPod!.output.length).toBeGreaterThan(0)
      const fullOutput = updatedPod!.output.join('')
      expect(fullOutput).toContain('Hello!')
    })

    it('驗證 messages 陣列從 user 訊息到 assistant 完整回應', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'pod-1', output: [] })
      podStore.pods = [pod]
      const chatStore = useChatStore()

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-user',
        content: 'What is the weather?',
        isPartial: false,
        role: 'user',
      } as PodChatMessagePayload)

      let messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.role).toBe('user')
      expect(messages[0]?.content).toBe('What is the weather?')

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-assistant',
        content: 'Let me check...',
        isPartial: true,
      } as PodChatMessagePayload)

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-assistant',
        content: 'Let me check... It is sunny today!',
        isPartial: true,
      } as PodChatMessagePayload)

      chatStore.handleChatComplete({
        podId: 'pod-1',
        messageId: 'msg-assistant',
        fullContent: 'Let me check... It is sunny today!',
      } as PodChatCompletePayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(2)
      expect(messages[0]?.role).toBe('user')
      expect(messages[0]?.content).toBe('What is the weather?')
      expect(messages[1]?.role).toBe('assistant')
      expect(messages[1]?.content).toBe('Let me check... It is sunny today!')
      expect(messages[1]?.isPartial).toBe(false)
    })

    it('驗證 isTyping 狀態變化：false -> true -> false', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'pod-1', output: [] })
      podStore.pods = [pod]
      const chatStore = useChatStore()

      expect(chatStore.isTyping('pod-1')).toBe(false)

      await chatStore.sendMessage('pod-1', 'Test message')

      expect(chatStore.isTyping('pod-1')).toBe(true)

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Response',
        isPartial: true,
      } as PodChatMessagePayload)

      expect(chatStore.isTyping('pod-1')).toBe(true)

      chatStore.handleChatComplete({
        podId: 'pod-1',
        messageId: 'msg-1',
        fullContent: 'Response',
      } as PodChatCompletePayload)

      expect(chatStore.isTyping('pod-1')).toBe(false)
    })

    it('驗證 Pod output 更新', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'pod-1', output: [] })
      podStore.pods = [pod]
      const chatStore = useChatStore()

      expect(pod.output).toEqual([])

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-user',
        content: 'Hello',
        isPartial: false,
        role: 'user',
      } as PodChatMessagePayload)

      await vi.waitFor(() => {
        const updatedPod = podStore.pods.find(p => p.id === 'pod-1')
        expect(updatedPod!.output.length).toBeGreaterThan(0)
      })

      let updatedPod = podStore.pods.find(p => p.id === 'pod-1')
      expect(updatedPod!.output[0]).toBe('> Hello')

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-assistant',
        content: 'Hi there!',
        isPartial: true,
      } as PodChatMessagePayload)

      chatStore.handleChatComplete({
        podId: 'pod-1',
        messageId: 'msg-assistant',
        fullContent: 'Hi there!',
      } as PodChatCompletePayload)

      await vi.waitFor(() => {
        const pod = podStore.pods.find(p => p.id === 'pod-1')
        expect(pod!.output.length).toBeGreaterThan(1)
      })

      updatedPod = podStore.pods.find(p => p.id === 'pod-1')
      expect(updatedPod!.output).toEqual([
        '> Hello',
        'Hi there!',
      ])
    })
  })

  describe('工具使用流程', () => {
    it('sendMessage -> handleChatMessage -> handleChatToolUse -> handleChatToolResult -> handleChatComplete', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'pod-1', output: [] })
      podStore.pods = [pod]
      const chatStore = useChatStore()

      // Arrange & Act: 發送訊息
      await chatStore.sendMessage('pod-1', 'List files')

      // Act: 模擬 assistant 開始思考
      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Let me check the files',
        isPartial: true,
      } as PodChatMessagePayload)

      // Assert: 訊息應該建立
      let messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toBe('Let me check the files')

      chatStore.handleChatToolUse({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        input: { command: 'ls -la' },
      } as PodChatToolUsePayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.toolUse).toHaveLength(1)
      expect(messages[0]?.toolUse![0]).toMatchObject({
        toolUseId: 'tool-1',
        toolName: 'Bash',
        input: { command: 'ls -la' },
        status: 'running',
      })

      expect(messages[0]?.subMessages).toHaveLength(1)
      expect(messages[0]?.subMessages![0]?.toolUse).toHaveLength(1)
      expect(messages[0]?.subMessages![0]?.toolUse![0]?.status).toBe('running')

      chatStore.handleChatToolResult({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        output: 'file1.txt\nfile2.txt\n',
      } as PodChatToolResultPayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.toolUse![0]?.status).toBe('completed')
      expect(messages[0]?.toolUse![0]?.output).toBe('file1.txt\nfile2.txt\n')
      expect(messages[0]?.subMessages![0]?.toolUse![0]?.status).toBe('completed')

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Let me check the filesI found 2 files.',
        isPartial: true,
      } as PodChatMessagePayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.content).toBe('Let me check the filesI found 2 files.')
      expect(messages[0]?.subMessages).toHaveLength(2)
      expect(messages[0]?.subMessages![0]?.content).toBe('Let me check the files')
      expect(messages[0]?.subMessages![1]?.content).toBe('I found 2 files.')

      chatStore.handleChatComplete({
        podId: 'pod-1',
        messageId: 'msg-1',
        fullContent: 'Let me check the filesI found 2 files.',
      } as PodChatCompletePayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.isPartial).toBe(false)
      expect(messages[0]?.subMessages![0]?.isPartial).toBe(false)
      expect(messages[0]?.subMessages![1]?.isPartial).toBe(false)
      expect(chatStore.isTyping('pod-1')).toBe(false)
    })

    it('驗證 toolUse 狀態：running -> completed', async () => {
      const chatStore = useChatStore()

      chatStore.handleChatToolUse({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Read',
        input: { file_path: '/test.ts' },
      } as PodChatToolUsePayload)

      let messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.toolUse![0]?.status).toBe('running')

      chatStore.handleChatToolResult({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Read',
        output: 'File content here',
      } as PodChatToolResultPayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.toolUse![0]?.status).toBe('completed')
      expect(messages[0]?.toolUse![0]?.output).toBe('File content here')
    })

    it('驗證 subMessage 包含 toolUse 資訊', async () => {
      const chatStore = useChatStore()

      chatStore.handleChatToolUse({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Write',
        input: { file_path: '/output.txt', content: 'test' },
      } as PodChatToolUsePayload)

      const messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.subMessages).toBeDefined()
      expect(messages[0]?.subMessages).toHaveLength(1)
      expect(messages[0]?.subMessages![0]?.toolUse).toHaveLength(1)
      expect(messages[0]?.subMessages![0]?.toolUse![0]).toMatchObject({
        toolUseId: 'tool-1',
        toolName: 'Write',
        input: { file_path: '/output.txt', content: 'test' },
        status: 'running',
      })
    })

    it('多個工具依序使用', async () => {
      const chatStore = useChatStore()

      chatStore.handleChatToolUse({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Read',
        input: { file_path: '/input.txt' },
      } as PodChatToolUsePayload)

      chatStore.handleChatToolResult({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Read',
        output: 'input content',
      } as PodChatToolResultPayload)

      chatStore.handleChatToolUse({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-2',
        toolName: 'Write',
        input: { file_path: '/output.txt', content: 'output' },
      } as PodChatToolUsePayload)

      chatStore.handleChatToolResult({
        podId: 'pod-1',
        messageId: 'msg-1',
        toolUseId: 'tool-2',
        toolName: 'Write',
        output: 'success',
      } as PodChatToolResultPayload)

      const messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.toolUse).toHaveLength(2)
      expect(messages[0]?.toolUse![0]?.toolName).toBe('Read')
      expect(messages[0]?.toolUse![0]?.status).toBe('completed')
      expect(messages[0]?.toolUse![1]?.toolName).toBe('Write')
      expect(messages[0]?.toolUse![1]?.status).toBe('completed')

      // 在同一個 message 內多次呼叫 handleChatToolUse 時，沒有 handleChatMessage 介入
      // 所以第二次呼叫的 toolUse 會加到同一個 subMessage 的 toolUse 陣列中
      expect(messages[0]?.subMessages).toHaveLength(1)
      expect(messages[0]?.subMessages![0]?.toolUse).toHaveLength(2)
    })
  })

  describe('中止與 AutoClear', () => {
    it('串流中 abortChat -> handleChatAborted', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'pod-1', output: [] })
      podStore.pods = [pod]
      const chatStore = useChatStore()

      // Arrange: 開始串流
      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'This is a long response that',
        isPartial: true,
      } as PodChatMessagePayload)

      let messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.isPartial).toBe(true)
      expect(chatStore.isTyping('pod-1')).toBe(true)

      await chatStore.abortChat('pod-1')

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith('pod:chat:abort', {
        requestId: expect.any(String),
        canvasId: 'canvas-1',
        podId: 'pod-1',
      })

      chatStore.handleChatAborted({
        podId: 'pod-1',
        messageId: 'msg-1',
      } as PodChatAbortedPayload)

      messages = chatStore.getMessages('pod-1')
      expect(messages[0]?.content).toBe('This is a long response that')
      expect(messages[0]?.isPartial).toBe(false)
      expect(chatStore.isTyping('pod-1')).toBe(false)
      expect(chatStore.currentStreamingMessageId).toBeNull()
    })

    it('驗證部分訊息被保留', async () => {
      const chatStore = useChatStore()

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Partial',
        isPartial: true,
      } as PodChatMessagePayload)

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Partial content',
        isPartial: true,
      } as PodChatMessagePayload)

      chatStore.handleChatAborted({
        podId: 'pod-1',
        messageId: 'msg-1',
      } as PodChatAbortedPayload)

      const messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toBe('Partial content')
      expect(messages[0]?.isPartial).toBe(false)
    })

    it('AutoClear：handleWorkflowAutoCleared -> 訊息清空 + 動畫觸發', async () => {
      const podStore = usePodStore()
      const pod1 = createMockPod({ id: 'pod-1', output: ['line1'] })
      const pod2 = createMockPod({ id: 'pod-2', output: ['line2'] })
      podStore.pods = [pod1, pod2]
      const chatStore = useChatStore()

      chatStore.handleChatMessage({
        podId: 'pod-1',
        messageId: 'msg-1',
        content: 'Message for pod-1',
        isPartial: false,
      } as PodChatMessagePayload)

      chatStore.handleChatMessage({
        podId: 'pod-2',
        messageId: 'msg-2',
        content: 'Message for pod-2',
        isPartial: false,
      } as PodChatMessagePayload)

      expect(chatStore.getMessages('pod-1')).toHaveLength(1)
      expect(chatStore.getMessages('pod-2')).toHaveLength(1)

      await chatStore.handleWorkflowAutoCleared({
        sourcePodId: 'pod-source',
        clearedPodIds: ['pod-1', 'pod-2'],
        clearedPodNames: ['Pod 1', 'Pod 2'],
      } as WorkflowAutoClearedPayload)

      expect(chatStore.getMessages('pod-1')).toEqual([])
      expect(chatStore.getMessages('pod-2')).toEqual([])

      const updatedPod1 = podStore.pods.find(p => p.id === 'pod-1')
      const updatedPod2 = podStore.pods.find(p => p.id === 'pod-2')
      expect(updatedPod1!.output).toEqual([])
      expect(updatedPod2!.output).toEqual([])

      expect(chatStore.autoClearAnimationPodId).toBe('pod-source')
    })

    it('AutoClear 清除動畫後可手動清除', () => {
      const chatStore = useChatStore()

      chatStore.autoClearAnimationPodId = 'pod-1'
      chatStore.clearAutoClearAnimation()
      expect(chatStore.autoClearAnimationPodId).toBeNull()
    })
  })

  describe('歷史載入', () => {
    it('loadPodChatHistory -> 設定 messages', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello from history',
          timestamp: '2026-01-01T00:00:00Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi from history',
          timestamp: '2026-01-01T00:01:00Z',
          subMessages: [
            {
              id: 'msg-2-sub-0',
              content: 'Hi from history',
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

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'pod:chat:history',
        responseEvent: 'pod:chat:history:result',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
        },
        timeout: 10000,
      })

      const messages = chatStore.getMessages('pod-1')
      expect(messages).toHaveLength(2)
      expect(messages[0]?.role).toBe('user')
      expect(messages[0]?.content).toBe('Hello from history')
      expect(messages[1]?.role).toBe('assistant')
      expect(messages[1]?.content).toBe('Hi from history')
      expect(chatStore.getHistoryLoadingStatus('pod-1')).toBe('loaded')
    })

    it('loadAllPodsHistory -> 多 Pod 並行載入 -> allHistoryLoaded', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      mockCreateWebSocketRequest
        .mockResolvedValueOnce({
          requestId: 'req-1',
          success: true,
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Pod 1 history',
              timestamp: '2026-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          requestId: 'req-2',
          success: true,
          messages: [
            {
              id: 'msg-2',
              role: 'user',
              content: 'Pod 2 history',
              timestamp: '2026-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          requestId: 'req-3',
          success: true,
          messages: [],
        })

      expect(chatStore.allHistoryLoaded).toBe(false)

      await chatStore.loadAllPodsHistory(['pod-1', 'pod-2', 'pod-3'])

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(3)
      expect(chatStore.getMessages('pod-1')).toHaveLength(1)
      expect(chatStore.getMessages('pod-1')[0]?.content).toBe('Pod 1 history')
      expect(chatStore.getMessages('pod-2')).toHaveLength(1)
      expect(chatStore.getMessages('pod-2')[0]?.content).toBe('Pod 2 history')
      expect(chatStore.getMessages('pod-3')).toHaveLength(0)
      expect(chatStore.allHistoryLoaded).toBe(true)
    })

    it('已載入的歷史不應重複載入', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      // Arrange: 設定為已載入
      chatStore.historyLoadingStatus.set('pod-1', 'loaded')

      await chatStore.loadPodChatHistory('pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('部分 Pod 載入失敗不影響其他 Pod', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const chatStore = useChatStore()

      let callCount = 0
      mockWrapWebSocketRequest.mockImplementation(async (promise) => {
        callCount++
        if (callCount === 2) {
          return null // pod-2 失敗
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
              content: 'Pod 1',
              timestamp: '2026-01-01T00:00:00Z',
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
              content: 'Pod 3',
              timestamp: '2026-01-01T00:00:00Z',
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

    it('空 podIds 時應直接設定 allHistoryLoaded', async () => {
      const chatStore = useChatStore()

      await chatStore.loadAllPodsHistory([])

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(chatStore.allHistoryLoaded).toBe(true)
    })
  })
})
