import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket } from '../../helpers/mockWebSocket'
import { createGroupCRUDActions } from '@/stores/note/createGroupCRUDActions'
import type { GroupCRUDStoreContext } from '@/stores/note/createGroupCRUDActions'
import { useCanvasStore } from '@/stores/canvasStore'
import { WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'

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

function createMockContext(): GroupCRUDStoreContext & { groups: Array<{ id: string; name: string; [key: string]: unknown }> } {
  return {
    groups: [],
    addGroupFromEvent: vi.fn(),
    removeGroupFromEvent: vi.fn(),
    updateItemGroupId: vi.fn(),
  }
}

const testConfig = {
  storeName: 'TestStore',
  groupType: 'test',
  toastCategory: 'Command' as const,
  moveItemToGroupEvents: {
    request: WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
    response: WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
  },
}

describe('createGroupCRUDActions', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()

    const canvasStore = useCanvasStore()
    canvasStore.activeCanvasId = 'canvas-1'
  })

  describe('loadGroups', () => {
    it('成功時應設定 groups', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const mockGroups = [
        { id: 'group-1', name: 'Group 1' },
        { id: 'group-2', name: 'Group 2' },
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ groups: mockGroups })

      await actions.loadGroups.call(ctx)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:list',
        responseEvent: 'group:list:result',
        payload: {
          canvasId: 'canvas-1',
          type: 'test',
        },
      })
      expect(ctx.groups).toEqual(mockGroups)
    })

    it('無 activeCanvasId 時應 early return 並顯示 console.warn', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await actions.loadGroups.call(ctx)

      expect(consoleSpy).toHaveBeenCalledWith('[TestStore] 沒有啟用的畫布')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(ctx.groups).toHaveLength(0)

      consoleSpy.mockRestore()
    })

    it('失敗時應顯示錯誤 Toast', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      await actions.loadGroups.call(ctx)

      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '載入群組失敗')
      expect(ctx.groups).toHaveLength(0)
    })
  })

  describe('createGroup', () => {
    it('成功時應回傳 group 並呼叫 addGroupFromEvent', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const mockGroup = { id: 'group-1', name: 'New Group', type: 'test' }

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        group: mockGroup,
      })

      const result = await actions.createGroup.call(ctx, 'New Group')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:create',
        responseEvent: 'group:created',
        payload: {
          canvasId: 'canvas-1',
          name: 'New Group',
          type: 'test',
        },
      })
      expect(ctx.addGroupFromEvent).toHaveBeenCalledWith(mockGroup)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '建立群組成功', 'New Group')
      expect(result.success).toBe(true)
      expect(result.group).toEqual(mockGroup)
    })

    it('無 activeCanvasId 時應回傳失敗', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const result = await actions.createGroup.call(ctx, 'New Group')

      expect(result).toEqual({ success: false, error: '無作用中的畫布' })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('失敗時應顯示錯誤 Toast', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await actions.createGroup.call(ctx, 'New Group')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '建立群組失敗')
      expect(result).toEqual({ success: false, error: '建立群組失敗' })
    })

    it('回應無 group 時不應呼叫 addGroupFromEvent 且不顯示成功 Toast', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        group: undefined,
      })

      await actions.createGroup.call(ctx, 'New Group')

      expect(ctx.addGroupFromEvent).not.toHaveBeenCalled()
      expect(mockShowSuccessToast).not.toHaveBeenCalled()
    })

    it('回應 success: false 時應回傳對應結果', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '名稱已存在',
      })

      const result = await actions.createGroup.call(ctx, 'New Group')

      expect(result.success).toBe(false)
      expect(result.error).toBe('名稱已存在')
    })

    it('name 為空字串時應回傳錯誤', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const result = await actions.createGroup.call(ctx, '')

      expect(result).toEqual({ success: false, error: '群組名稱不能為空' })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })
  })

  describe('deleteGroup', () => {
    it('成功時應呼叫 removeGroupFromEvent', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        groupId: 'group-1',
      })

      const result = await actions.deleteGroup.call(ctx, 'group-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:delete',
        responseEvent: 'group:deleted',
        payload: {
          canvasId: 'canvas-1',
          groupId: 'group-1',
        },
      })
      expect(ctx.removeGroupFromEvent).toHaveBeenCalledWith('group-1')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '刪除群組成功')
      expect(result.success).toBe(true)
    })

    it('無 activeCanvasId 時應回傳失敗', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const result = await actions.deleteGroup.call(ctx, 'group-1')

      expect(result).toEqual({ success: false, error: '無作用中的畫布' })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('失敗時應顯示錯誤 Toast', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await actions.deleteGroup.call(ctx, 'group-1')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '刪除群組失敗')
      expect(result).toEqual({ success: false, error: '刪除群組失敗' })
    })

    it('回應無 groupId 時不應呼叫 removeGroupFromEvent 且不顯示成功 Toast', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        groupId: undefined,
      })

      await actions.deleteGroup.call(ctx, 'group-1')

      expect(ctx.removeGroupFromEvent).not.toHaveBeenCalled()
      expect(mockShowSuccessToast).not.toHaveBeenCalled()
    })

    it('groupId 為空字串時應回傳錯誤', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const result = await actions.deleteGroup.call(ctx, '')

      expect(result).toEqual({ success: false, error: '無效的群組 ID' })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })
  })

  describe('moveItemToGroup', () => {
    it('成功時應呼叫 updateItemGroupId', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        itemId: 'item-1',
        groupId: 'group-1',
      })

      const result = await actions.moveItemToGroup.call(ctx, 'item-1', 'group-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        responseEvent: WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        payload: {
          canvasId: 'canvas-1',
          itemId: 'item-1',
          groupId: 'group-1',
        },
      })
      expect(ctx.updateItemGroupId).toHaveBeenCalledWith('item-1', 'group-1')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '移動成功')
      expect(result.success).toBe(true)
    })

    it('移出群組時 groupId 應為 null', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        itemId: 'item-1',
        groupId: null,
      })

      const result = await actions.moveItemToGroup.call(ctx, 'item-1', null)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        responseEvent: WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        payload: {
          canvasId: 'canvas-1',
          itemId: 'item-1',
          groupId: null,
        },
      })
      expect(ctx.updateItemGroupId).toHaveBeenCalledWith('item-1', null)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '移動成功')
      expect(result.success).toBe(true)
    })

    it('無 activeCanvasId 時應回傳失敗', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const result = await actions.moveItemToGroup.call(ctx, 'item-1', 'group-1')

      expect(result).toEqual({ success: false, error: '無作用中的畫布' })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('失敗時應顯示錯誤 Toast', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await actions.moveItemToGroup.call(ctx, 'item-1', 'group-1')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '移動失敗')
      expect(result).toEqual({ success: false, error: '移動失敗' })
    })

    it('回應無 itemId 時不應呼叫 updateItemGroupId 且不顯示成功 Toast', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        itemId: undefined,
        groupId: 'group-1',
      })

      await actions.moveItemToGroup.call(ctx, 'item-1', 'group-1')

      expect(ctx.updateItemGroupId).not.toHaveBeenCalled()
      expect(mockShowSuccessToast).not.toHaveBeenCalled()
    })

    it('itemId 為空字串時應回傳錯誤', async () => {
      const actions = createGroupCRUDActions(testConfig)
      const ctx = createMockContext()

      const result = await actions.moveItemToGroup.call(ctx, '', 'group-1')

      expect(result).toEqual({ success: false, error: '無效的項目 ID' })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })
  })
})
