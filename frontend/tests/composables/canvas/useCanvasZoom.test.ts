import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { useCanvasZoom } from '@/composables/canvas/useCanvasZoom'
import { useViewportStore } from '@/stores/pod/viewportStore'

// Mock useCanvasContext
vi.mock('@/composables/canvas/useCanvasContext', () => ({
  useCanvasContext: () => {
    const viewportStore = useViewportStore()
    return { viewportStore }
  },
}))

describe('useCanvasZoom', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
  })

  describe('handleWheel', () => {
    it('向下滾動（deltaY > 0）應縮小（zoom * 0.9）', () => {
      const viewportStore = useViewportStore()
      viewportStore.zoom = 1
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: 100,
        clientX: 500,
        clientY: 400,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 100, top: 50 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      expect(mockEvent.preventDefault).toHaveBeenCalled()
      expect(zoomToSpy).toHaveBeenCalledWith(0.9, 400, 350)
    })

    it('向上滾動（deltaY < 0）應放大（zoom * 1.1）', () => {
      const viewportStore = useViewportStore()
      viewportStore.zoom = 1
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: -100,
        clientX: 600,
        clientY: 300,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 50, top: 100 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      expect(mockEvent.preventDefault).toHaveBeenCalled()
      expect(zoomToSpy).toHaveBeenCalledWith(1.1, 550, 200)
    })

    it('應正確計算滑鼠相對於畫布的位置', () => {
      const viewportStore = useViewportStore()
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: -50,
        clientX: 1000,
        clientY: 800,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 200, top: 150 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      expect(zoomToSpy).toHaveBeenCalledWith(expect.any(Number), 800, 650)
    })

    it('zoom 為 2 時向下滾動應計算為 2 * 0.9 = 1.8', () => {
      const viewportStore = useViewportStore()
      viewportStore.zoom = 2
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: 100,
        clientX: 300,
        clientY: 300,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      expect(zoomToSpy).toHaveBeenCalledWith(1.8, 300, 300)
    })

    it('zoom 為 0.5 時向上滾動應計算為 0.5 * 1.1 = 0.55', () => {
      const viewportStore = useViewportStore()
      viewportStore.zoom = 0.5
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: -100,
        clientX: 400,
        clientY: 500,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      expect(zoomToSpy).toHaveBeenCalledWith(0.55, 400, 500)
    })

    it('應呼叫 event.preventDefault()', () => {
      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: 100,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      expect(mockEvent.preventDefault).toHaveBeenCalled()
    })

    it('deltaY 為 0 時應視為向上滾動（放大）', () => {
      const viewportStore = useViewportStore()
      viewportStore.zoom = 1
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: 0,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      // deltaY === 0 不大於 0，所以應使用 1.1 (放大)
      expect(zoomToSpy).toHaveBeenCalledWith(1.1, 100, 100)
    })

    it('多次滾動應累積縮放效果', () => {
      const viewportStore = useViewportStore()
      viewportStore.zoom = 1
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: 100,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)
      expect(zoomToSpy).toHaveBeenCalledWith(0.9, 100, 100)

      viewportStore.zoom = 0.9

      handleWheel(mockEvent)
      expect(zoomToSpy).toHaveBeenCalledWith(0.81, 100, 100)
    })

    it('應使用 currentTarget 而非 target 計算位置', () => {
      const viewportStore = useViewportStore()
      const zoomToSpy = vi.spyOn(viewportStore, 'zoomTo')

      const { handleWheel } = useCanvasZoom()

      const mockEvent = {
        deltaY: -100,
        clientX: 500,
        clientY: 400,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 100, top: 50 }),
        },
        target: {
          getBoundingClientRect: () => ({ left: 999, top: 999 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent

      handleWheel(mockEvent)

      expect(zoomToSpy).toHaveBeenCalledWith(1.1, 400, 350)
    })
  })
})
