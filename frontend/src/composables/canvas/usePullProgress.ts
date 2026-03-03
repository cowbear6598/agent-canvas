import { type Ref, type ComputedRef } from 'vue'
import { WebSocketResponseEvents } from '@/types/websocket'
import type { RepositoryPullLatestProgressPayload, RepositoryPullLatestResultPayload } from '@/types/websocket'
import { useCanvasContext } from '@/composables/canvas/useCanvasContext'
import { useProgressTracker, handleProgressError } from '@/composables/canvas/useProgressTracker'
import type { ProgressTask } from '@/components/canvas/ProgressNote.vue'
import { PROGRESS_REMOVE_DELAY_MS } from '@/lib/constants'

export type PullStatus = 'pulling' | 'completed' | 'failed'

export interface PullTask {
  requestId: string
  repositoryName: string
  repositoryId: string
  progress: number
  message: string
  status: PullStatus
  timedOut: boolean
}

interface UsePullProgressReturn {
  pullTasks: Ref<Map<string, PullTask>>
  progressTasks: ComputedRef<Map<string, ProgressTask>>
  addTask: (requestId: string, repositoryName: string, repositoryId: string) => void
  removeTask: (requestId: string) => void
  setupListeners: () => void
  cleanupListeners: () => void
}

export function usePullProgress(): UsePullProgressReturn {
  const { repositoryStore } = useCanvasContext()

  const tracker = useProgressTracker<
    PullTask,
    RepositoryPullLatestProgressPayload,
    RepositoryPullLatestResultPayload
  >({
    progressEvent: WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS,
    resultEvent: WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,

    getRequestId: (payload) => payload.requestId,

    createTask: () => null,

    updateTask: (task, payload) => {
      task.progress = payload.progress
      task.message = payload.message
    },

    isProcessingStatus: (task) => task.status === 'pulling',

    onResult: async (task, payload, helpers) => {
      if (task.timedOut) return

      if (payload.success) {
        task.status = 'completed'
        task.progress = 100
        task.message = 'Pull 完成'

        await repositoryStore.loadRepositories()

        helpers.showSuccessToast('Git', 'Pull 成功', task.repositoryName)

        helpers.scheduleRemove(payload.requestId, PROGRESS_REMOVE_DELAY_MS)
      } else {
        handleProgressError(task, helpers, payload.requestId, payload.error, {
          category: 'Git',
          action: 'Pull 失敗',
          defaultMessage: 'Pull 失敗',
        })
      }
    },

    onTimeoutExtra: (task) => {
      task.timedOut = true
    },

    toProgressTask: (task) => ({
      requestId: task.requestId,
      title: task.repositoryName,
      progress: task.progress,
      message: task.message,
      status: task.status === 'pulling' ? 'processing' : task.status,
    }),
  })

  const addTask = (requestId: string, repositoryName: string, repositoryId: string): void => {
    tracker.addTask(requestId, {
      requestId,
      repositoryName,
      repositoryId,
      progress: 0,
      message: '準備 Pull...',
      status: 'pulling',
      timedOut: false,
    })
  }

  return {
    pullTasks: tracker.tasks,
    progressTasks: tracker.progressTasks,
    addTask,
    removeTask: tracker.removeTask,
    setupListeners: tracker.setupListeners,
    cleanupListeners: tracker.cleanupListeners,
  }
}
