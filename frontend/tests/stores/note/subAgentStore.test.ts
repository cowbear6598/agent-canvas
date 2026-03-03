import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket } from '../../helpers/mockWebSocket'
import { createMockSubAgent, createMockGroup } from '../../helpers/factories'
import { useSubAgentStore } from '@/stores/note/subAgentStore'
import { useCanvasStore } from '@/stores/canvasStore'

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
vi.mock('@/composables/useToast', () => {
  const mockShowSuccessToast = vi.fn()
  const mockShowErrorToast = vi.fn()
  return {
    useToast: () => ({
      showSuccessToast: mockShowSuccessToast,
      showErrorToast: mockShowErrorToast,
    }),
    mockShowSuccessToast,
    mockShowErrorToast,
  }
})

const { mockShowSuccessToast, mockShowErrorToast } = await import('@/composables/useToast') as any

describe('subAgentStore', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()
  })

  describe('createSubAgent', () => {
    it('成功時應回傳 success: true 並新增 item 到 availableItems', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const newSubAgent = createMockSubAgent({ id: 'subagent-1', name: 'New SubAgent' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        subAgent: newSubAgent,
      })

      const result = await store.createSubAgent('New SubAgent', 'SubAgent content')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'subagent:create',
        responseEvent: 'subagent:created',
        payload: {
          canvasId: 'canvas-1',
          name: 'New SubAgent',
          content: 'SubAgent content',
        },
      })
      expect(result.success).toBe(true)
      expect(result.subAgent).toMatchObject({ id: 'subagent-1', name: 'New SubAgent' })
      expect(store.availableItems).toContainEqual(newSubAgent)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('SubAgent', '建立成功', 'New SubAgent')
    })

    it('失敗時應回傳 success: false 並包含 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.createSubAgent('SubAgent', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('建立 SubAgent 失敗')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '建立失敗', '建立 SubAgent 失敗')
    })

    it('回應無 subAgent 時應回傳 success: false', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.createSubAgent('SubAgent', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('建立 SubAgent 失敗')
    })

    it('回應包含 error 時應回傳該 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        error: '名稱已存在',
      })

      const result = await store.createSubAgent('SubAgent', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('名稱已存在')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '建立失敗', '名稱已存在')
    })
  })

  describe('updateSubAgent', () => {
    it('成功時應回傳 success: true 並更新 availableItems', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const originalSubAgent = createMockSubAgent({ id: 'subagent-1', name: 'Original' })
      store.availableItems = [originalSubAgent]

      const updatedSubAgent = createMockSubAgent({ id: 'subagent-1', name: 'Updated' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        subAgent: updatedSubAgent,
      })

      const result = await store.updateSubAgent('subagent-1', 'Updated content')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'subagent:update',
        responseEvent: 'subagent:updated',
        payload: {
          canvasId: 'canvas-1',
          subAgentId: 'subagent-1',
          content: 'Updated content',
        },
      })
      expect(result.success).toBe(true)
      expect(result.subAgent).toMatchObject({ id: 'subagent-1', name: 'Updated' })
      expect(store.availableItems[0]).toEqual(updatedSubAgent)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('SubAgent', '更新成功', 'Updated')
    })

    it('失敗時應回傳 success: false 並包含 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.updateSubAgent('subagent-1', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('更新 SubAgent 失敗')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '更新失敗', '更新 SubAgent 失敗')
    })

    it('回應無 subAgent 時應回傳 success: false', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.updateSubAgent('subagent-1', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('更新 SubAgent 失敗')
    })

    it('回應包含 error 時應回傳該 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        error: '權限不足',
      })

      const result = await store.updateSubAgent('subagent-1', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('權限不足')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '更新失敗', '權限不足')
    })
  })

  describe('readSubAgent', () => {
    it('成功時應回傳 subAgent 資料', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const subAgentData = {
        id: 'subagent-1',
        name: 'Test SubAgent',
        content: 'SubAgent content',
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        subAgent: subAgentData,
      })

      const result = await store.readSubAgent('subagent-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'subagent:read',
        responseEvent: 'subagent:read:result',
        payload: {
          canvasId: 'canvas-1',
          subAgentId: 'subagent-1',
        },
      })
      expect(result).toEqual(subAgentData)
    })

    it('失敗時應回傳 null', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.readSubAgent('subagent-1')

      expect(result).toBeNull()
    })

    it('回應無 subAgent 時應回傳 null', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.readSubAgent('subagent-1')

      expect(result).toBeNull()
    })
  })

  describe('deleteSubAgent', () => {
    it('應委派到 deleteItem', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const subAgent = createMockSubAgent({ id: 'subagent-1', name: 'Test SubAgent' })
      store.availableItems = [subAgent]

      const deleteItemSpy = vi.spyOn(store, 'deleteItem')

      await store.deleteSubAgent('subagent-1')

      expect(deleteItemSpy).toHaveBeenCalledWith('subagent-1')
    })
  })

  describe('loadSubAgents', () => {
    it('應委派到 loadItems', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const loadItemsSpy = vi.spyOn(store, 'loadItems')

      await store.loadSubAgents()

      expect(loadItemsSpy).toHaveBeenCalled()
    })
  })

  describe('loadGroups', () => {
    it('成功時應設定 groups', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const groups = [
        createMockGroup({ id: 'group-1', name: 'Group 1', type: 'subAgent' }),
        createMockGroup({ id: 'group-2', name: 'Group 2', type: 'subAgent' }),
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        groups,
      })

      await store.loadGroups()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:list',
        responseEvent: 'group:list:result',
        payload: {
          canvasId: 'canvas-1',
          type: 'subagent',
        },
      })
      expect(store.groups).toEqual(groups)
    })

    it('無 activeCanvasId 時應顯示 warning 並 early return', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useSubAgentStore()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await store.loadGroups()

      expect(warnSpy).toHaveBeenCalledWith('[SubAgentStore] 沒有啟用的畫布')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('回應無 groups 時不應更新 groups', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      store.groups = [createMockGroup({ id: 'existing-group' })]

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      await store.loadGroups()

      expect(store.groups).toHaveLength(1)
      expect(store.groups[0]?.id).toBe('existing-group')
    })

    it('失敗時不應更新 groups 並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      store.groups = [createMockGroup({ id: 'existing-group' })]

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      await store.loadGroups()

      expect(store.groups).toHaveLength(1)
      expect(store.groups[0]?.id).toBe('existing-group')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '載入群組失敗')
    })
  })

  describe('createGroup', () => {
    it('成功時應回傳 success: true 並加入 groups', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const newGroup = createMockGroup({ id: 'group-1', name: 'New Group', type: 'subAgent' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        group: newGroup,
      })

      const result = await store.createGroup('New Group')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:create',
        responseEvent: 'group:created',
        payload: {
          canvasId: 'canvas-1',
          name: 'New Group',
          type: 'subagent',
        },
      })
      expect(result.success).toBe(true)
      expect(result.group).toEqual(newGroup)
      expect(store.groups).toContainEqual(newGroup)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('SubAgent', '建立群組成功', 'New Group')
    })

    it('無 activeCanvasId 時應回傳 success: false', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useSubAgentStore()

      const result = await store.createGroup('New Group')

      expect(result.success).toBe(false)
      expect(result.error).toBe('無作用中的畫布')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('回應為 null 時應回傳 success: false 並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.createGroup('New Group')

      expect(result.success).toBe(false)
      expect(result.error).toBe('建立群組失敗')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '建立群組失敗')
    })

    it('回應 success: false 時應回傳對應結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '名稱重複',
      })

      const result = await store.createGroup('New Group')

      expect(result.success).toBe(false)
      expect(result.error).toBe('名稱重複')
    })

    it('回應無 group 時不應加入 groups', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
      })

      const result = await store.createGroup('New Group')

      expect(result.success).toBe(true)
      expect(store.groups).toHaveLength(0)
    })
  })

  describe('deleteGroup', () => {
    it('成功時應回傳 success: true 並從 groups 移除', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const group1 = createMockGroup({ id: 'group-1', name: 'Group 1' })
      const group2 = createMockGroup({ id: 'group-2', name: 'Group 2' })
      store.groups = [group1, group2]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        groupId: 'group-1',
      })

      const result = await store.deleteGroup('group-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:delete',
        responseEvent: 'group:deleted',
        payload: {
          canvasId: 'canvas-1',
          groupId: 'group-1',
        },
      })
      expect(result.success).toBe(true)
      expect(store.groups).toHaveLength(1)
      expect(store.groups[0]).toEqual(group2)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('SubAgent', '刪除群組成功')
    })

    it('無 activeCanvasId 時應回傳 success: false', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useSubAgentStore()

      const result = await store.deleteGroup('group-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('無作用中的畫布')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('回應為 null 時應回傳 success: false 並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.deleteGroup('group-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('刪除群組失敗')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '刪除群組失敗')
    })

    it('回應 success: false 時應回傳對應結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '群組內仍有項目',
      })

      const result = await store.deleteGroup('group-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('群組內仍有項目')
    })

    it('回應無 groupId 時不應移除 group', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const group = createMockGroup({ id: 'group-1', name: 'Group 1' })
      store.groups = [group]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
      })

      const result = await store.deleteGroup('group-1')

      expect(result.success).toBe(true)
      expect(store.groups).toHaveLength(1)
    })
  })

  describe('moveItemToGroup', () => {
    it('成功時應回傳 success: true 並更新 item 的 groupId', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const subAgent = createMockSubAgent({ id: 'subagent-1', groupId: null })
      store.availableItems = [subAgent]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        itemId: 'subagent-1',
        groupId: 'group-1',
      })

      const result = await store.moveItemToGroup('subagent-1', 'group-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'subagent:move-to-group',
        responseEvent: 'subagent:moved-to-group',
        payload: {
          canvasId: 'canvas-1',
          itemId: 'subagent-1',
          groupId: 'group-1',
        },
      })
      expect(result.success).toBe(true)
      expect((store.availableItems[0] as any)?.groupId).toBe('group-1')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('SubAgent', '移動成功')
    })

    it('移動到 null (移出群組) 時應清空 groupId', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const subAgent = createMockSubAgent({ id: 'subagent-1', groupId: 'group-1' })
      store.availableItems = [subAgent]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        itemId: 'subagent-1',
        groupId: null,
      })

      const result = await store.moveItemToGroup('subagent-1', null)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'subagent:move-to-group',
        responseEvent: 'subagent:moved-to-group',
        payload: {
          canvasId: 'canvas-1',
          itemId: 'subagent-1',
          groupId: null,
        },
      })
      expect(result.success).toBe(true)
      expect((store.availableItems[0] as any)?.groupId).toBeNull()
      expect(mockShowSuccessToast).toHaveBeenCalledWith('SubAgent', '移動成功')
    })

    it('無 activeCanvasId 時應回傳 success: false', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useSubAgentStore()

      const result = await store.moveItemToGroup('subagent-1', 'group-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('無作用中的畫布')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('回應為 null 時應回傳 success: false 並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.moveItemToGroup('subagent-1', 'group-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('移動失敗')
      expect(mockShowErrorToast).toHaveBeenCalledWith('SubAgent', '移動失敗')
    })

    it('回應 success: false 時應回傳對應結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '群組不存在',
      })

      const result = await store.moveItemToGroup('subagent-1', 'group-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('群組不存在')
    })

    it('回應無 itemId 時不應更新 groupId', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useSubAgentStore()

      const subAgent = createMockSubAgent({ id: 'subagent-1', groupId: null })
      store.availableItems = [subAgent]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
      })

      const result = await store.moveItemToGroup('subagent-1', 'group-1')

      expect(result.success).toBe(true)
      expect((store.availableItems[0] as any)?.groupId).toBeNull()
    })
  })
})
