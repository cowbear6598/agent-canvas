import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { webSocketMockFactory, simulateEvent, mockWebSocketClient } from '@tests/helpers/mockWebSocket'
import { setupStoreTest } from '@tests/helpers/testSetup'
import { usePullProgress } from '@/composables/canvas/usePullProgress'
import { useChatStore } from '@/stores/chat/chatStore'
import { useRepositoryStore } from '@/stores/note/repositoryStore'
import { WebSocketResponseEvents } from '@/types/websocket'
import type { RepositoryPullLatestProgressPayload, RepositoryPullLatestResultPayload } from '@/types/websocket'

vi.mock('@/services/websocket', () => webSocketMockFactory())

vi.mock('@/composables/canvas/useCanvasContext', () => ({
  useCanvasContext: () => {
    const repositoryStore = useRepositoryStore()
    const chatStore = useChatStore()
    return { repositoryStore, chatStore }
  },
}))

const { mockShowSuccessToast, mockShowErrorToast } = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}))

vi.mock('@/components/canvas/ProgressNote.vue', () => ({
  default: {},
}))

describe('usePullProgress', () => {
  setupStoreTest(() => {
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addTask 應正確預先註冊 pull task', () => {
    it('新增任務時應初始化正確的初始狀態', () => {
      const { pullTasks, addTask } = usePullProgress()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const task = pullTasks.value.get('req-1')
      expect(task).toBeDefined()
      expect(task?.requestId).toBe('req-1')
      expect(task?.repositoryName).toBe('my-repo')
      expect(task?.repositoryId).toBe('repo-id-1')
      expect(task?.progress).toBe(0)
      expect(task?.message).toBe('準備 Pull...')
      expect(task?.status).toBe('pulling')
    })
  })

  describe('收到 progress 事件時應更新 task', () => {
    it('收到進度事件時應更新任務進度和訊息', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const progressPayload: RepositoryPullLatestProgressPayload = {
        requestId: 'req-1',
        progress: 50,
        message: 'Fetching...',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS, progressPayload)

      const task = pullTasks.value.get('req-1')
      expect(task?.progress).toBe(50)
      expect(task?.message).toBe('Fetching...')
      expect(task?.status).toBe('pulling')
    })

    it('進度事件先到達、task 尚未建立時應忽略（不自動建立）', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { pullTasks } = usePullProgress()
      await nextTick()

      const progressPayload: RepositoryPullLatestProgressPayload = {
        requestId: 'req-orphan',
        progress: 30,
        message: '孤兒進度',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS, progressPayload)

      expect(pullTasks.value.has('req-orphan')).toBe(false)
    })
  })

  describe('收到成功 result 事件時應標記 completed 並移除 task', () => {
    it('成功結果應將任務狀態設為 completed 並呼叫 loadRepositories', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      const loadRepositoriesSpy = vi.spyOn(repositoryStore, 'loadRepositories').mockResolvedValue()

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: true,
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)
      await nextTick()

      const task = pullTasks.value.get('req-1')
      expect(task?.status).toBe('completed')
      expect(task?.progress).toBe(100)
      expect(task?.message).toBe('Pull 完成')
      expect(loadRepositoriesSpy).toHaveBeenCalled()
    })

    it('成功時應呼叫 showSuccessToast', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      vi.spyOn(repositoryStore, 'loadRepositories').mockResolvedValue()

      const { addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: true,
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)
      await nextTick()

      expect(mockShowSuccessToast).toHaveBeenCalledWith('Git', 'Pull 成功', 'my-repo')
    })

    it('成功後應在 1 秒後移除任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      vi.spyOn(repositoryStore, 'loadRepositories').mockResolvedValue()

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: true,
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)
      await nextTick()

      expect(pullTasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(1000)
      await nextTick()

      expect(pullTasks.value.has('req-1')).toBe(false)
    })
  })

  describe('收到失敗 result 事件時應標記 failed 並移除 task', () => {
    it('失敗結果應將任務狀態設為 failed 並顯示錯誤訊息', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: false,
        error: '遠端連線失敗',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)

      const task = pullTasks.value.get('req-1')
      expect(task?.status).toBe('failed')
      expect(task?.message).toBe('遠端連線失敗')
    })

    it('失敗時應呼叫 showErrorToast', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: false,
        error: '遠端連線失敗',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)

      expect(mockShowErrorToast).toHaveBeenCalledWith('Git', 'Pull 失敗', '遠端連線失敗')
    })

    it('error 為空時應使用預設訊息「Pull 失敗」', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: false,
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)

      const task = pullTasks.value.get('req-1')
      expect(task?.message).toBe('Pull 失敗')
    })

    it('失敗後應在 2 秒後移除任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: false,
        error: '失敗了',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)

      expect(pullTasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(2000)
      await nextTick()

      expect(pullTasks.value.has('req-1')).toBe(false)
    })
  })

  describe('超時 60 秒後自動標記 failed', () => {
    it('addTask 後若 60 秒內無回應，應自動標記為 failed 並設正確訊息', async () => {
      const { pullTasks, addTask } = usePullProgress()

      addTask('req-1', 'my-repo', 'repo-id-1')

      expect(pullTasks.value.get('req-1')?.status).toBe('pulling')

      vi.advanceTimersByTime(60_000)
      await nextTick()

      const task = pullTasks.value.get('req-1')
      expect(task?.status).toBe('failed')
      expect(task?.message).toBe('操作逾時，請重試')
    })

    it('逾時後應在 2 秒後移除任務', async () => {
      const { pullTasks, addTask } = usePullProgress()

      addTask('req-1', 'my-repo', 'repo-id-1')

      vi.advanceTimersByTime(60_000)
      await nextTick()

      expect(pullTasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(2000)
      await nextTick()

      expect(pullTasks.value.has('req-1')).toBe(false)
    })
  })

  describe('toProgressTask 正確映射 pulling 為 processing', () => {
    it('pulling 狀態應映射為 processing', () => {
      const { addTask, progressTasks } = usePullProgress()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const progressTask = progressTasks.value.get('req-1')
      expect(progressTask?.status).toBe('processing')
      expect(progressTask?.title).toBe('my-repo')
    })

    it('completed 狀態應保持 completed', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      vi.spyOn(repositoryStore, 'loadRepositories').mockResolvedValue()

      const { progressTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: true,
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)
      await nextTick()

      const progressTask = progressTasks.value.get('req-1')
      expect(progressTask?.status).toBe('completed')
    })

    it('failed 狀態應保持 failed', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { progressTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'my-repo', 'repo-id-1')

      const resultPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: false,
        error: '失敗',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, resultPayload)

      const progressTask = progressTasks.value.get('req-1')
      expect(progressTask?.status).toBe('failed')
    })
  })

  describe('多任務並行處理', () => {
    it('同時追蹤多個 Pull 任務，progressTasks 應有兩筆資料', () => {
      const { progressTasks, addTask } = usePullProgress()

      addTask('req-1', 'repo-A', 'id-A')
      addTask('req-2', 'repo-B', 'id-B')

      expect(progressTasks.value.size).toBe(2)
      expect(progressTasks.value.has('req-1')).toBe(true)
      expect(progressTasks.value.has('req-2')).toBe(true)
    })

    it('分別更新各任務進度時應互不影響', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'repo-A', 'id-A')
      addTask('req-2', 'repo-B', 'id-B')

      const progressPayload1: RepositoryPullLatestProgressPayload = {
        requestId: 'req-1',
        progress: 30,
        message: 'Fetching A...',
      }
      const progressPayload2: RepositoryPullLatestProgressPayload = {
        requestId: 'req-2',
        progress: 70,
        message: 'Resetting B...',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS, progressPayload1)
      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS, progressPayload2)

      expect(pullTasks.value.get('req-1')?.progress).toBe(30)
      expect(pullTasks.value.get('req-1')?.message).toBe('Fetching A...')
      expect(pullTasks.value.get('req-2')?.progress).toBe(70)
      expect(pullTasks.value.get('req-2')?.message).toBe('Resetting B...')
    })

    it('一個成功一個失敗，兩者應互不影響', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      vi.spyOn(repositoryStore, 'loadRepositories').mockResolvedValue()

      const { pullTasks, addTask } = usePullProgress()
      await nextTick()

      addTask('req-1', 'repo-A', 'id-A')
      addTask('req-2', 'repo-B', 'id-B')

      const successPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-1',
        success: true,
      }
      const failPayload: RepositoryPullLatestResultPayload = {
        requestId: 'req-2',
        success: false,
        error: '遠端連線失敗',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, successPayload)
      await nextTick()
      simulateEvent(WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, failPayload)
      await nextTick()

      expect(pullTasks.value.get('req-1')?.status).toBe('completed')
      expect(pullTasks.value.get('req-1')?.progress).toBe(100)
      expect(pullTasks.value.get('req-2')?.status).toBe('failed')
      expect(pullTasks.value.get('req-2')?.message).toBe('遠端連線失敗')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Git', 'Pull 成功', 'repo-A')
      expect(mockShowErrorToast).toHaveBeenCalledWith('Git', 'Pull 失敗', '遠端連線失敗')
    })
  })

  describe('removeTask 應正確移除指定 task', () => {
    it('移除指定任務後 Map 中不應包含該任務', () => {
      const { pullTasks, addTask, removeTask } = usePullProgress()

      addTask('req-1', 'repo-1', 'id-1')
      addTask('req-2', 'repo-2', 'id-2')

      expect(pullTasks.value.size).toBe(2)

      removeTask('req-1')

      expect(pullTasks.value.size).toBe(1)
      expect(pullTasks.value.has('req-1')).toBe(false)
      expect(pullTasks.value.has('req-2')).toBe(true)
    })
  })

  describe('WebSocket 監聽器管理', () => {
    it('連線狀態為 connected 時應自動註冊監聽器', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'disconnected'

      usePullProgress()

      expect(mockWebSocketClient.on).not.toHaveBeenCalled()

      chatStore.connectionStatus = 'connected'
      await nextTick()

      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS,
        expect.any(Function)
      )
      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        expect.any(Function)
      )
    })

    it('cleanupListeners 應移除所有監聽器', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { cleanupListeners } = usePullProgress()
      await nextTick()

      cleanupListeners()

      expect(mockWebSocketClient.off).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS,
        expect.any(Function)
      )
      expect(mockWebSocketClient.off).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        expect.any(Function)
      )
    })

    it('重複呼叫 setupListeners 應只註冊一次', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { setupListeners } = usePullProgress()
      await nextTick()

      mockWebSocketClient.on.mockClear()

      setupListeners()

      expect(mockWebSocketClient.on).not.toHaveBeenCalled()
    })
  })
})
