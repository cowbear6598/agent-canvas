import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket } from '../../helpers/mockWebSocket'
import { createMockPod } from '../../helpers/factories'
import { useOutputStyleStore } from '@/stores/note/outputStyleStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type { OutputStyleListItem, Pod } from '@/types'
import type { Group } from '@/types'

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

describe('outputStyleStore 自訂 actions', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()

    const canvasStore = useCanvasStore()
    canvasStore.activeCanvasId = 'canvas-1'
  })

  describe('createOutputStyle', () => {
    it('成功時應新增到 availableItems', async () => {
      const store = useOutputStyleStore()
      store.availableItems = []

      const newOutputStyle = { id: 'style-1', name: 'New Style' }
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        outputStyle: newOutputStyle,
      })

      const result = await store.createOutputStyle('New Style', 'content here')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'output-style:create',
        responseEvent: 'output-style:created',
        payload: {
          canvasId: 'canvas-1',
          name: 'New Style',
          content: 'content here',
        },
      })
      expect(store.availableItems).toHaveLength(1)
      expect(store.availableItems[0]).toEqual(newOutputStyle)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('OutputStyle', '建立成功', 'New Style')
      expect(result).toEqual({
        success: true,
        outputStyle: newOutputStyle,
      })
    })

    it('失敗時應回傳 error', async () => {
      const store = useOutputStyleStore()
      store.availableItems = []

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.createOutputStyle('New Style', 'content here')

      expect(store.availableItems).toHaveLength(0)
      expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '建立失敗', '建立 Output Style 失敗')
      expect(result).toEqual({
        success: false,
        error: '建立 Output Style 失敗',
      })
    })

    it('回應無 outputStyle 時應回傳 error', async () => {
      const store = useOutputStyleStore()
      store.availableItems = []

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        error: '檔案已存在',
      })

      const result = await store.createOutputStyle('Existing', 'content')

      expect(store.availableItems).toHaveLength(0)
      expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '建立失敗', '檔案已存在')
      expect(result).toEqual({
        success: false,
        error: '檔案已存在',
      })
    })
  })

  describe('updateOutputStyle', () => {
    it('成功時應更新 availableItems 中的 item', async () => {
      const store = useOutputStyleStore()
      const existingStyle: OutputStyleListItem = { id: 'style-1', name: 'Original Style' }
      store.availableItems = [existingStyle]

      const updatedStyle = { id: 'style-1', name: 'Updated Style' }
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        outputStyle: updatedStyle,
      })

      const result = await store.updateOutputStyle('style-1', 'updated content')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'output-style:update',
        responseEvent: 'output-style:updated',
        payload: {
          canvasId: 'canvas-1',
          outputStyleId: 'style-1',
          content: 'updated content',
        },
      })
      expect(store.availableItems).toHaveLength(1)
      expect(store.availableItems[0]).toEqual(updatedStyle)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('OutputStyle', '更新成功', 'Updated Style')
      expect(result).toEqual({
        success: true,
        outputStyle: updatedStyle,
      })
    })

    it('失敗時應回傳 error', async () => {
      const store = useOutputStyleStore()
      const existingStyle: OutputStyleListItem = { id: 'style-1', name: 'Original Style' }
      store.availableItems = [existingStyle]

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.updateOutputStyle('style-1', 'content')

      expect(store.availableItems[0]).toEqual(existingStyle)
      expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '更新失敗', '更新 Output Style 失敗')
      expect(result).toEqual({
        success: false,
        error: '更新 Output Style 失敗',
      })
    })

    it('回應無 outputStyle 時應回傳 error', async () => {
      const store = useOutputStyleStore()
      store.availableItems = [{ id: 'style-1', name: 'Original' }]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        error: '檔案不存在',
      })

      const result = await store.updateOutputStyle('style-1', 'content')

      expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '更新失敗', '檔案不存在')
      expect(result).toEqual({
        success: false,
        error: '檔案不存在',
      })
    })
  })

  describe('readOutputStyle', () => {
    it('成功時應回傳含 content 的物件', async () => {
      const store = useOutputStyleStore()

      const outputStyleData = {
        id: 'style-1',
        name: 'Style Name',
        content: 'output style content',
      }
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        outputStyle: outputStyleData,
      })

      const result = await store.readOutputStyle('style-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'output-style:read',
        responseEvent: 'output-style:read:result',
        payload: {
          canvasId: 'canvas-1',
          outputStyleId: 'style-1',
        },
      })
      expect(result).toEqual(outputStyleData)
    })

    it('失敗時應回傳 null', async () => {
      const store = useOutputStyleStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.readOutputStyle('style-1')

      expect(result).toBeNull()
    })

    it('回應無 outputStyle 時應回傳 null', async () => {
      const store = useOutputStyleStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.readOutputStyle('style-1')

      expect(result).toBeNull()
    })
  })

  describe('deleteOutputStyle', () => {
    it('應委派到 deleteItem', async () => {
      const store = useOutputStyleStore()
      store.availableItems = [{ id: 'style-1', name: 'Test Style' }]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
      })

      const deleteSpy = vi.spyOn(store, 'deleteItem')

      await store.deleteOutputStyle('style-1')

      expect(deleteSpy).toHaveBeenCalledWith('style-1')
    })
  })

  describe('rebuildNotesFromPods', () => {
    it('應為每個有 outputStyleId 的 Pod 建立 Note', async () => {
      const store = useOutputStyleStore()
      store.availableItems = [
        { id: 'style-1', name: 'Style 1' },
        { id: 'style-2', name: 'Style 2' },
      ]
      store.notes = []

      const pods: Pod[] = [
        createMockPod({ id: 'pod-1', outputStyleId: 'style-1', x: 100, y: 200 }),
        createMockPod({ id: 'pod-2', outputStyleId: 'style-2', x: 300, y: 400 }),
      ]

      mockCreateWebSocketRequest
        .mockResolvedValueOnce({
          note: { id: 'note-1', outputStyleId: 'style-1', x: 100, y: 150 },
        })
        .mockResolvedValueOnce({
          note: { id: 'note-2', outputStyleId: 'style-2', x: 300, y: 350 },
        })

      await store.rebuildNotesFromPods(pods)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(2)
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(1, {
        requestEvent: 'note:create',
        responseEvent: 'note:created',
        payload: {
          canvasId: 'canvas-1',
          outputStyleId: 'style-1',
          name: 'Style 1',
          x: 100,
          y: 150, // pod.y - 50
          boundToPodId: 'pod-1',
          originalPosition: { x: 100, y: 150 },
        },
      })
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(2, {
        requestEvent: 'note:create',
        responseEvent: 'note:created',
        payload: {
          canvasId: 'canvas-1',
          outputStyleId: 'style-2',
          name: 'Style 2',
          x: 300,
          y: 350,
          boundToPodId: 'pod-2',
          originalPosition: { x: 300, y: 350 },
        },
      })
      expect(store.notes).toHaveLength(2)
    })

    it('已有 Note 的 Pod 應跳過', async () => {
      const store = useOutputStyleStore()
      store.availableItems = [{ id: 'style-1', name: 'Style 1' }]
      store.notes = [
        { id: 'note-existing', outputStyleId: 'style-1', boundToPodId: 'pod-1', x: 100, y: 150 } as any,
      ]

      const pods: Pod[] = [
        createMockPod({ id: 'pod-1', outputStyleId: 'style-1' }),
      ]

      await store.rebuildNotesFromPods(pods)

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.notes).toHaveLength(1)
    })

    it('無 outputStyleId 的 Pod 應跳過', async () => {
      const store = useOutputStyleStore()
      store.notes = []

      const pods: Pod[] = [
        createMockPod({ id: 'pod-1', outputStyleId: null }),
      ]

      await store.rebuildNotesFromPods(pods)

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.notes).toHaveLength(0)
    })

    it('無 activeCanvasId 時不應操作', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      const store = useOutputStyleStore()
      store.notes = []

      const pods: Pod[] = [
        createMockPod({ id: 'pod-1', outputStyleId: 'style-1' }),
      ]

      await store.rebuildNotesFromPods(pods)

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.notes).toHaveLength(0)
    })

    it('未找到對應 style 時應使用 outputStyleId 作為名稱', async () => {
      const store = useOutputStyleStore()
      store.availableItems = []
      store.notes = []

      const pods: Pod[] = [
        createMockPod({ id: 'pod-1', outputStyleId: 'unknown-style', x: 100, y: 200 }),
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        note: { id: 'note-1', outputStyleId: 'unknown-style', x: 100, y: 150 },
      })

      await store.rebuildNotesFromPods(pods)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'note:create',
        responseEvent: 'note:created',
        payload: {
          canvasId: 'canvas-1',
          outputStyleId: 'unknown-style',
          name: 'unknown-style',
          x: 100,
          y: 150,
          boundToPodId: 'pod-1',
          originalPosition: { x: 100, y: 150 },
        },
      })
    })
  })

  describe('loadOutputStyles', () => {
    it('應委派到 loadItems', async () => {
      const store = useOutputStyleStore()

      const loadItemsSpy = vi.spyOn(store, 'loadItems').mockResolvedValueOnce(undefined)

      await store.loadOutputStyles()

      expect(loadItemsSpy).toHaveBeenCalled()
    })
  })

  describe('群組操作', () => {
    describe('loadGroups', () => {
      it('成功時應載入並設定 groups', async () => {
        const store = useOutputStyleStore()
        store.groups = []

        const groups: Group[] = [
          { id: 'group-1', name: 'Group 1', type: 'outputStyle' },
          { id: 'group-2', name: 'Group 2', type: 'outputStyle' },
        ]

        mockCreateWebSocketRequest.mockResolvedValueOnce({ groups })

        await store.loadGroups()

        expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
          requestEvent: 'group:list',
          responseEvent: 'group:list:result',
          payload: {
            canvasId: 'canvas-1',
            type: 'output-style',
          },
        })
        expect(store.groups).toEqual(groups)
      })

      it('無 activeCanvasId 時不應操作', async () => {
        const canvasStore = useCanvasStore()
        canvasStore.activeCanvasId = null

        const store = useOutputStyleStore()

        await store.loadGroups()

        expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      })

      it('回應為空時不應更新 groups 並顯示錯誤 Toast', async () => {
        const store = useOutputStyleStore()
        const originalGroups: Group[] = [{ id: 'group-1', name: 'Original', type: 'outputStyle' }]
        store.groups = [...originalGroups]

        mockCreateWebSocketRequest.mockResolvedValueOnce(null)

        await store.loadGroups()

        expect(store.groups).toEqual(originalGroups)
        expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '載入群組失敗')
      })

      it('回應有值但無 groups 欄位時不應更新 groups', async () => {
        const store = useOutputStyleStore()
        const originalGroups: Group[] = [{ id: 'group-1', name: 'Original', type: 'outputStyle' }]
        store.groups = [...originalGroups]

        mockCreateWebSocketRequest.mockResolvedValueOnce({})

        await store.loadGroups()

        expect(store.groups).toEqual(originalGroups)
      })
    })

    describe('createGroup', () => {
      it('成功時應建立並加入 groups', async () => {
        const store = useOutputStyleStore()
        store.groups = []

        const newGroup: Group = { id: 'group-1', name: 'New Group', type: 'outputStyle' }
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
            type: 'output-style',
          },
        })
        expect(store.groups).toHaveLength(1)
        expect(store.groups[0]).toEqual(newGroup)
        expect(result).toEqual({
          success: true,
          group: newGroup,
        })
        expect(mockShowSuccessToast).toHaveBeenCalledWith('OutputStyle', '建立群組成功', 'New Group')
      })

      it('無 activeCanvasId 時應回傳錯誤', async () => {
        const canvasStore = useCanvasStore()
        canvasStore.activeCanvasId = null

        const store = useOutputStyleStore()

        const result = await store.createGroup('New Group')

        expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
        expect(result).toEqual({
          success: false,
          error: '無作用中的畫布',
        })
      })

      it('回應為空時應回傳錯誤並顯示錯誤 Toast', async () => {
        const store = useOutputStyleStore()

        mockCreateWebSocketRequest.mockResolvedValueOnce(null)

        const result = await store.createGroup('New Group')

        expect(result).toEqual({
          success: false,
          error: '建立群組失敗',
        })
        expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '建立群組失敗')
      })
    })

    describe('deleteGroup', () => {
      it('成功時應從 groups 中刪除', async () => {
        const store = useOutputStyleStore()
        store.groups = [
          { id: 'group-1', name: 'Group 1', type: 'outputStyle' },
          { id: 'group-2', name: 'Group 2', type: 'outputStyle' },
        ]

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
        expect(store.groups).toHaveLength(1)
        expect(store.groups[0]?.id).toBe('group-2')
        expect(result).toEqual({ success: true })
        expect(mockShowSuccessToast).toHaveBeenCalledWith('OutputStyle', '刪除群組成功')
      })

      it('無 activeCanvasId 時應回傳錯誤', async () => {
        const canvasStore = useCanvasStore()
        canvasStore.activeCanvasId = null

        const store = useOutputStyleStore()

        const result = await store.deleteGroup('group-1')

        expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
        expect(result).toEqual({
          success: false,
          error: '無作用中的畫布',
        })
      })

      it('回應為空時應回傳錯誤並顯示錯誤 Toast', async () => {
        const store = useOutputStyleStore()

        mockCreateWebSocketRequest.mockResolvedValueOnce(null)

        const result = await store.deleteGroup('group-1')

        expect(result).toEqual({
          success: false,
          error: '刪除群組失敗',
        })
        expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '刪除群組失敗')
      })
    })

    describe('moveItemToGroup', () => {
      it('成功時應更新 item 的 groupId', async () => {
        const store = useOutputStyleStore()
        store.availableItems = [
          { id: 'style-1', name: 'Style 1', groupId: null },
          { id: 'style-2', name: 'Style 2', groupId: 'group-1' },
        ]

        mockCreateWebSocketRequest.mockResolvedValueOnce({
          success: true,
          itemId: 'style-1',
          groupId: 'group-1',
        })

        const result = await store.moveItemToGroup('style-1', 'group-1')

        expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
          requestEvent: 'output-style:move-to-group',
          responseEvent: 'output-style:moved-to-group',
          payload: {
            canvasId: 'canvas-1',
            itemId: 'style-1',
            groupId: 'group-1',
          },
        })
        expect((store.availableItems[0] as any)?.groupId).toBe('group-1')
        expect(result).toEqual({ success: true })
        expect(mockShowSuccessToast).toHaveBeenCalledWith('OutputStyle', '移動成功')
      })

      it('成功時應可將 item 移出群組（groupId 設為 null）', async () => {
        const store = useOutputStyleStore()
        store.availableItems = [
          { id: 'style-1', name: 'Style 1', groupId: 'group-1' },
        ]

        mockCreateWebSocketRequest.mockResolvedValueOnce({
          success: true,
          itemId: 'style-1',
          groupId: null,
        })

        const result = await store.moveItemToGroup('style-1', null)

        expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
          requestEvent: 'output-style:move-to-group',
          responseEvent: 'output-style:moved-to-group',
          payload: {
            canvasId: 'canvas-1',
            itemId: 'style-1',
            groupId: null,
          },
        })
        expect((store.availableItems[0] as any)?.groupId).toBeNull()
        expect(result).toEqual({ success: true })
        expect(mockShowSuccessToast).toHaveBeenCalledWith('OutputStyle', '移動成功')
      })

      it('無 activeCanvasId 時應回傳錯誤', async () => {
        const canvasStore = useCanvasStore()
        canvasStore.activeCanvasId = null

        const store = useOutputStyleStore()

        const result = await store.moveItemToGroup('style-1', 'group-1')

        expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
        expect(result).toEqual({
          success: false,
          error: '無作用中的畫布',
        })
      })

      it('回應為空時應回傳錯誤並顯示錯誤 Toast', async () => {
        const store = useOutputStyleStore()

        mockCreateWebSocketRequest.mockResolvedValueOnce(null)

        const result = await store.moveItemToGroup('style-1', 'group-1')

        expect(result).toEqual({
          success: false,
          error: '移動失敗',
        })
        expect(mockShowErrorToast).toHaveBeenCalledWith('OutputStyle', '移動失敗')
      })
    })
  })
})
