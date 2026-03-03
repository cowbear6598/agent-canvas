import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, resetMockWebSocket, simulateEvent, mockWebSocketClient } from '../../helpers/mockWebSocket'
import { useProgressTracker } from '@/composables/canvas/useProgressTracker'
import { useChatStore } from '@/stores/chat/chatStore'

vi.mock('@/services/websocket', async () => {
  const actual = await vi.importActual<typeof import('@/services/websocket')>('@/services/websocket')
  return {
    ...mockWebSocketModule(),
    WebSocketRequestEvents: actual.WebSocketRequestEvents,
    WebSocketResponseEvents: actual.WebSocketResponseEvents,
  }
})

vi.mock('@/composables/canvas/useCanvasContext', () => ({
  useCanvasContext: () => {
    const chatStore = useChatStore()
    return { chatStore }
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

interface TestTask {
  requestId: string
  name: string
  progress: number
  status: 'processing' | 'completed' | 'failed'
  message: string
}

interface TestProgressPayload {
  requestId: string
  progress: number
}

interface TestResultPayload {
  requestId: string
  success: boolean
  error?: string
}

const TEST_PROGRESS_EVENT = 'test:progress'
const TEST_RESULT_EVENT = 'test:result'

function createTestTracker() {
  return useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
    progressEvent: TEST_PROGRESS_EVENT,
    resultEvent: TEST_RESULT_EVENT,
    getRequestId: (payload) => payload.requestId,
    createTask: (payload) => ({
      requestId: payload.requestId,
      name: `task-${payload.requestId}`,
      progress: 0,
      status: 'processing',
      message: '',
    }),
    updateTask: (task, payload) => {
      task.progress = payload.progress
    },
    isProcessingStatus: (task) => task.status === 'processing',
    onResult: (task, payload, helpers) => {
      if (payload.success) {
        task.status = 'completed'
        task.progress = 100
        setTimeout(() => helpers.removeTask(payload.requestId), 1000)
      } else {
        task.status = 'failed'
        setTimeout(() => helpers.removeTask(payload.requestId), 2000)
      }
    },
    toProgressTask: (task) => ({
      requestId: task.requestId,
      title: task.name,
      progress: task.progress,
      message: '',
      status: task.status === 'processing' ? 'processing' : task.status,
    }),
  })
}

describe('useProgressTracker', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('tasks 初始狀態', () => {
    it('初始 tasks Map 應為空', () => {
      const { tasks } = createTestTracker()
      expect(tasks.value.size).toBe(0)
    })
  })

  describe('addTask', () => {
    it('新增任務後 Map 中應包含該任務', () => {
      const { tasks, addTask } = createTestTracker()

      const task: TestTask = {
        requestId: 'req-1',
        name: 'repo-1',
        progress: 0,
        status: 'processing',
        message: '',
      }

      addTask('req-1', task)

      expect(tasks.value.size).toBe(1)
      expect(tasks.value.get('req-1')).toEqual(task)
    })

    it('可以同時新增多個任務', () => {
      const { tasks, addTask } = createTestTracker()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })
      addTask('req-2', { requestId: 'req-2', name: 'task-2', progress: 0, status: 'processing', message: '' })

      expect(tasks.value.size).toBe(2)
    })
  })

  describe('removeTask', () => {
    it('移除指定任務後 Map 中不應包含該任務', () => {
      const { tasks, addTask, removeTask } = createTestTracker()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })
      addTask('req-2', { requestId: 'req-2', name: 'task-2', progress: 0, status: 'processing', message: '' })

      removeTask('req-1')

      expect(tasks.value.size).toBe(1)
      expect(tasks.value.has('req-1')).toBe(false)
      expect(tasks.value.has('req-2')).toBe(true)
    })

    it('移除不存在的任務不應拋出錯誤', () => {
      const { removeTask } = createTestTracker()
      expect(() => removeTask('non-existent')).not.toThrow()
    })
  })

  describe('progressTasks computed', () => {
    it('應將 tasks 轉換為 ProgressTask 格式', () => {
      const { addTask, progressTasks } = createTestTracker()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 50, status: 'processing', message: '' })

      const progressTask = progressTasks.value.get('req-1')
      expect(progressTask).toBeDefined()
      expect(progressTask?.requestId).toBe('req-1')
      expect(progressTask?.title).toBe('task-1')
      expect(progressTask?.progress).toBe(50)
      expect(progressTask?.status).toBe('processing')
    })

    it('tasks 更新後 progressTasks 應自動重新計算', () => {
      const { tasks, addTask, progressTasks } = createTestTracker()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })
      expect(progressTasks.value.size).toBe(1)

      const task = tasks.value.get('req-1')!
      task.progress = 75
      expect(progressTasks.value.get('req-1')?.progress).toBe(75)
    })
  })

  describe('handleProgress - 收到進度事件', () => {
    it('已存在的任務應接收進度更新', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks, addTask } = createTestTracker()
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      simulateEvent(TEST_PROGRESS_EVENT, { requestId: 'req-1', progress: 60 })

      expect(tasks.value.get('req-1')?.progress).toBe(60)
    })

    it('不存在的任務應透過 createTask 自動建立', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks } = createTestTracker()
      await nextTick()

      simulateEvent(TEST_PROGRESS_EVENT, { requestId: 'auto-created', progress: 30 })

      expect(tasks.value.has('auto-created')).toBe(true)
      expect(tasks.value.get('auto-created')?.progress).toBe(30)
    })

    it('當 createTask 回傳 null 時不應建立任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks } = useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
        progressEvent: TEST_PROGRESS_EVENT,
        resultEvent: TEST_RESULT_EVENT,
        getRequestId: (payload) => payload.requestId,
        createTask: () => null,
        updateTask: (task, payload) => { task.progress = payload.progress },
        isProcessingStatus: (task) => task.status === 'processing',
        onResult: () => {},
        toProgressTask: (task) => ({
          requestId: task.requestId,
          title: task.name,
          progress: task.progress,
          message: '',
          status: 'processing',
        }),
      })
      await nextTick()

      simulateEvent(TEST_PROGRESS_EVENT, { requestId: 'no-create', progress: 50 })

      expect(tasks.value.has('no-create')).toBe(false)
    })

    it('非 processing 狀態的任務不應被進度事件更新', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks, addTask } = createTestTracker()
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 100, status: 'completed', message: '' })

      simulateEvent(TEST_PROGRESS_EVENT, { requestId: 'req-1', progress: 50 })

      expect(tasks.value.get('req-1')?.progress).toBe(100)
    })
  })

  describe('handleResult - 收到結果事件', () => {
    it('成功結果應更新任務狀態', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks, addTask } = createTestTracker()
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      simulateEvent(TEST_RESULT_EVENT, { requestId: 'req-1', success: true })
      await nextTick()

      expect(tasks.value.get('req-1')?.status).toBe('completed')
      expect(tasks.value.get('req-1')?.progress).toBe(100)
    })

    it('失敗結果應更新任務狀態', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks, addTask } = createTestTracker()
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      simulateEvent(TEST_RESULT_EVENT, { requestId: 'req-1', success: false })
      await nextTick()

      expect(tasks.value.get('req-1')?.status).toBe('failed')
    })

    it('requestId 不存在時結果事件不應影響任何任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks, addTask } = createTestTracker()
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      simulateEvent(TEST_RESULT_EVENT, { requestId: 'non-existent', success: true })
      await nextTick()

      expect(tasks.value.get('req-1')?.status).toBe('processing')
    })

    it('成功後應在 1 秒後自動移除任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks, addTask } = createTestTracker()
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      simulateEvent(TEST_RESULT_EVENT, { requestId: 'req-1', success: true })
      await nextTick()

      expect(tasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(1000)
      await nextTick()

      expect(tasks.value.has('req-1')).toBe(false)
    })

    it('失敗後應在 2 秒後自動移除任務', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { tasks, addTask } = createTestTracker()
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      simulateEvent(TEST_RESULT_EVENT, { requestId: 'req-1', success: false })
      await nextTick()

      expect(tasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(2000)
      await nextTick()

      expect(tasks.value.has('req-1')).toBe(false)
    })
  })

  describe('onTimeout - 逾時處理', () => {
    it('有 onTimeout 時，60 秒後應觸發逾時回呼', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const onTimeout = vi.fn()

      const { addTask } = useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
        progressEvent: TEST_PROGRESS_EVENT,
        resultEvent: TEST_RESULT_EVENT,
        getRequestId: (payload) => payload.requestId,
        createTask: () => null,
        updateTask: () => {},
        isProcessingStatus: (task) => task.status === 'processing',
        onResult: () => {},
        onTimeout,
        toProgressTask: (task) => ({
          requestId: task.requestId,
          title: task.name,
          progress: task.progress,
          message: '',
          status: 'processing',
        }),
      })
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      vi.advanceTimersByTime(60_000)

      expect(onTimeout).toHaveBeenCalledOnce()
    })

    it('已完成的任務不應觸發逾時', async () => {
      const onTimeout = vi.fn()

      const { addTask, tasks } = useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
        progressEvent: TEST_PROGRESS_EVENT,
        resultEvent: TEST_RESULT_EVENT,
        getRequestId: (payload) => payload.requestId,
        createTask: () => null,
        updateTask: () => {},
        isProcessingStatus: (task) => task.status === 'processing',
        onResult: () => {},
        onTimeout,
        toProgressTask: (task) => ({
          requestId: task.requestId,
          title: task.name,
          progress: task.progress,
          message: '',
          status: 'processing',
        }),
      })

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      const task = tasks.value.get('req-1')!
      task.status = 'completed'

      vi.advanceTimersByTime(60_000)

      expect(onTimeout).not.toHaveBeenCalled()
    })

    it('removeTask 應清除逾時計時器', async () => {
      const onTimeout = vi.fn()

      const { addTask, removeTask } = useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
        progressEvent: TEST_PROGRESS_EVENT,
        resultEvent: TEST_RESULT_EVENT,
        getRequestId: (payload) => payload.requestId,
        createTask: () => null,
        updateTask: () => {},
        isProcessingStatus: (task) => task.status === 'processing',
        onResult: () => {},
        onTimeout,
        toProgressTask: (task) => ({
          requestId: task.requestId,
          title: task.name,
          progress: task.progress,
          message: '',
          status: 'processing',
        }),
      })

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })
      removeTask('req-1')

      vi.advanceTimersByTime(60_000)

      expect(onTimeout).not.toHaveBeenCalled()
    })

    it('不傳入 onTimeout 時，逾時應將任務狀態設為 failed', async () => {
      const { tasks, addTask } = useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
        progressEvent: TEST_PROGRESS_EVENT,
        resultEvent: TEST_RESULT_EVENT,
        getRequestId: (payload) => payload.requestId,
        createTask: () => null,
        updateTask: () => {},
        isProcessingStatus: (task) => task.status === 'processing',
        onResult: () => {},
        toProgressTask: (task) => ({
          requestId: task.requestId,
          title: task.name,
          progress: task.progress,
          message: '',
          status: task.status === 'processing' ? 'processing' : task.status,
        }),
      })

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      vi.advanceTimersByTime(60_000)

      expect(tasks.value.get('req-1')?.status).toBe('failed')
    })

    it('不傳入 onTimeout 時，逾時後應觸發 scheduleRemove（任務在 2 秒後被移除）', async () => {
      const { tasks, addTask } = useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
        progressEvent: TEST_PROGRESS_EVENT,
        resultEvent: TEST_RESULT_EVENT,
        getRequestId: (payload) => payload.requestId,
        createTask: () => null,
        updateTask: () => {},
        isProcessingStatus: (task) => task.status === 'processing',
        onResult: () => {},
        toProgressTask: (task) => ({
          requestId: task.requestId,
          title: task.name,
          progress: task.progress,
          message: '',
          status: task.status === 'processing' ? 'processing' : task.status,
        }),
      })

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })

      vi.advanceTimersByTime(60_000)
      expect(tasks.value.has('req-1')).toBe(true)

      vi.advanceTimersByTime(2_000)
      await nextTick()

      expect(tasks.value.has('req-1')).toBe(false)
    })
  })

  describe('WebSocket 監聽器管理', () => {
    it('連線狀態為 connected 時應自動註冊監聽器', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'disconnected'

      createTestTracker()

      expect(mockWebSocketClient.on).not.toHaveBeenCalled()

      chatStore.connectionStatus = 'connected'
      await nextTick()

      expect(mockWebSocketClient.on).toHaveBeenCalledWith(TEST_PROGRESS_EVENT, expect.any(Function))
      expect(mockWebSocketClient.on).toHaveBeenCalledWith(TEST_RESULT_EVENT, expect.any(Function))
    })

    it('cleanupListeners 應移除所有監聽器', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { cleanupListeners } = createTestTracker()
      await nextTick()

      cleanupListeners()

      expect(mockWebSocketClient.off).toHaveBeenCalledWith(TEST_PROGRESS_EVENT, expect.any(Function))
      expect(mockWebSocketClient.off).toHaveBeenCalledWith(TEST_RESULT_EVENT, expect.any(Function))
    })

    it('重複呼叫 setupListeners 應只註冊一次', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { setupListeners } = createTestTracker()
      await nextTick()

      mockWebSocketClient.on.mockClear()

      setupListeners()

      expect(mockWebSocketClient.on).not.toHaveBeenCalled()
    })

    it('cleanupListeners 後 listenersRegistered 應重設，可再次 setup', async () => {
      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { setupListeners, cleanupListeners } = createTestTracker()
      await nextTick()

      cleanupListeners()
      mockWebSocketClient.on.mockClear()

      setupListeners()

      expect(mockWebSocketClient.on).toHaveBeenCalledTimes(2)
    })

    it('cleanupListeners 應清除所有逾時計時器', async () => {
      const onTimeout = vi.fn()

      const chatStore = useChatStore()
      chatStore.connectionStatus = 'connected'

      const { addTask, cleanupListeners } = useProgressTracker<TestTask, TestProgressPayload, TestResultPayload>({
        progressEvent: TEST_PROGRESS_EVENT,
        resultEvent: TEST_RESULT_EVENT,
        getRequestId: (payload) => payload.requestId,
        createTask: () => null,
        updateTask: () => {},
        isProcessingStatus: (task) => task.status === 'processing',
        onResult: () => {},
        onTimeout,
        toProgressTask: (task) => ({
          requestId: task.requestId,
          title: task.name,
          progress: task.progress,
          message: '',
          status: 'processing',
        }),
      })
      await nextTick()

      addTask('req-1', { requestId: 'req-1', name: 'task-1', progress: 0, status: 'processing', message: '' })
      addTask('req-2', { requestId: 'req-2', name: 'task-2', progress: 0, status: 'processing', message: '' })

      cleanupListeners()

      vi.advanceTimersByTime(60_000)

      expect(onTimeout).not.toHaveBeenCalled()
    })
  })
})
