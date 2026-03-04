import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket } from '../helpers/mockWebSocket'
import { createMockPod } from '../helpers/factories'
import { useSlackStore } from '@/stores/slackStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type { SlackApp } from '@/types/slack'

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
const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}))

// Mock sanitizeErrorForUser
vi.mock('@/utils/errorSanitizer', () => ({
  sanitizeErrorForUser: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return '未知錯誤'
  }),
}))

function createMockSlackApp(overrides?: Partial<SlackApp>): SlackApp {
  return {
    id: 'slack-app-1',
    name: 'Test Slack App',
    connectionStatus: 'disconnected',
    channels: [],
    ...overrides,
  }
}

describe('slackStore', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()
  })

  describe('初始狀態', () => {
    it('slackApps 應為空陣列', () => {
      const store = useSlackStore()

      expect(store.slackApps).toEqual([])
    })
  })

  describe('getters', () => {
    describe('getSlackAppById', () => {
      it('找到對應 ID 的 App 時應回傳', () => {
        const store = useSlackStore()
        const app = createMockSlackApp({ id: 'app-1', name: 'App 1' })
        store.slackApps = [app]

        const result = store.getSlackAppById('app-1')

        expect(result).toEqual(app)
      })

      it('找不到對應 ID 時應回傳 undefined', () => {
        const store = useSlackStore()
        store.slackApps = []

        const result = store.getSlackAppById('non-existent')

        expect(result).toBeUndefined()
      })
    })

    describe('connectedApps', () => {
      it('應只回傳 connectionStatus 為 connected 的 App', () => {
        const store = useSlackStore()
        const connectedApp = createMockSlackApp({ id: 'app-1', connectionStatus: 'connected' })
        const disconnectedApp = createMockSlackApp({ id: 'app-2', connectionStatus: 'disconnected' })
        const errorApp = createMockSlackApp({ id: 'app-3', connectionStatus: 'error' })
        store.slackApps = [connectedApp, disconnectedApp, errorApp]

        const result = store.connectedApps

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual(connectedApp)
      })

      it('無 connected App 時應回傳空陣列', () => {
        const store = useSlackStore()
        store.slackApps = []

        expect(store.connectedApps).toEqual([])
      })
    })

    describe('getSlackAppForPod', () => {
      it('Pod 有 slackBinding 且找到對應 App 時應回傳', () => {
        const store = useSlackStore()
        const app = createMockSlackApp({ id: 'app-1' })
        store.slackApps = [app]
        const pod = createMockPod({ slackBinding: { slackAppId: 'app-1', slackChannelId: 'channel-1' } })

        const result = store.getSlackAppForPod(pod)

        expect(result).toEqual(app)
      })

      it('Pod 無 slackBinding 時應回傳 undefined', () => {
        const store = useSlackStore()
        store.slackApps = [createMockSlackApp()]
        const pod = createMockPod({ slackBinding: null })

        const result = store.getSlackAppForPod(pod)

        expect(result).toBeUndefined()
      })

      it('Pod 有 slackBinding 但找不到對應 App 時應回傳 undefined', () => {
        const store = useSlackStore()
        store.slackApps = []
        const pod = createMockPod({ slackBinding: { slackAppId: 'non-existent', slackChannelId: 'channel-1' } })

        const result = store.getSlackAppForPod(pod)

        expect(result).toBeUndefined()
      })
    })
  })

  describe('loadSlackApps', () => {
    it('成功時應更新 slackApps', async () => {
      const store = useSlackStore()
      const apps = [createMockSlackApp({ id: 'app-1' }), createMockSlackApp({ id: 'app-2' })]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ slackApps: apps })

      await store.loadSlackApps()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'slack:app:list',
        responseEvent: 'slack:app:list:result',
        payload: {},
      })
      expect(store.slackApps).toEqual(apps)
    })

    it('回應無 slackApps 時 slackApps 應保持原樣', async () => {
      const store = useSlackStore()
      const existingApp = createMockSlackApp({ id: 'existing' })
      store.slackApps = [existingApp]

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      await store.loadSlackApps()

      expect(store.slackApps).toEqual([existingApp])
    })
  })

  describe('createSlackApp', () => {
    it('成功時應顯示成功 Toast 並回傳 SlackApp', async () => {
      const store = useSlackStore()
      const newApp = createMockSlackApp({ id: 'new-app', name: 'My App' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({ slackApp: newApp })

      const result = await store.createSlackApp('My App', 'xoxb-token', 'test-signing-secret')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'slack:app:create',
        responseEvent: 'slack:app:created',
        payload: {
          name: 'My App',
          botToken: 'xoxb-token',
          signingSecret: 'test-signing-secret',
        },
      })
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Slack', '建立成功', 'My App')
      expect(result).toEqual(newApp)
    })

    it('回應無 slackApp 時應回傳 null', async () => {
      const store = useSlackStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.createSlackApp('My App', 'xoxb-token', 'test-signing-secret')

      expect(result).toBeNull()
      expect(mockShowSuccessToast).not.toHaveBeenCalled()
    })

    it('失敗時應顯示錯誤 Toast 並回傳 null', async () => {
      const store = useSlackStore()
      const error = new Error('建立失敗')

      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      const result = await store.createSlackApp('My App', 'xoxb-token', 'test-signing-secret')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Slack', '建立失敗', '建立失敗')
      expect(result).toBeNull()
    })
  })

  describe('deleteSlackApp', () => {
    it('成功時應顯示成功 Toast', async () => {
      const store = useSlackStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.deleteSlackApp('app-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'slack:app:delete',
        responseEvent: 'slack:app:deleted',
        payload: { slackAppId: 'app-1' },
      })
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Slack', '刪除成功')
    })

    it('失敗時應顯示錯誤 Toast', async () => {
      const store = useSlackStore()
      const error = new Error('刪除失敗')

      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      await store.deleteSlackApp('app-1')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Slack', '刪除失敗', '刪除失敗')
    })
  })

  describe('bindSlackToPod', () => {
    it('有 activeCanvasId 時應發送正確 payload', async () => {
      const store = useSlackStore()
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.bindSlackToPod('pod-1', 'app-1', 'channel-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'pod:bind-slack',
        responseEvent: 'pod:slack:bound',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
          slackAppId: 'app-1',
          slackChannelId: 'channel-1',
        },
      })
    })

    it('無 activeCanvasId 時應顯示錯誤 Toast 且不發送請求', async () => {
      const store = useSlackStore()
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      await store.bindSlackToPod('pod-1', 'app-1', 'channel-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(mockShowErrorToast).toHaveBeenCalledWith('Slack', '綁定失敗', '尚未選取 Canvas')
    })

    it('發送失敗時應顯示錯誤 Toast', async () => {
      const store = useSlackStore()
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const error = new Error('綁定錯誤')

      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      await store.bindSlackToPod('pod-1', 'app-1', 'channel-1')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Slack', '綁定失敗', '綁定錯誤')
    })
  })

  describe('unbindSlackFromPod', () => {
    it('有 activeCanvasId 時應發送正確 payload', async () => {
      const store = useSlackStore()
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.unbindSlackFromPod('pod-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'pod:unbind-slack',
        responseEvent: 'pod:slack:unbound',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
        },
      })
    })

    it('無 activeCanvasId 時應顯示錯誤 Toast 且不發送請求', async () => {
      const store = useSlackStore()
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      await store.unbindSlackFromPod('pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(mockShowErrorToast).toHaveBeenCalledWith('Slack', '解除綁定失敗', '尚未選取 Canvas')
    })

    it('發送失敗時應顯示錯誤 Toast', async () => {
      const store = useSlackStore()
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const error = new Error('解除綁定錯誤')

      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      await store.unbindSlackFromPod('pod-1')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Slack', '解除綁定失敗', '解除綁定錯誤')
    })
  })

  describe('addSlackAppFromEvent', () => {
    it('應新增 SlackApp 到列表', () => {
      const store = useSlackStore()
      const app = createMockSlackApp({ id: 'app-1' })

      store.addSlackAppFromEvent(app)

      expect(store.slackApps).toHaveLength(1)
      expect(store.slackApps[0]).toEqual(app)
    })

    it('可新增多個 App', () => {
      const store = useSlackStore()
      const app1 = createMockSlackApp({ id: 'app-1' })
      const app2 = createMockSlackApp({ id: 'app-2' })

      store.addSlackAppFromEvent(app1)
      store.addSlackAppFromEvent(app2)

      expect(store.slackApps).toHaveLength(2)
    })
  })

  describe('removeSlackAppFromEvent', () => {
    it('應移除指定 ID 的 App', () => {
      const store = useSlackStore()
      const app1 = createMockSlackApp({ id: 'app-1' })
      const app2 = createMockSlackApp({ id: 'app-2' })
      store.slackApps = [app1, app2]

      store.removeSlackAppFromEvent('app-1')

      expect(store.slackApps).toHaveLength(1)
      expect(store.slackApps[0]).toEqual(app2)
    })

    it('ID 不存在時不應改變列表', () => {
      const store = useSlackStore()
      const app = createMockSlackApp({ id: 'app-1' })
      store.slackApps = [app]

      store.removeSlackAppFromEvent('non-existent')

      expect(store.slackApps).toHaveLength(1)
    })
  })

  describe('updateSlackAppStatus', () => {
    it('應更新 App 的 connectionStatus', () => {
      const store = useSlackStore()
      const app = createMockSlackApp({ id: 'app-1', connectionStatus: 'disconnected' })
      store.slackApps = [app]

      store.updateSlackAppStatus('app-1', 'connected')

      expect(store.slackApps[0]?.connectionStatus).toBe('connected')
    })

    it('提供 channels 時應同時更新 channels', () => {
      const store = useSlackStore()
      const app = createMockSlackApp({ id: 'app-1', channels: [] })
      store.slackApps = [app]
      const channels = [{ id: 'ch-1', name: 'general' }]

      store.updateSlackAppStatus('app-1', 'connected', channels)

      expect(store.slackApps[0]?.channels).toEqual(channels)
      expect(store.slackApps[0]?.connectionStatus).toBe('connected')
    })

    it('不提供 channels 時不應改變原有 channels', () => {
      const store = useSlackStore()
      const originalChannels = [{ id: 'ch-1', name: 'general' }]
      const app = createMockSlackApp({ id: 'app-1', channels: originalChannels })
      store.slackApps = [app]

      store.updateSlackAppStatus('app-1', 'error')

      expect(store.slackApps[0]?.channels).toEqual(originalChannels)
    })

    it('App 不存在時不應有任何操作', () => {
      const store = useSlackStore()
      store.slackApps = []

      expect(() => store.updateSlackAppStatus('non-existent', 'connected')).not.toThrow()
    })
  })
})
