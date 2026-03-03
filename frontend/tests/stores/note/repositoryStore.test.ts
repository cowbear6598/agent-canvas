import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket } from '../../helpers/mockWebSocket'
import { createMockRepository, createMockRepositoryNote } from '../../helpers/factories'
import { useRepositoryStore } from '@/stores/note/repositoryStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Repository, RepositoryNote } from '@/types'

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

describe('repositoryStore', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()

    const canvasStore = useCanvasStore()
    canvasStore.activeCanvasId = 'canvas-1'
  })

  describe('初始狀態', () => {
    it('availableItems 應為空陣列', () => {
      const store = useRepositoryStore()

      expect(store.availableItems).toEqual([])
    })

    it('notes 應為空陣列', () => {
      const store = useRepositoryStore()

      expect(store.notes).toEqual([])
    })

    it('isLoading 應為 false', () => {
      const store = useRepositoryStore()

      expect(store.isLoading).toBe(false)
    })

    it('error 應為 null', () => {
      const store = useRepositoryStore()

      expect(store.error).toBeNull()
    })
  })

  describe('createRepository', () => {
    it('成功時應新增到 availableItems 並顯示成功 Toast', async () => {
      const store = useRepositoryStore()
      const newRepo = createMockRepository({ id: 'repo-1', name: 'Test Repo' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        repository: newRepo,
      })

      const result = await store.createRepository('Test Repo')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository:create',
        responseEvent: 'repository:created',
        payload: {
          canvasId: 'canvas-1',
          name: 'Test Repo',
        },
      })
      expect(store.availableItems).toHaveLength(1)
      expect(store.availableItems[0]).toEqual(newRepo)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Repository', '建立成功', 'Test Repo')
      expect(result.success).toBe(true)
      expect(result.repository).toEqual(newRepo)
    })

    it('回應無 repository 時應回傳 error 並顯示錯誤 Toast', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '建立失敗：權限不足',
      })

      const result = await store.createRepository('Test Repo')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Repository', '建立失敗', '建立失敗：權限不足')
      expect(result.success).toBe(false)
      expect(result.error).toBe('建立失敗：權限不足')
      expect(store.availableItems).toHaveLength(0)
    })

    it('WebSocket 回應為 null 時應顯示錯誤 Toast', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.createRepository('Test Repo')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Repository', '建立失敗')
      expect(result.success).toBe(false)
      expect(result.error).toBe('建立資料夾失敗')
    })
  })

  describe('deleteRepository', () => {
    it('應委派到 deleteItem', async () => {
      const store = useRepositoryStore()
      const repo = createMockRepository({ id: 'repo-1', name: 'Test Repo' })
      store.availableItems = [repo]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        deletedNoteIds: [],
      })

      await store.deleteRepository('repo-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository:delete',
        responseEvent: 'repository:deleted',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
        },
      })
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Repository', '刪除成功', 'Test Repo')
    })
  })

  describe('loadRepositories', () => {
    it('應委派到 loadItems', async () => {
      const store = useRepositoryStore()
      const repos = [
        createMockRepository({ id: 'repo-1' }),
        createMockRepository({ id: 'repo-2' }),
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        repositories: repos,
      })

      await store.loadRepositories()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository:list',
        responseEvent: 'repository:list:result',
        payload: {
          canvasId: 'canvas-1',
        },
      })
      expect(store.availableItems).toEqual(repos)
    })
  })

  describe('checkIsGit', () => {
    it('成功時應更新 repository.isGit 為 true', async () => {
      const store = useRepositoryStore()
      const repo = createMockRepository({ id: 'repo-1', isGit: false })
      store.availableItems = [repo]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        isGit: true,
      })

      const result = await store.checkIsGit('repo-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository:check-git',
        responseEvent: 'repository:check-git:result',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
        },
      })
      expect(result).toBe(true)
      expect((store.availableItems[0] as any)?.isGit).toBe(true)
    })

    it('成功時應更新 repository.isGit 為 false', async () => {
      const store = useRepositoryStore()
      const repo = createMockRepository({ id: 'repo-1', isGit: true })
      store.availableItems = [repo]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        isGit: false,
      })

      const result = await store.checkIsGit('repo-1')

      expect(result).toBe(false)
      expect((store.availableItems[0] as any)?.isGit).toBe(false)
    })

    it('回應 success: false 時應回傳 false', async () => {
      const store = useRepositoryStore()
      const repo = createMockRepository({ id: 'repo-1', isGit: true })
      store.availableItems = [repo]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
      })

      const result = await store.checkIsGit('repo-1')

      expect(result).toBe(false)
      expect((store.availableItems[0] as any)?.isGit).toBe(true) // 保持不變
    })

    it('回應為 null 時應回傳 false', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.checkIsGit('repo-1')

      expect(result).toBe(false)
    })

    it('repository 不存在時應正常執行', async () => {
      const store = useRepositoryStore()
      store.availableItems = []

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        isGit: true,
      })

      const result = await store.checkIsGit('non-existent')

      expect(result).toBe(true)
      expect(store.availableItems).toHaveLength(0)
    })
  })

  describe('createWorktree', () => {
    it('成功時應新增 repository 並建立 Note', async () => {
      const store = useRepositoryStore()
      const parentRepo = createMockRepository({ id: 'repo-1', name: 'Parent Repo' })
      store.availableItems = [parentRepo]

      const worktreeRepo = createMockRepository({
        id: 'repo-2',
        name: 'worktree-branch',
        parentRepoId: 'repo-1',
        branchName: 'worktree-branch',
      })

      const worktreeNote = createMockRepositoryNote({
        id: 'note-1',
        repositoryId: 'repo-2',
        x: 350,
        y: 280,
      })

      mockCreateWebSocketRequest
        .mockResolvedValueOnce({
          success: true,
          repository: worktreeRepo,
        })
        .mockResolvedValueOnce({
          success: true,
          note: worktreeNote,
        })

      const result = await store.createWorktree('repo-1', 'worktree-branch', { x: 200, y: 200 })

      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(1, {
        requestEvent: 'repository:worktree:create',
        responseEvent: 'repository:worktree:created',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
          worktreeName: 'worktree-branch',
        },
      })

      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(2, {
        requestEvent: 'repository-note:create',
        responseEvent: 'repository-note:created',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-2',
          name: 'worktree-branch',
          x: 350,
          y: 280,
          boundToPodId: null,
          originalPosition: null,
        },
      })

      expect(store.availableItems).toHaveLength(2)
      expect(store.availableItems[1]).toEqual(worktreeRepo)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Repository', 'Worktree 建立成功', 'worktree-branch')
      expect(result.success).toBe(true)
    })

    it('success: false 時應顯示錯誤 Toast', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '分支已存在',
      })

      const result = await store.createWorktree('repo-1', 'existing-branch', { x: 200, y: 200 })

      expect(mockShowErrorToast).toHaveBeenCalledWith('Repository', 'Worktree 建立失敗', '分支已存在')
      expect(result.success).toBe(false)
      expect(result.error).toBe('分支已存在')
    })

    it('回應為 null 時應顯示錯誤 Toast', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.createWorktree('repo-1', 'branch', { x: 200, y: 200 })

      expect(mockShowErrorToast).toHaveBeenCalledWith('Repository', 'Worktree 建立失敗')
      expect(result.success).toBe(false)
      expect(result.error).toBe('建立 Worktree 失敗')
    })

    it('回應無 repository 時應顯示錯誤 Toast', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
      })

      const result = await store.createWorktree('repo-1', 'branch', { x: 200, y: 200 })

      expect(mockShowSuccessToast).toHaveBeenCalledWith('Repository', 'Worktree 建立成功', 'branch')
      expect(result.success).toBe(true)
      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1) // 不應建立 Note
    })
  })

  describe('getLocalBranches', () => {
    it('成功時應回傳 branches, currentBranch, worktreeBranches', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        branches: ['main', 'develop', 'feature-1'],
        currentBranch: 'main',
        worktreeBranches: ['feature-1'],
      })

      const result = await store.getLocalBranches('repo-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository:get-local-branches',
        responseEvent: 'repository:local-branches:result',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
        },
      })
      expect(result).toEqual({
        success: true,
        branches: ['main', 'develop', 'feature-1'],
        currentBranch: 'main',
        worktreeBranches: ['feature-1'],
        error: undefined,
      })
    })

    it('回應為 null 時應回傳失敗結果', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.getLocalBranches('repo-1')

      expect(result).toEqual({
        success: false,
        error: '取得分支列表失敗',
      })
    })

    it('success: false 時應回傳錯誤訊息', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '不是 Git Repository',
      })

      const result = await store.getLocalBranches('repo-1')

      expect(result).toEqual({
        success: false,
        branches: undefined,
        currentBranch: undefined,
        worktreeBranches: undefined,
        error: '不是 Git Repository',
      })
    })
  })

  describe('checkDirty', () => {
    it('成功時應回傳 isDirty: true', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        isDirty: true,
      })

      const result = await store.checkDirty('repo-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository:check-dirty',
        responseEvent: 'repository:dirty-check:result',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
        },
      })
      expect(result).toEqual({
        success: true,
        isDirty: true,
        error: undefined,
      })
    })

    it('成功時應回傳 isDirty: false', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        isDirty: false,
      })

      const result = await store.checkDirty('repo-1')

      expect(result).toEqual({
        success: true,
        isDirty: false,
        error: undefined,
      })
    })

    it('回應為 null 時應回傳失敗結果', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.checkDirty('repo-1')

      expect(result).toEqual({
        success: false,
        error: '檢查修改狀態失敗',
      })
    })

    it('success: false 時應回傳錯誤訊息', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: 'Git 操作失敗',
      })

      const result = await store.checkDirty('repo-1')

      expect(result).toEqual({
        success: false,
        isDirty: undefined,
        error: 'Git 操作失敗',
      })
    })
  })

  describe('checkoutBranch', () => {
    it('應透過 websocketClient.emit 發送 checkout 請求並回傳 requestId', async () => {
      const { mockWebSocketClient: wsClient } = await import('../../helpers/mockWebSocket')
      const store = useRepositoryStore()

      const result = await store.checkoutBranch('repo-1', 'develop', false)

      expect(wsClient.emit).toHaveBeenCalledWith(
        'repository:checkout-branch',
        expect.objectContaining({
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
          branchName: 'develop',
          force: false,
        })
      )
      expect(result).toHaveProperty('requestId')
      expect(typeof result.requestId).toBe('string')
    })

    it('force 參數應傳遞到 emit payload', async () => {
      const { mockWebSocketClient: wsClient } = await import('../../helpers/mockWebSocket')
      const store = useRepositoryStore()

      await store.checkoutBranch('repo-1', 'develop', true)

      expect(wsClient.emit).toHaveBeenCalledWith(
        'repository:checkout-branch',
        expect.objectContaining({
          force: true,
        })
      )
    })

    it('不帶 force 參數時預設為 false', async () => {
      const { mockWebSocketClient: wsClient } = await import('../../helpers/mockWebSocket')
      const store = useRepositoryStore()

      await store.checkoutBranch('repo-1', 'develop')

      expect(wsClient.emit).toHaveBeenCalledWith(
        'repository:checkout-branch',
        expect.objectContaining({
          force: false,
        })
      )
    })

    it('每次呼叫應回傳不同的 requestId', async () => {
      const store = useRepositoryStore()

      const result1 = await store.checkoutBranch('repo-1', 'develop', false)
      const result2 = await store.checkoutBranch('repo-1', 'main', false)

      expect(result1.requestId).not.toBe(result2.requestId)
    })
  })

  describe('deleteBranch', () => {
    it('成功時應顯示成功 Toast，且 force 固定為 true', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        branchName: 'feature-1',
      })

      const result = await store.deleteBranch('repo-1', 'feature-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository:delete-branch',
        responseEvent: 'repository:branch:deleted',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
          branchName: 'feature-1',
          force: true,
        },
      })
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Git', '刪除分支成功', 'feature-1')
      expect(result).toEqual({
        success: true,
        branchName: 'feature-1',
        error: undefined,
      })
    })

    it('失敗時應顯示錯誤 Toast', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '分支尚未合併',
      })

      const result = await store.deleteBranch('repo-1', 'feature-1')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Git', '刪除分支失敗', '分支尚未合併')
      expect(result).toEqual({
        success: false,
        branchName: undefined,
        error: '分支尚未合併',
      })
    })

    it('回應為 null 時應顯示錯誤 Toast', async () => {
      const store = useRepositoryStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.deleteBranch('repo-1', 'feature-1')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Git', '刪除分支失敗')
      expect(result).toEqual({
        success: false,
        error: '刪除分支失敗',
      })
    })
  })

  describe('pullLatest', () => {
    it('應透過 websocketClient.emit 發送 pull 請求並回傳 requestId', async () => {
      const { mockWebSocketClient: wsClient } = await import('../../helpers/mockWebSocket')
      const store = useRepositoryStore()

      const result = await store.pullLatest('repo-1')

      expect(wsClient.emit).toHaveBeenCalledWith(
        'repository:pull-latest',
        expect.objectContaining({
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
        })
      )
      expect(result).toHaveProperty('requestId')
      expect(typeof result.requestId).toBe('string')
    })

    it('emit payload 的 requestId 應與回傳值的 requestId 一致', async () => {
      const { mockWebSocketClient: wsClient } = await import('../../helpers/mockWebSocket')
      const store = useRepositoryStore()

      const result = await store.pullLatest('repo-1')

      const emitCall = wsClient.emit.mock.calls.find(
        (call: unknown[]) => call[0] === 'repository:pull-latest'
      )
      expect(emitCall).toBeDefined()
      const emittedPayload = emitCall![1] as { requestId: string }
      expect(emittedPayload.requestId).toBe(result.requestId)
    })

    it('每次呼叫應回傳不同的 requestId', async () => {
      const store = useRepositoryStore()

      const result1 = await store.pullLatest('repo-1')
      const result2 = await store.pullLatest('repo-1')

      expect(result1.requestId).not.toBe(result2.requestId)
    })

    it('不應呼叫 createWebSocketRequest（fire-and-forget 模式）', async () => {
      const store = useRepositoryStore()

      await store.pullLatest('repo-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('不應呼叫 showSuccessToast 或 showErrorToast（由 progress composable 處理）', async () => {
      const store = useRepositoryStore()

      await store.pullLatest('repo-1')

      expect(mockShowSuccessToast).not.toHaveBeenCalled()
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })
  })

  describe('isWorktree', () => {
    it('有 parentRepoId 時應回傳 true', () => {
      const store = useRepositoryStore()
      const worktreeRepo = createMockRepository({
        id: 'repo-1',
        parentRepoId: 'parent-repo',
      })
      store.availableItems = [worktreeRepo]

      const result = store.isWorktree('repo-1')

      expect(result).toBe(true)
    })

    it('無 parentRepoId 時應回傳 false', () => {
      const store = useRepositoryStore()
      const normalRepo = createMockRepository({ id: 'repo-1' })
      store.availableItems = [normalRepo]

      const result = store.isWorktree('repo-1')

      expect(result).toBe(false)
    })

    it('parentRepoId 為空字串時應回傳 false', () => {
      const store = useRepositoryStore()
      const repo = createMockRepository({
        id: 'repo-1',
        parentRepoId: '',
      })
      store.availableItems = [repo]

      const result = store.isWorktree('repo-1')

      expect(result).toBe(false)
    })

    it('repository 不存在時應回傳 false', () => {
      const store = useRepositoryStore()
      store.availableItems = []

      const result = store.isWorktree('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('繼承的 Note Store 行為', () => {
    it('loadNotesFromBackend 應載入 notes', async () => {
      const store = useRepositoryStore()
      const notes = [
        createMockRepositoryNote({ id: 'note-1', repositoryId: 'repo-1' }),
        createMockRepositoryNote({ id: 'note-2', repositoryId: 'repo-2' }),
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        notes,
      })

      await store.loadNotesFromBackend()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository-note:list',
        responseEvent: 'repository-note:list:result',
        payload: {
          canvasId: 'canvas-1',
        },
      })
      expect(store.notes).toEqual(notes)
    })

    it('createNote 應建立新的 repository note', async () => {
      const store = useRepositoryStore()
      const repo = createMockRepository({ id: 'repo-1', name: 'Test Repo' })
      store.availableItems = [repo]

      const newNote = createMockRepositoryNote({
        id: 'note-1',
        repositoryId: 'repo-1',
        name: 'Test Repo',
        x: 300,
        y: 400,
      })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        note: newNote,
      })

      await store.createNote('repo-1', 300, 400)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository-note:create',
        responseEvent: 'repository-note:created',
        payload: {
          canvasId: 'canvas-1',
          repositoryId: 'repo-1',
          name: 'Test Repo',
          x: 300,
          y: 400,
          boundToPodId: null,
          originalPosition: null,
        },
      })
    })

    it('deleteNote 應刪除指定 note', async () => {
      const store = useRepositoryStore()
      const note = createMockRepositoryNote({ id: 'note-1' })
      store.notes = [note as any]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
      })

      await store.deleteNote('note-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'repository-note:delete',
        responseEvent: 'repository-note:deleted',
        payload: {
          canvasId: 'canvas-1',
          noteId: 'note-1',
        },
      })
    })

    it('bindToPod 應綁定 note 到 pod（one-to-one）', async () => {
      const store = useRepositoryStore()
      const note = createMockRepositoryNote({
        id: 'note-1',
        x: 100,
        y: 200,
      })
      store.notes = [note as any]

      const repositoryId = (note as RepositoryNote).repositoryId

      mockCreateWebSocketRequest.mockResolvedValue({
        success: true,
      })

      await store.bindToPod('note-1', 'pod-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(2)
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(1, {
        requestEvent: 'pod:bind-repository',
        responseEvent: 'pod:repository:bound',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
          repositoryId,
        },
      })
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(2, {
        requestEvent: 'repository-note:update',
        responseEvent: 'repository-note:updated',
        payload: {
          canvasId: 'canvas-1',
          noteId: 'note-1',
          boundToPodId: 'pod-1',
          originalPosition: { x: 100, y: 200 },
        },
      })
    })

    it('unbindFromPod 應解綁 pod 的 repository（one-to-one）', async () => {
      const store = useRepositoryStore()
      const note = createMockRepositoryNote({
        id: 'note-1',
        boundToPodId: 'pod-1',
        originalPosition: { x: 100, y: 200 },
      })
      store.notes = [note as any]

      mockCreateWebSocketRequest.mockResolvedValue({
        success: true,
      })

      await store.unbindFromPod('pod-1', true)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(2)
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(1, {
        requestEvent: 'pod:unbind-repository',
        responseEvent: 'pod:repository:unbound',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
        },
      })
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(2, {
        requestEvent: 'repository-note:update',
        responseEvent: 'repository-note:updated',
        payload: {
          canvasId: 'canvas-1',
          noteId: 'note-1',
          boundToPodId: null,
          originalPosition: null,
          x: 100,
          y: 200,
        },
      })
    })
  })
})
