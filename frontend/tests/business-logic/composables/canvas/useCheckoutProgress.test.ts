import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { webSocketMockFactory, simulateEvent, mockWebSocketClient } from '@tests/helpers/mockWebSocket'
import { setupStoreTest } from '@tests/helpers/testSetup'
import { useCheckoutProgress } from '@/composables/canvas/useCheckoutProgress'
import { useChatStore } from '@/stores/chat/chatStore'
import { useRepositoryStore } from '@/stores/note/repositoryStore'
import { WebSocketResponseEvents } from '@/types/websocket'
import type { RepositoryCheckoutBranchProgressPayload, RepositoryBranchCheckedOutPayload } from '@/types/websocket'

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

describe('useCheckoutProgress', () => {
  setupStoreTest(() => {
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addTask 應正確新增 checkout task 到 Map 中', () => {
    it('新增任務時應初始化正確的初始狀態', () => {
      const { checkoutTasks, addTask } = useCheckoutProgress()

      addTask('req-1', 'feature-branch', 'repo-1')

      const task = checkoutTasks.value.get('req-1')
      expect(task).toBeDefined()
      expect(task?.requestId).toBe('req-1')
      expect(task?.branchName).toBe('feature-branch')
      expect(task?.repositoryId).toBe('repo-1')
      expect(task?.progress).toBe(0)
      expect(task?.message).toBe('準備切換分支...')
      expect(task?.status).toBe('checking-out')
    })
  })

  describe('removeTask 應正確移除指定 task', () => {
    it('移除指定任務後 Map 中不應包含該任務', () => {
      const { checkoutTasks, addTask, removeTask } = useCheckoutProgress()

      addTask('req-1', 'feature-1', 'repo-1')
      addTask('req-2', 'feature-2', 'repo-1')

      expect(checkoutTasks.value.size).toBe(2)

      removeTask('req-1')

      expect(checkoutTasks.value.size).toBe(1)
      expect(checkoutTasks.value.has('req-1')).toBe(false)
      expect(checkoutTasks.value.has('req-2')).toBe(true)
    })
  })

  describe('handleProgress 應更新對應 task 的 progress 和 message', () => {
    it('收到進度事件時應更新任務進度', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const progressPayload: RepositoryCheckoutBranchProgressPayload = {
        requestId: 'req-1',
        progress: 50,
        message: '切換分支...',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS, progressPayload)

      const task = checkoutTasks.value.get('req-1')
      expect(task?.progress).toBe(50)
      expect(task?.message).toBe('切換分支...')
      expect(task?.status).toBe('checking-out')
    })
  })

  describe('handleProgress 在進度事件先於 addTask 到達時，應自動建立 task', () => {
    it('收到進度事件時若 task 不存在，應自動建立並更新進度', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks } = useCheckoutProgress()
      await nextTick()

      const progressPayload: RepositoryCheckoutBranchProgressPayload = {
        requestId: 'req-early',
        progress: 30,
        message: '切換分支...',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS, progressPayload)

      const task = checkoutTasks.value.get('req-early')
      expect(task).toBeDefined()
      expect(task?.requestId).toBe('req-early')
      expect(task?.branchName).toBe('feature-branch')
      expect(task?.progress).toBe(30)
      expect(task?.message).toBe('切換分支...')
      expect(task?.status).toBe('checking-out')
    })
  })

  describe('handleProgress 應忽略不存在的 requestId', () => {
    it('requestId 不存在時應不做任何更新', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const progressPayload: RepositoryCheckoutBranchProgressPayload = {
        requestId: 'non-existent',
        progress: 50,
        message: '不應更新',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS, progressPayload)

      const task = checkoutTasks.value.get('req-1')
      expect(task?.progress).toBe(0)
    })
  })

  describe('handleProgress 應忽略已完成或已失敗的 task', () => {
    it('已完成任務不應被進度事件更新', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const task = checkoutTasks.value.get('req-1')
      if (task) {
        task.status = 'completed'
        task.progress = 100
      }

      const progressPayload: RepositoryCheckoutBranchProgressPayload = {
        requestId: 'req-1',
        progress: 50,
        message: '不應更新',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS, progressPayload)

      expect(task?.progress).toBe(100)
      expect(task?.message).not.toBe('不應更新')
    })

    it('已失敗任務不應被進度事件更新', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const task = checkoutTasks.value.get('req-1')
      if (task) {
        task.status = 'failed'
        task.progress = 0
        task.message = '切換失敗'
      }

      const progressPayload: RepositoryCheckoutBranchProgressPayload = {
        requestId: 'req-1',
        progress: 50,
        message: '不應更新',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS, progressPayload)

      expect(task?.progress).toBe(0)
      expect(task?.message).not.toBe('不應更新')
    })
  })

  describe('handleResult 成功時應將 task 標記為 completed 並在 1 秒後移除', () => {
    it('成功結果應將任務狀態設為 completed 並更新 currentBranch', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      repositoryStore.availableItems = [
        { id: 'repo-1', name: 'Test Repo', currentBranch: 'main' } as never,
      ]

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: true,
        repositoryId: 'repo-1',
        branchName: 'feature-branch',
        action: 'switched',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      const task = checkoutTasks.value.get('req-1')
      expect(task?.status).toBe('completed')
      expect(task?.progress).toBe(100)
      expect(task?.message).toBe('切換完成')
      expect((repositoryStore.availableItems[0] as any)?.currentBranch).toBe('feature-branch')
    })

    it('成功後應在 1 秒後移除任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: true,
        repositoryId: 'repo-1',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      expect(checkoutTasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(1000)
      await nextTick()

      expect(checkoutTasks.value.has('req-1')).toBe(false)
    })

    it('切換成功時應呼叫 showSuccessToast', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: true,
        repositoryId: 'repo-1',
        branchName: 'feature-branch',
        action: 'switched',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      expect(mockShowSuccessToast).toHaveBeenCalledWith('Git', '切換分支成功', 'feature-branch')
    })
  })

  describe('handleResult 失敗時應將 task 標記為 failed 並在 2 秒後移除', () => {
    it('失敗結果應將任務狀態設為 failed 並顯示錯誤訊息', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: false,
        error: '分支不存在',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      const task = checkoutTasks.value.get('req-1')
      expect(task?.status).toBe('failed')
      expect(task?.message).toBe('分支不存在')
    })

    it('失敗後應在 2 秒後移除任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: false,
        error: '分支不存在',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      expect(checkoutTasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(2000)
      await nextTick()

      expect(checkoutTasks.value.has('req-1')).toBe(false)
    })

    it('切換失敗時應呼叫 showErrorToast', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: false,
        error: '切換分支失敗',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      expect(mockShowErrorToast).toHaveBeenCalledWith('Git', '切換分支失敗', '切換分支失敗')
    })
  })

  describe('handleResult 應忽略不存在的 requestId', () => {
    it('requestId 不存在時結果事件不應影響任何任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'non-existent',
        success: true,
        repositoryId: 'repo-1',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      const task = checkoutTasks.value.get('req-1')
      expect(task?.status).toBe('checking-out')
    })
  })

  describe('progressTasks computed', () => {
    it('應將 CheckoutTask 轉換為 ProgressTask 格式', () => {
      const { addTask, progressTasks } = useCheckoutProgress()

      addTask('req-1', 'feature-branch', 'repo-1')

      const progressTask = progressTasks.value.get('req-1')
      expect(progressTask?.title).toBe('feature-branch')
      expect(progressTask?.status).toBe('processing')
    })

    it('completed 任務應保持 completed 狀態', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { progressTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: true,
        repositoryId: 'repo-1',
        branchName: 'feature-branch',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      const progressTask = progressTasks.value.get('req-1')
      expect(progressTask?.status).toBe('completed')
    })
  })

  describe('逾時保護機制', () => {
    it('addTask 後若 60 秒內無回應，應自動標記為 failed 並設正確訊息', async () => {
      const { checkoutTasks, addTask } = useCheckoutProgress()

      addTask('req-1', 'feature-branch', 'repo-1')

      expect(checkoutTasks.value.get('req-1')?.status).toBe('checking-out')

      vi.advanceTimersByTime(60_000)
      await nextTick()

      const task = checkoutTasks.value.get('req-1')
      expect(task?.status).toBe('failed')
      expect(task?.message).toBe('操作逾時，請重試')
    })

    it('逾時後應在 2 秒後移除任務', async () => {
      const { checkoutTasks, addTask } = useCheckoutProgress()

      addTask('req-1', 'feature-branch', 'repo-1')

      vi.advanceTimersByTime(60_000)
      await nextTick()

      expect(checkoutTasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(2000)
      await nextTick()

      expect(checkoutTasks.value.has('req-1')).toBe(false)
    })

    it('已完成的任務不應被逾時機制影響', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      repositoryStore.availableItems = [
        { id: 'repo-1', name: 'Test Repo', currentBranch: 'main' } as never,
      ]

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: true,
        repositoryId: 'repo-1',
        branchName: 'feature-branch',
        action: 'switched',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      expect(checkoutTasks.value.get('req-1')?.status).toBe('completed')

      vi.advanceTimersByTime(60_000)
      await nextTick()

      // 任務應已在 1 秒後被移除，不應被逾時再次標記
      vi.advanceTimersByTime(1000)
      await nextTick()
      expect(checkoutTasks.value.has('req-1')).toBe(false)
    })

    it('handleResult 成功收到結果後不應再觸發逾時', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const repositoryStore = useRepositoryStore()
      repositoryStore.availableItems = [
        { id: 'repo-1', name: 'Test Repo', currentBranch: 'main' } as never,
      ]

      const { checkoutTasks, addTask } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')

      const resultPayload: RepositoryBranchCheckedOutPayload = {
        requestId: 'req-1',
        success: true,
        repositoryId: 'repo-1',
        branchName: 'feature-branch',
        action: 'switched',
      }

      simulateEvent(WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, resultPayload)

      expect(checkoutTasks.value.get('req-1')?.status).toBe('completed')

      // 推進超過 60 秒，不應再觸發逾時邏輯
      vi.advanceTimersByTime(62_000)
      await nextTick()

      // 任務已在 1 秒後被正常移除
      expect(checkoutTasks.value.has('req-1')).toBe(false)
    })

    it('removeTask 應清除對應的逾時 timer', async () => {
      const { checkoutTasks, addTask, removeTask } = useCheckoutProgress()

      addTask('req-1', 'feature-branch', 'repo-1')

      removeTask('req-1')
      expect(checkoutTasks.value.has('req-1')).toBe(false)

      // 推進超過 60 秒，不應有任何錯誤或副作用
      vi.advanceTimersByTime(62_000)
      await nextTick()

      expect(checkoutTasks.value.has('req-1')).toBe(false)
    })

    it('cleanupListeners 應清除所有進行中的逾時 timer', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { checkoutTasks, addTask, cleanupListeners } = useCheckoutProgress()
      await nextTick()

      addTask('req-1', 'feature-branch', 'repo-1')
      addTask('req-2', 'other-branch', 'repo-1')

      cleanupListeners()

      // 推進超過 60 秒，因 timer 已被清除所以任務不應被標記為 failed
      vi.advanceTimersByTime(62_000)
      await nextTick()

      // 任務仍然存在但不應被逾時標記（因為 cleanupListeners 已清除 timers）
      // 注意：此時 checkoutTasks 中任務仍存在，只是 timer 被取消了
      expect(checkoutTasks.value.get('req-1')?.status).not.toBe('failed')
      expect(checkoutTasks.value.get('req-2')?.status).not.toBe('failed')
    })
  })

  describe('WebSocket 監聽器管理', () => {
    it('連線狀態為 connected 時應自動註冊監聽器', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'disconnected'

      useCheckoutProgress()

      expect(mockWebSocketClient.on).not.toHaveBeenCalled()

      chatStore.connectionStatus = 'connected'
      await nextTick()

      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS,
        expect.any(Function)
      )
      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
        expect.any(Function)
      )
    })

    it('cleanupListeners 應移除所有監聽器', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { cleanupListeners } = useCheckoutProgress()
      await nextTick()

      cleanupListeners()

      expect(mockWebSocketClient.off).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS,
        expect.any(Function)
      )
      expect(mockWebSocketClient.off).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
        expect.any(Function)
      )
    })

    it('重複呼叫 setupListeners 應只註冊一次', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { setupListeners } = useCheckoutProgress()
      await nextTick()

      mockWebSocketClient.on.mockClear()

      setupListeners()

      expect(mockWebSocketClient.on).not.toHaveBeenCalled()
    })
  })
})
