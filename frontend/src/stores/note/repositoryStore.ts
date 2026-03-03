import type { Repository, RepositoryNote } from '@/types'
import { createNoteStore } from './createNoteStore'
import type { NoteStoreContext } from './createNoteStore'
import { websocketClient, WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import { useCanvasWebSocketAction } from '@/composables/useCanvasWebSocketAction'
import { requireActiveCanvas } from '@/utils/canvasGuard'
import { useToast } from '@/composables/useToast'
import { generateRequestId } from '@/services/utils'
import type {
  RepositoryCreatePayload,
  RepositoryCreatedPayload,
  RepositoryCheckGitPayload,
  RepositoryCheckGitResultPayload,
  RepositoryWorktreeCreatePayload,
  RepositoryWorktreeCreatedPayload,
  RepositoryGetLocalBranchesPayload,
  RepositoryLocalBranchesResultPayload,
  RepositoryCheckDirtyPayload,
  RepositoryDirtyCheckResultPayload,
  RepositoryCheckoutBranchPayload,
  RepositoryDeleteBranchPayload,
  RepositoryBranchDeletedPayload,
  RepositoryPullLatestPayload
} from '@/types/websocket'

interface RepositoryStoreCustomActions {
  createRepository(name: string): Promise<{ success: boolean; repository?: { id: string; name: string }; error?: string }>
  deleteRepository(repositoryId: string): Promise<void>
  loadRepositories(): Promise<void>
  checkIsGit(repositoryId: string): Promise<boolean>
  createWorktree(repositoryId: string, worktreeName: string, sourceNotePosition: { x: number; y: number }): Promise<{ success: boolean; error?: string }>
  getLocalBranches(repositoryId: string): Promise<{ success: boolean; branches?: string[]; currentBranch?: string; worktreeBranches?: string[]; error?: string }>
  checkDirty(repositoryId: string): Promise<{ success: boolean; isDirty?: boolean; error?: string }>
  checkoutBranch(repositoryId: string, branchName: string, force?: boolean): Promise<{ requestId: string }>
  deleteBranch(repositoryId: string, branchName: string): Promise<{ success: boolean; branchName?: string; error?: string }>
  pullLatest(repositoryId: string): Promise<{ requestId: string }>
  isWorktree(repositoryId: string): boolean
}

function toFailure(error: string): { success: false; error: string } {
  return { success: false, error }
}

function createRepositoryCustomActions(): RepositoryStoreCustomActions {
  return {
    async createRepository(this: NoteStoreContext<Repository>, name: string): Promise<{ success: boolean; repository?: { id: string; name: string }; error?: string }> {
      const { executeAction } = useCanvasWebSocketAction()
      const { showSuccessToast, showErrorToast } = useToast()

      const result = await executeAction<RepositoryCreatePayload, RepositoryCreatedPayload>(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_CREATE,
          responseEvent: WebSocketResponseEvents.REPOSITORY_CREATED,
          payload: { name },
        },
        { errorCategory: 'Repository', errorAction: '建立失敗', errorMessage: '建立資料夾失敗' }
      )

      if (!result.success) return toFailure(result.error)

      if (!result.data.repository) {
        const error = result.data.error || '建立資料夾失敗'
        showErrorToast('Repository', '建立失敗', error)
        return { success: false, error }
      }

      this.availableItems.push(result.data.repository)
      showSuccessToast('Repository', '建立成功', name)
      return { success: true, repository: result.data.repository }
    },

    async deleteRepository(this: NoteStoreContext<Repository>, repositoryId: string): Promise<void> {
      return this.deleteItem(repositoryId)
    },

    async loadRepositories(this: NoteStoreContext<Repository>): Promise<void> {
      return this.loadItems()
    },

    async checkIsGit(this: NoteStoreContext<Repository>, repositoryId: string): Promise<boolean> {
      const { executeAction } = useCanvasWebSocketAction()

      const result = await executeAction<RepositoryCheckGitPayload, RepositoryCheckGitResultPayload>(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_CHECK_GIT,
          responseEvent: WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
          payload: { repositoryId },
        },
        { errorCategory: 'Repository', errorAction: '檢查 Git 狀態失敗', errorMessage: '檢查 Git 狀態失敗' }
      )

      if (!result.success || !result.data.success) return false

      const existingRepository = this.availableItems.find((item: Repository) => item.id === repositoryId)
      if (existingRepository) {
        existingRepository.isGit = result.data.isGit
      }

      return result.data.isGit
    },

    async createWorktree(this: NoteStoreContext<Repository>, repositoryId: string, worktreeName: string, sourceNotePosition: { x: number; y: number }): Promise<{ success: boolean; error?: string }> {
      const { executeAction } = useCanvasWebSocketAction()
      const { showSuccessToast, showErrorToast } = useToast()

      const result = await executeAction<RepositoryWorktreeCreatePayload, RepositoryWorktreeCreatedPayload>(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
          responseEvent: WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
          payload: { repositoryId, worktreeName },
        },
        { errorCategory: 'Repository', errorAction: 'Worktree 建立失敗', errorMessage: '建立 Worktree 失敗' }
      )

      if (!result.success) return toFailure(result.error)

      if (!result.data.success) {
        const error = result.data.error || '建立 Worktree 失敗'
        showErrorToast('Repository', 'Worktree 建立失敗', error)
        return { success: false, error }
      }

      if (result.data.repository) {
        this.availableItems.push(result.data.repository)

        await this.createNote(
          result.data.repository.id,
          sourceNotePosition.x + 150,
          sourceNotePosition.y + 80
        )
      }

      showSuccessToast('Repository', 'Worktree 建立成功', worktreeName)
      return { success: true }
    },

    async getLocalBranches(this: NoteStoreContext<Repository>, repositoryId: string): Promise<{ success: boolean; branches?: string[]; currentBranch?: string; worktreeBranches?: string[]; error?: string }> {
      const { executeAction } = useCanvasWebSocketAction()

      const result = await executeAction<RepositoryGetLocalBranchesPayload, RepositoryLocalBranchesResultPayload>(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
          responseEvent: WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
          payload: { repositoryId },
        },
        { errorCategory: 'Git', errorAction: '取得分支列表失敗', errorMessage: '取得分支列表失敗' }
      )

      if (!result.success) return toFailure(result.error)

      return {
        success: result.data.success,
        branches: result.data.branches,
        currentBranch: result.data.currentBranch,
        worktreeBranches: result.data.worktreeBranches,
        error: result.data.error,
      }
    },

    async checkDirty(this: NoteStoreContext<Repository>, repositoryId: string): Promise<{ success: boolean; isDirty?: boolean; error?: string }> {
      const { executeAction } = useCanvasWebSocketAction()

      const result = await executeAction<RepositoryCheckDirtyPayload, RepositoryDirtyCheckResultPayload>(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_CHECK_DIRTY,
          responseEvent: WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT,
          payload: { repositoryId },
        },
        { errorCategory: 'Git', errorAction: '檢查修改狀態失敗', errorMessage: '檢查修改狀態失敗' }
      )

      if (!result.success) return toFailure(result.error)

      return {
        success: result.data.success,
        isDirty: result.data.isDirty,
        error: result.data.error,
      }
    },

    async checkoutBranch(this: NoteStoreContext<Repository>, repositoryId: string, branchName: string, force: boolean = false): Promise<{ requestId: string }> {
      const canvasId = requireActiveCanvas()
      const requestId = generateRequestId()

      websocketClient.emit<RepositoryCheckoutBranchPayload>(
        WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
        {
          requestId,
          canvasId,
          repositoryId,
          branchName,
          force
        }
      )

      return { requestId }
    },

    async deleteBranch(this: NoteStoreContext<Repository>, repositoryId: string, branchName: string): Promise<{ success: boolean; branchName?: string; error?: string }> {
      const { executeAction } = useCanvasWebSocketAction()
      const { showSuccessToast, showErrorToast } = useToast()

      const result = await executeAction<RepositoryDeleteBranchPayload, RepositoryBranchDeletedPayload>(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_DELETE_BRANCH,
          responseEvent: WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED,
          payload: { repositoryId, branchName, force: true },
        },
        { errorCategory: 'Git', errorAction: '刪除分支失敗', errorMessage: '刪除分支失敗' }
      )

      if (!result.success) return toFailure(result.error)

      if (result.data.success) {
        showSuccessToast('Git', '刪除分支成功', branchName)
      } else if (result.data.error) {
        showErrorToast('Git', '刪除分支失敗', result.data.error)
      }

      return {
        success: result.data.success,
        branchName: result.data.branchName,
        error: result.data.error,
      }
    },

    async pullLatest(this: NoteStoreContext<Repository>, repositoryId: string): Promise<{ requestId: string }> {
      const canvasId = requireActiveCanvas()
      const requestId = generateRequestId()

      websocketClient.emit<RepositoryPullLatestPayload>(
        WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
        {
          requestId,
          canvasId,
          repositoryId
        }
      )

      return { requestId }
    },

    isWorktree(this: NoteStoreContext<Repository>, repositoryId: string): boolean {
      const repository = this.availableItems.find((item: Repository) => item.id === repositoryId)
      return !!repository?.parentRepoId
    },
  }
}

const store = createNoteStore<Repository, RepositoryNote>({
  storeName: 'repository',
  relationship: 'one-to-one',
  responseItemsKey: 'repositories',
  itemIdField: 'repositoryId',
  events: {
    listItems: {
      request: WebSocketRequestEvents.REPOSITORY_LIST,
      response: WebSocketResponseEvents.REPOSITORY_LIST_RESULT,
    },
    listNotes: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_LIST,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT,
    },
    createNote: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_CREATE,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
    },
    updateNote: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_UPDATE,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
    },
    deleteNote: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_DELETE,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
    },
  },
  bindEvents: {
    request: WebSocketRequestEvents.POD_BIND_REPOSITORY,
    response: WebSocketResponseEvents.POD_REPOSITORY_BOUND,
  },
  unbindEvents: {
    request: WebSocketRequestEvents.POD_UNBIND_REPOSITORY,
    response: WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
  },
  deleteItemEvents: {
    request: WebSocketRequestEvents.REPOSITORY_DELETE,
    response: WebSocketResponseEvents.REPOSITORY_DELETED,
  },
  createNotePayload: (item: Repository) => ({
    repositoryId: item.id,
  }),
  customActions: createRepositoryCustomActions(),
})

export const useRepositoryStore: (() => ReturnType<typeof store> & RepositoryStoreCustomActions) & { $id: string } = store as (() => ReturnType<typeof store> & RepositoryStoreCustomActions) & { $id: string }
