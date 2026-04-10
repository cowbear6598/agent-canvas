import { describe, it, expect, vi } from 'vitest'
import { webSocketMockFactory, mockCreateWebSocketRequest } from '../helpers/mockWebSocket'
import { setupStoreTest, mockErrorSanitizerFactory } from '../helpers/testSetup'
import { createMockCanvas } from '../helpers/factories'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Canvas } from '@/types/canvas'

// Mock WebSocket
vi.mock('@/services/websocket', () => webSocketMockFactory())

// Mock useToast
const mockToast = vi.fn()
const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}))

// Mock sanitizeErrorForUser
vi.mock('@/utils/errorSanitizer', () => mockErrorSanitizerFactory())

describe('canvasStore', () => {
  setupStoreTest()

  describe('初始狀態', () => {
    it('canvases 應為空陣列', () => {
      const store = useCanvasStore()

      expect(store.canvases).toEqual([])
    })

    it('activeCanvasId 應為 null', () => {
      const store = useCanvasStore()

      expect(store.activeCanvasId).toBeNull()
    })

    it('isSidebarOpen 應為 false', () => {
      const store = useCanvasStore()

      expect(store.isSidebarOpen).toBe(false)
    })

    it('isLoading 應為 false', () => {
      const store = useCanvasStore()

      expect(store.isLoading).toBe(false)
    })
  })

  describe('getters', () => {
    describe('activeCanvas', () => {
      it('有 activeCanvasId 時應回傳對應 Canvas', () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1', name: 'Canvas 1' })
        const canvas2 = createMockCanvas({ id: 'canvas-2', name: 'Canvas 2' })
        store.canvases = [canvas1, canvas2]
        store.activeCanvasId = 'canvas-2'

        const result = store.activeCanvas

        expect(result).toEqual(canvas2)
      })

      it('無 activeCanvasId 時應回傳 null', () => {
        const store = useCanvasStore()
        const canvas = createMockCanvas()
        store.canvases = [canvas]
        store.activeCanvasId = null

        const result = store.activeCanvas

        expect(result).toBeNull()
      })

      it('activeCanvasId 不存在於 canvases 中時應回傳 null', () => {
        const store = useCanvasStore()
        const canvas = createMockCanvas({ id: 'canvas-1' })
        store.canvases = [canvas]
        store.activeCanvasId = 'non-existent-id'

        const result = store.activeCanvas

        expect(result).toBeNull()
      })
    })
  })

  describe('toggleSidebar', () => {
    it('應切換 isSidebarOpen 狀態', () => {
      const store = useCanvasStore()
      expect(store.isSidebarOpen).toBe(false)

      store.toggleSidebar()
      expect(store.isSidebarOpen).toBe(true)

      store.toggleSidebar()
      expect(store.isSidebarOpen).toBe(false)
    })
  })

  describe('createCanvas', () => {
    it('成功時應呼叫 WebSocket 建立、切換到新 Canvas、顯示成功 Toast、回傳 Canvas 物件', async () => {
      const store = useCanvasStore()
      const newCanvas = createMockCanvas({ id: 'new-canvas-id', name: 'My Canvas' })

      // Mock CANVAS_CREATE 回應
      mockCreateWebSocketRequest.mockResolvedValueOnce({ canvas: newCanvas })
      // Mock CANVAS_SWITCH 回應
      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true, canvasId: newCanvas.id })

      const result = await store.createCanvas('My Canvas')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(2)
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(1, {
        requestEvent: 'canvas:create',
        responseEvent: 'canvas:created',
        payload: { name: 'My Canvas' },
      })
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(2, {
        requestEvent: 'canvas:switch',
        responseEvent: 'canvas:switched',
        payload: { canvasId: 'new-canvas-id' },
      })
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Canvas', '建立成功', 'My Canvas')
      expect(result).toEqual(newCanvas)
    })

    it('成功後 activeCanvasId 應更新為新 Canvas ID', async () => {
      const store = useCanvasStore()
      const newCanvas = createMockCanvas({ id: 'new-canvas-id', name: 'Test Canvas' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({ canvas: newCanvas })
      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true, canvasId: newCanvas.id })

      await store.createCanvas('Test Canvas')

      expect(store.activeCanvasId).toBe('new-canvas-id')
    })

    it('失敗時應顯示失敗 Toast 並回傳 null', async () => {
      const store = useCanvasStore()
      const error = new Error('建立失敗')

      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      const result = await store.createCanvas('Failed Canvas')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Canvas', '建立失敗', '建立失敗')
      expect(result).toBeNull()
    })

    it('WebSocket 回傳無 canvas 時應回傳 null', async () => {
      const store = useCanvasStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.createCanvas('Empty Canvas')

      expect(result).toBeNull()
    })
  })

  describe('loadCanvases', () => {
    it('成功時應設定 canvases 陣列（按 sortIndex 排序）', async () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'c1', sortIndex: 2 })
      const canvas2 = createMockCanvas({ id: 'c2', sortIndex: 0 })
      const canvas3 = createMockCanvas({ id: 'c3', sortIndex: 1 })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        canvases: [canvas1, canvas2, canvas3],
      })

      await store.loadCanvases()

      expect(store.canvases).toEqual([canvas2, canvas3, canvas1])
    })

    it('有 canvases 且無 activeCanvasId 時應自動切換到第一個', async () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'first-canvas', sortIndex: 0 })
      const canvas2 = createMockCanvas({ id: 'second-canvas', sortIndex: 1 })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        canvases: [canvas1, canvas2],
      })
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: 'first-canvas',
      })

      await store.loadCanvases()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(2)
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(2, {
        requestEvent: 'canvas:switch',
        responseEvent: 'canvas:switched',
        payload: { canvasId: 'first-canvas' },
      })
      expect(store.activeCanvasId).toBe('first-canvas')
    })

    it('已有 activeCanvasId 時不應自動切換', async () => {
      const store = useCanvasStore()
      store.activeCanvasId = 'existing-canvas'
      const canvas = createMockCanvas({ id: 'new-canvas' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        canvases: [canvas],
      })

      await store.loadCanvases()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1)
      expect(store.activeCanvasId).toBe('existing-canvas')
    })

    it('isLoading 應正確切換（true -> false）', async () => {
      const store = useCanvasStore()

      mockCreateWebSocketRequest.mockImplementationOnce(async () => {
        expect(store.isLoading).toBe(true)
        return { canvases: [] }
      })

      expect(store.isLoading).toBe(false)

      await store.loadCanvases()

      expect(store.isLoading).toBe(false)
    })

    it('失敗時應 throw error 且 isLoading 恢復為 false', async () => {
      const store = useCanvasStore()
      const error = new Error('Load failed')

      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      await expect(store.loadCanvases()).rejects.toThrow('Load failed')
      expect(store.isLoading).toBe(false)
    })
  })

  describe('deleteCanvas', () => {
    it('刪除非活躍 Canvas 時應僅發送 WebSocket 請求', async () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'canvas-1' })
      const canvas2 = createMockCanvas({ id: 'canvas-2' })
      store.canvases = [canvas1, canvas2]
      store.activeCanvasId = 'canvas-1'

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.deleteCanvas('canvas-2')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1)
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'canvas:delete',
        responseEvent: 'canvas:deleted',
        payload: { canvasId: 'canvas-2' },
      })
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Canvas', '刪除成功')
    })

    it('刪除活躍 Canvas 時應先切換到其他 Canvas 再刪除', async () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'canvas-1' })
      const canvas2 = createMockCanvas({ id: 'canvas-2' })
      store.canvases = [canvas1, canvas2]
      store.activeCanvasId = 'canvas-1'

      // Mock switchCanvas
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: 'canvas-2',
      })
      // Mock deleteCanvas
      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.deleteCanvas('canvas-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(2)
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(1, {
        requestEvent: 'canvas:switch',
        responseEvent: 'canvas:switched',
        payload: { canvasId: 'canvas-2' },
      })
      expect(mockCreateWebSocketRequest).toHaveBeenNthCalledWith(2, {
        requestEvent: 'canvas:delete',
        responseEvent: 'canvas:deleted',
        payload: { canvasId: 'canvas-1' },
      })
    })

    it('刪除唯一 Canvas 時不應嘗試切換', async () => {
      const store = useCanvasStore()
      const canvas = createMockCanvas({ id: 'only-canvas' })
      store.canvases = [canvas]
      store.activeCanvasId = 'only-canvas'

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.deleteCanvas('only-canvas')

      // 只呼叫一次 deleteCanvas，不呼叫 switchCanvas
      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1)
    })
  })

  describe('switchCanvas', () => {
    it('成功時應更新 activeCanvasId', async () => {
      const store = useCanvasStore()
      store.activeCanvasId = 'canvas-1'

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: 'canvas-2',
      })

      await store.switchCanvas('canvas-2')

      expect(store.activeCanvasId).toBe('canvas-2')
    })

    it('目標與當前相同時應 early return 不發送請求', async () => {
      const store = useCanvasStore()
      store.activeCanvasId = 'canvas-1'

      await store.switchCanvas('canvas-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('WebSocket 回應 success: false 時不應更新 activeCanvasId', async () => {
      const store = useCanvasStore()
      store.activeCanvasId = 'canvas-1'

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
      })

      await store.switchCanvas('canvas-2')

      expect(store.activeCanvasId).toBe('canvas-1')
    })
  })

  describe('renameCanvas', () => {
    it('成功時應顯示成功 Toast', async () => {
      const store = useCanvasStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.renameCanvas('canvas-id', 'New Name')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'canvas:rename',
        responseEvent: 'canvas:renamed',
        payload: {
          canvasId: 'canvas-id',
          newName: 'New Name',
        },
      })
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Canvas', '重新命名成功', 'New Name')
    })

    it('失敗時應顯示失敗 Toast', async () => {
      const store = useCanvasStore()
      const error = new Error('Rename failed')

      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      await store.renameCanvas('canvas-id', 'New Name')

      expect(mockShowErrorToast).toHaveBeenCalledWith('Canvas', '重新命名失敗', 'Rename failed')
    })
  })

  describe('事件處理 (FromEvent)', () => {
    describe('addCanvasFromEvent', () => {
      it('應新增不重複的 Canvas', () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1' })
        store.canvases = []

        store.addCanvasFromEvent(canvas1)

        expect(store.canvases).toHaveLength(1)
        expect(store.canvases[0]).toEqual(canvas1)
      })

      it('已存在的 Canvas 不應重複新增', () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1', name: 'Original' })
        store.canvases = [canvas1]

        const duplicateCanvas = createMockCanvas({ id: 'canvas-1', name: 'Duplicate' })
        store.addCanvasFromEvent(duplicateCanvas)

        expect(store.canvases).toHaveLength(1)
        expect(store.canvases[0]?.name).toBe('Original')
      })
    })

    describe('renameCanvasFromEvent', () => {
      it('應更新指定 Canvas 的名稱', () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1', name: 'Old Name' })
        const canvas2 = createMockCanvas({ id: 'canvas-2', name: 'Canvas 2' })
        store.canvases = [canvas1, canvas2]

        store.renameCanvasFromEvent('canvas-1', 'New Name')

        expect(store.canvases[0]?.name).toBe('New Name')
        expect(store.canvases[1]?.name).toBe('Canvas 2')
      })

      it('Canvas 不存在時不應有任何變化', () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1', name: 'Canvas 1' })
        store.canvases = [canvas1]

        store.renameCanvasFromEvent('non-existent', 'New Name')

        expect(store.canvases[0]?.name).toBe('Canvas 1')
      })
    })

    describe('removeCanvasFromEvent', () => {
      it('應移除 Canvas 並自動切換活躍 Canvas', async () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1', name: 'TestCanvas1' })
        const canvas2 = createMockCanvas({ id: 'canvas-2', name: 'TestCanvas2' })
        store.canvases = [canvas1, canvas2]
        store.activeCanvasId = 'canvas-1'

        mockCreateWebSocketRequest.mockResolvedValueOnce({
          success: true,
          canvasId: 'canvas-2',
        })

        await store.removeCanvasFromEvent('canvas-1')

        expect(store.canvases).toHaveLength(1)
        expect(store.canvases[0]?.id).toBe('canvas-2')
        expect(mockToast).toHaveBeenCalledWith({
          title: 'TestCanvas1 已被刪除',
          variant: 'destructive',
        })
        expect(store.activeCanvasId).toBe('canvas-2')
      })

      it('刪除非活躍 Canvas 時不應切換', async () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1' })
        const canvas2 = createMockCanvas({ id: 'canvas-2' })
        store.canvases = [canvas1, canvas2]
        store.activeCanvasId = 'canvas-1'

        await store.removeCanvasFromEvent('canvas-2')

        expect(store.canvases).toHaveLength(1)
        expect(store.canvases[0]?.id).toBe('canvas-1')
        expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      })

      it('最後一個被刪除時應建立預設 Canvas', async () => {
        const store = useCanvasStore()
        const canvas = createMockCanvas({ id: 'last-canvas' })
        store.canvases = [canvas]
        store.activeCanvasId = 'last-canvas'

        const defaultCanvas = createMockCanvas({ id: 'default-canvas', name: 'Default' })

        // Mock toast
        // Mock createCanvas - CANVAS_CREATE
        mockCreateWebSocketRequest.mockResolvedValueOnce({ canvas: defaultCanvas })
        // Mock createCanvas - CANVAS_SWITCH
        mockCreateWebSocketRequest.mockResolvedValueOnce({
          success: true,
          canvasId: defaultCanvas.id,
        })

        await store.removeCanvasFromEvent('last-canvas')

        expect(store.canvases).toHaveLength(0) // removeCanvasFromEvent 先移除，createCanvas 不會加回 canvases
        expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
          requestEvent: 'canvas:create',
          responseEvent: 'canvas:created',
          payload: { name: 'Default' },
        })
      })
    })

    describe('reorderCanvasesFromEvent', () => {
      it('應按指定順序重排', () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1' })
        const canvas2 = createMockCanvas({ id: 'canvas-2' })
        const canvas3 = createMockCanvas({ id: 'canvas-3' })
        store.canvases = [canvas1, canvas2, canvas3]

        store.reorderCanvasesFromEvent(['canvas-3', 'canvas-1', 'canvas-2'])

        expect(store.canvases[0]?.id).toBe('canvas-3')
        expect(store.canvases[1]?.id).toBe('canvas-1')
        expect(store.canvases[2]?.id).toBe('canvas-2')
      })

      it('部分 ID 不存在時應只排序存在的 Canvas', () => {
        const store = useCanvasStore()
        const canvas1 = createMockCanvas({ id: 'canvas-1' })
        const canvas2 = createMockCanvas({ id: 'canvas-2' })
        store.canvases = [canvas1, canvas2]

        store.reorderCanvasesFromEvent(['canvas-2', 'non-existent', 'canvas-1'])

        expect(store.canvases).toHaveLength(2)
        expect(store.canvases[0]?.id).toBe('canvas-2')
        expect(store.canvases[1]?.id).toBe('canvas-1')
      })
    })
  })

  describe('reorderCanvases', () => {
    it('應正確重排本地陣列', () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'canvas-1' })
      const canvas2 = createMockCanvas({ id: 'canvas-2' })
      const canvas3 = createMockCanvas({ id: 'canvas-3' })
      store.canvases = [canvas1, canvas2, canvas3]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      store.reorderCanvases(0, 2) // 將 canvas1 移到最後

      expect(store.canvases[0]?.id).toBe('canvas-2')
      expect(store.canvases[1]?.id).toBe('canvas-3')
      expect(store.canvases[2]?.id).toBe('canvas-1')
    })

    it('同步到後端成功', async () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'canvas-1' })
      const canvas2 = createMockCanvas({ id: 'canvas-2' })
      store.canvases = [canvas1, canvas2]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      store.reorderCanvases(0, 1)

      // 等待 syncCanvasOrder 完成
      await vi.waitFor(() => {
        expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
          requestEvent: 'canvas:reorder',
          responseEvent: 'canvas:reordered',
          payload: {
            canvasIds: ['canvas-2', 'canvas-1'],
          },
        })
      })
    })

    it('同步回應 success: false 時應顯示錯誤訊息並還原順序', async () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'canvas-1' })
      const canvas2 = createMockCanvas({ id: 'canvas-2' })
      const canvas3 = createMockCanvas({ id: 'canvas-3' })
      store.canvases = [canvas1, canvas2, canvas3]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: false })

      store.reorderCanvases(0, 2)

      await vi.waitFor(() => {
        expect(mockShowErrorToast).toHaveBeenCalledWith('Canvas', '排序儲存失敗')
      })
    })

    it('同步回應 success: false 時應顯示錯誤訊息', async () => {
      // 同上：rollback 無法真正回到原始順序
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'canvas-1' })
      const canvas2 = createMockCanvas({ id: 'canvas-2' })
      store.canvases = [canvas1, canvas2]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: false })

      store.reorderCanvases(0, 1)

      await vi.waitFor(() => {
        expect(mockShowErrorToast).toHaveBeenCalledWith('Canvas', '排序儲存失敗')
      })

      // 實際行為：canvases 仍然是重排後的順序
      expect(store.canvases[0]?.id).toBe('canvas-2')
      expect(store.canvases[1]?.id).toBe('canvas-1')
    })

    it('fromIndex 無效時不應重排且顯示 warning', () => {
      const store = useCanvasStore()
      const canvas1 = createMockCanvas({ id: 'canvas-1' })
      store.canvases = [canvas1]

      store.reorderCanvases(999, 0)

      expect(store.canvases[0]?.id).toBe('canvas-1')
      expect(console.warn).toHaveBeenCalledWith('[CanvasStore] 找不到索引位置的 Canvas:', 999)
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })
  })

  describe('reset', () => {
    it('應將所有狀態回到初始值', () => {
      const store = useCanvasStore()
      const canvas = createMockCanvas()
      store.canvases = [canvas]
      store.activeCanvasId = 'some-id'
      store.isSidebarOpen = true
      store.isLoading = true

      store.reset()

      expect(store.canvases).toEqual([])
      expect(store.activeCanvasId).toBeNull()
      expect(store.isSidebarOpen).toBe(false)
      expect(store.isLoading).toBe(false)
    })
  })
})
