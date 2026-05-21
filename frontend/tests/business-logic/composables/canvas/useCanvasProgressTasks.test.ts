import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia } from 'pinia'
import { setupStoreTest } from '@tests/helpers/testSetup'
import { webSocketMockFactory } from '@tests/helpers/mockWebSocket'
import type { ProgressTask } from '@/components/canvas/ProgressNote.vue'

vi.mock('@/services/websocket', () => webSocketMockFactory())

vi.mock('@/components/canvas/ProgressNote.vue', () => ({
  default: {},
}))

const mockCloneTasks = ref(new Map<string, ProgressTask>())
const mockCheckoutTasks = ref(new Map<string, ProgressTask>())
const mockPullTasks = ref(new Map<string, ProgressTask>())

const mockAddCloneTask = vi.fn((requestId: string, repoName: string) => {
  mockCloneTasks.value.set(requestId, {
    requestId,
    title: repoName,
    progress: 0,
    status: 'processing',
    message: '開始下載...',
  })
})

const mockAddPullTask = vi.fn((requestId: string, repositoryName: string) => {
  mockPullTasks.value.set(requestId, {
    requestId,
    title: repositoryName,
    progress: 0,
    status: 'processing',
    message: '準備 Pull...',
  })
})

vi.mock('@/composables/canvas/useGitCloneProgress', () => ({
  useGitCloneProgress: () => ({
    progressTasks: mockCloneTasks,
    addTask: mockAddCloneTask,
    cleanupListeners: vi.fn(),
  }),
}))

vi.mock('@/composables/canvas/useCheckoutProgress', () => ({
  useCheckoutProgress: () => ({
    progressTasks: mockCheckoutTasks,
    cleanupListeners: vi.fn(),
  }),
}))

vi.mock('@/composables/canvas/usePullProgress', () => ({
  usePullProgress: () => ({
    progressTasks: mockPullTasks,
    addTask: mockAddPullTask,
    cleanupListeners: vi.fn(),
  }),
}))

vi.mock('@/composables/canvas', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/composables/canvas')>()
  return {
    ...original,
    useGitCloneProgress: () => ({
      progressTasks: mockCloneTasks,
      addTask: mockAddCloneTask,
      cleanupListeners: vi.fn(),
    }),
    useCheckoutProgress: () => ({
      progressTasks: mockCheckoutTasks,
      cleanupListeners: vi.fn(),
    }),
    usePullProgress: () => ({
      progressTasks: mockPullTasks,
      addTask: mockAddPullTask,
      cleanupListeners: vi.fn(),
    }),
  }
})

import { useCanvasProgressTasks } from '@/composables/canvas/useCanvasProgressTasks'

describe('useCanvasProgressTasks', () => {
  setupStoreTest(() => {
    mockCloneTasks.value = new Map()
    mockCheckoutTasks.value = new Map()
    mockPullTasks.value = new Map()
    mockAddCloneTask.mockClear()
    mockAddPullTask.mockClear()
  })

  describe('handleCloneStarted', () => {
    it('呼叫後 allProgressTasks 應包含新 task', () => {
      const { allProgressTasks, handleCloneStarted } = useCanvasProgressTasks()

      handleCloneStarted({ requestId: 'req-clone-1', repoName: 'my-repo' })

      expect(allProgressTasks.value.has('req-clone-1')).toBe(true)
      expect(allProgressTasks.value.get('req-clone-1')?.title).toBe('my-repo')
    })
  })

  describe('handlePullStarted', () => {
    it('呼叫後 allProgressTasks 應包含新 task', () => {
      const { allProgressTasks, handlePullStarted } = useCanvasProgressTasks()

      handlePullStarted({ requestId: 'req-pull-1', repositoryName: 'pull-repo', repositoryId: 'repo-id-1' })

      expect(allProgressTasks.value.has('req-pull-1')).toBe(true)
      expect(allProgressTasks.value.get('req-pull-1')?.title).toBe('pull-repo')
    })
  })

  describe('allProgressTasks', () => {
    it('應合併三個來源的 tasks', () => {
      const { allProgressTasks, handleCloneStarted, handlePullStarted } = useCanvasProgressTasks()

      handleCloneStarted({ requestId: 'clone-1', repoName: 'clone-repo' })
      handlePullStarted({ requestId: 'pull-1', repositoryName: 'pull-repo', repositoryId: 'id-1' })

      mockCheckoutTasks.value.set('checkout-1', {
        requestId: 'checkout-1',
        title: 'checkout-repo',
        progress: 0,
        status: 'processing',
        message: '切換中...',
      })

      expect(allProgressTasks.value.size).toBe(3)
      expect(allProgressTasks.value.has('clone-1')).toBe(true)
      expect(allProgressTasks.value.has('pull-1')).toBe(true)
      expect(allProgressTasks.value.has('checkout-1')).toBe(true)
    })
  })
})
