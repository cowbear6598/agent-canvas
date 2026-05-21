import { describe, it, expect, vi } from 'vitest'
import { webSocketMockFactory } from '@tests/helpers/mockWebSocket'
import { setupStoreTest, mockErrorSanitizerFactory, mockToastFactory } from '@tests/helpers/testSetup'
import { useCanvasStore } from '@/stores/canvasStore'
import { requireActiveCanvas, getActiveCanvasIdOrWarn } from '@/utils/canvasGuard'

vi.mock('@/services/websocket', () => webSocketMockFactory())

vi.mock('@/composables/useToast', () => mockToastFactory())

vi.mock('@/utils/errorSanitizer', () => mockErrorSanitizerFactory())

describe('canvasGuard', () => {
  setupStoreTest()

  describe('requireActiveCanvas', () => {
    it('有 activeCanvasId 時回傳 id', () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-123'

      const result = requireActiveCanvas()

      expect(result).toBe('canvas-123')
    })

    it('無 activeCanvasId 時拋出錯誤', () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      expect(() => requireActiveCanvas()).toThrow('沒有啟用的畫布')
    })
  })

  describe('getActiveCanvasIdOrWarn', () => {
    it('有 activeCanvasId 時回傳 id', () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-456'

      const result = getActiveCanvasIdOrWarn('TestContext')

      expect(result).toBe('canvas-456')
    })

    it('無 activeCanvasId 時回傳 null 並 warn', () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = getActiveCanvasIdOrWarn('TestContext')

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith('[TestContext] 沒有啟用的畫布')
    })
  })
})
