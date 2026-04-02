import { type Ref, type ComputedRef } from 'vue'
import { WebSocketResponseEvents } from '@/types/websocket'
import type { RepositoryGitCloneProgressPayload, RepositoryGitCloneResultPayload } from '@/types/websocket'
import { useCanvasContext } from '@/composables/canvas/useCanvasContext'
import { useProgressTracker, handleProgressError, markTaskCompleted } from '@/composables/canvas/useProgressTracker'
import { t } from '@/i18n'
import type { ProgressTask } from '@/components/canvas/ProgressNote.vue'
import { PROGRESS_REMOVE_DELAY_MS } from '@/lib/constants'

export type CloneStatus = 'cloning' | 'completed' | 'failed'

export interface CloneTask {
  requestId: string
  repoName: string
  progress: number
  message: string
  status: CloneStatus
}

interface UseGitCloneProgressReturn {
  cloneTasks: Ref<Map<string, CloneTask>>
  progressTasks: ComputedRef<Map<string, ProgressTask>>
  addTask: (requestId: string, repoName: string) => void
  removeTask: (requestId: string) => void
  setupListeners: () => void
  cleanupListeners: () => void
}

/**
 * 將 Git Clone 錯誤轉換為用戶友善訊息
 *
 * 需要多層錯誤檢查的原因：
 * 1. 後端回傳的錯誤訊息格式不一致（有些是錯誤代碼，有些是描述文字）
 * 2. 需要處理大小寫差異（error.includes 與 lowerError.includes）
 * 3. 需要覆蓋多種可能的錯誤來源（網路、權限、檔案系統等）
 * 4. 優先檢查錯誤代碼（精確匹配），再檢查描述文字（模糊匹配）
 */
function getErrorMessage(error: string): string {
  const lowerError = error.toLowerCase()

  if (error.includes('ALREADY_EXISTS')) {
    return t('composable.gitClone.repoExists')
  }

  if (lowerError.includes('authentication') || lowerError.includes('401') || lowerError.includes('403')) {
    return t('composable.gitClone.authFailed')
  }

  if (lowerError.includes('not found') || lowerError.includes('404')) {
    return t('composable.gitClone.notFound')
  }

  if (lowerError.includes('network') || lowerError.includes('timeout')) {
    return t('composable.gitClone.networkFailed')
  }

  if (lowerError.includes('branch') || lowerError.includes('ref')) {
    return t('composable.gitClone.branchNotFound')
  }

  if (lowerError.includes('space') || lowerError.includes('disk')) {
    return t('composable.gitClone.diskFull')
  }

  return error
}

export function useGitCloneProgress(): UseGitCloneProgressReturn {
  const { repositoryStore } = useCanvasContext()

  const tracker = useProgressTracker<
    CloneTask,
    RepositoryGitCloneProgressPayload,
    RepositoryGitCloneResultPayload
  >({
    progressEvent: WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
    resultEvent: WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,

    getRequestId: (payload) => payload.requestId,

    createTask: () => null,

    updateTask: (task, payload) => {
      task.progress = payload.progress
      task.message = payload.message
    },

    isProcessingStatus: (task) => task.status === 'cloning',

    onResult: async (task, payload, helpers) => {
      if (payload.success) {
        markTaskCompleted(task, t('composable.gitClone.cloneCompleted'))

        helpers.showSuccessToast('Repository', t('composable.gitClone.cloneSuccess'), task.repoName)

        await repositoryStore.loadRepositories()

        helpers.scheduleRemove(payload.requestId, PROGRESS_REMOVE_DELAY_MS)
      } else {
        handleProgressError(task, helpers, payload.requestId, payload.error, {
          category: 'Repository',
          action: t('composable.gitClone.cloneFailed'),
          defaultMessage: t('composable.gitClone.cloneFailed'),
        }, getErrorMessage)
      }
    },

    toProgressTask: (task) => ({
      requestId: task.requestId,
      title: task.repoName,
      progress: task.progress,
      message: task.message,
      status: task.status === 'cloning' ? 'processing' : task.status,
    }),
  })

  const addTask = (requestId: string, repoName: string): void => {
    tracker.addTask(requestId, {
      requestId,
      repoName,
      progress: 0,
      message: t('composable.gitClone.cloneStarted'),
      status: 'cloning',
    })
  }

  return {
    cloneTasks: tracker.tasks,
    progressTasks: tracker.progressTasks,
    addTask,
    removeTask: tracker.removeTask,
    setupListeners: tracker.setupListeners,
    cleanupListeners: tracker.cleanupListeners,
  }
}
