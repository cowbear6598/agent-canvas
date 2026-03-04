import { type Ref, type ComputedRef } from 'vue'
import { WebSocketResponseEvents } from '@/types/websocket'
import type { RepositoryCheckoutBranchProgressPayload, RepositoryBranchCheckedOutPayload } from '@/types/websocket'
import { useCanvasContext } from '@/composables/canvas/useCanvasContext'
import { useProgressTracker, handleProgressError, markTaskCompleted } from '@/composables/canvas/useProgressTracker'
import type { ProgressTask } from '@/components/canvas/ProgressNote.vue'
import { PROGRESS_REMOVE_DELAY_MS } from '@/lib/constants'

export type CheckoutStatus = 'checking-out' | 'completed' | 'failed'

export interface CheckoutTask {
  requestId: string
  branchName: string
  repositoryId: string
  progress: number
  message: string
  status: CheckoutStatus
}

interface UseCheckoutProgressReturn {
  checkoutTasks: Ref<Map<string, CheckoutTask>>
  progressTasks: ComputedRef<Map<string, ProgressTask>>
  addTask: (requestId: string, branchName: string, repositoryId: string) => void
  removeTask: (requestId: string) => void
  setupListeners: () => void
  cleanupListeners: () => void
}

export function useCheckoutProgress(): UseCheckoutProgressReturn {
  const { repositoryStore } = useCanvasContext()

  const tracker = useProgressTracker<
    CheckoutTask,
    RepositoryCheckoutBranchProgressPayload,
    RepositoryBranchCheckedOutPayload
  >({
    progressEvent: WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS,
    resultEvent: WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,

    getRequestId: (payload) => payload.requestId,

    createTask: (payload) => ({
      requestId: payload.requestId,
      branchName: payload.branchName,
      repositoryId: '',
      progress: 0,
      message: '準備切換分支...',
      status: 'checking-out',
    }),

    updateTask: (task, payload) => {
      task.progress = payload.progress
      task.message = payload.message
    },

    isProcessingStatus: (task) => task.status === 'checking-out',

    onResult: (task, payload, helpers) => {
      if (payload.success && payload.branchName && payload.repositoryId) {
        markTaskCompleted(task, '切換完成')

        const existingRepository = repositoryStore.typedAvailableItems.find(
          (item) => item.id === payload.repositoryId
        )
        if (existingRepository) {
          existingRepository.currentBranch = payload.branchName
        }

        helpers.showSuccessToast('Git', '切換分支成功', payload.branchName)

        helpers.scheduleRemove(payload.requestId, PROGRESS_REMOVE_DELAY_MS)
      } else {
        handleProgressError(task, helpers, payload.requestId, payload.error, {
          category: 'Git',
          action: '切換分支失敗',
          defaultMessage: '切換分支失敗',
        })
      }
    },

    toProgressTask: (task) => ({
      requestId: task.requestId,
      title: task.branchName,
      progress: task.progress,
      message: task.message,
      status: task.status === 'checking-out' ? 'processing' : task.status,
    }),
  })

  const addTask = (requestId: string, branchName: string, repositoryId: string): void => {
    tracker.addTask(requestId, {
      requestId,
      branchName,
      repositoryId,
      progress: 0,
      message: '準備切換分支...',
      status: 'checking-out',
    })
  }

  return {
    checkoutTasks: tracker.tasks,
    progressTasks: tracker.progressTasks,
    addTask,
    removeTask: tracker.removeTask,
    setupListeners: tracker.setupListeners,
    cleanupListeners: tracker.cleanupListeners,
  }
}
