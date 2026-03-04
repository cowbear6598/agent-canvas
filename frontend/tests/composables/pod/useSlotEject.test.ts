import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { useSlotEject, type UseSlotEjectOptions } from '@/composables/pod/useSlotEject'

interface NotePosition {
  id: string
  x: number
  y: number
}

describe('useSlotEject', () => {
  let slotRef: Ref<HTMLElement | null>
  let mockPodRotation: ReturnType<typeof vi.fn>
  let mockGetNoteById: ReturnType<typeof vi.fn>
  let mockSetNoteAnimating: ReturnType<typeof vi.fn>
  let mockUnbindFromPod: ReturnType<typeof vi.fn>
  let mockGetViewportZoom: ReturnType<typeof vi.fn>
  let mockGetViewportOffset: ReturnType<typeof vi.fn>

  function buildOptions(): UseSlotEjectOptions {
    return {
      slotRef,
      podRotation: mockPodRotation as unknown as UseSlotEjectOptions['podRotation'],
      getNoteById: mockGetNoteById as unknown as UseSlotEjectOptions['getNoteById'],
      setNoteAnimating: mockSetNoteAnimating as unknown as UseSlotEjectOptions['setNoteAnimating'],
      unbindFromPod: mockUnbindFromPod as unknown as UseSlotEjectOptions['unbindFromPod'],
      getViewportZoom: mockGetViewportZoom as unknown as UseSlotEjectOptions['getViewportZoom'],
      getViewportOffset: mockGetViewportOffset as unknown as UseSlotEjectOptions['getViewportOffset'],
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    slotRef = ref<HTMLElement | null>(null)
    mockPodRotation = vi.fn(() => 0)
    mockGetNoteById = vi.fn((id: string) => ({ id, x: 100, y: 200 }) as NotePosition)
    mockSetNoteAnimating = vi.fn()
    mockUnbindFromPod = vi.fn(async () => {})
    mockGetViewportZoom = vi.fn(() => 1)
    mockGetViewportOffset = vi.fn(() => ({ x: 0, y: 0 }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('應回傳 isEjecting ref 和 handleSlotClick 函數', () => {
    const { isEjecting, handleSlotClick } = useSlotEject({
      ...buildOptions(),
    })

    expect(isEjecting.value).toBe(false)
    expect(typeof handleSlotClick).toBe('function')
  })

  describe('handleSlotClick', () => {
    it('正在 ejecting 時不重複觸發', async () => {
      // Mock DOM 元素
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      // Mock getBoundingClientRect
      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 200,
        bottom: 200,
        width: 100,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 200,
        bottom: 160,
        width: 100,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      const { isEjecting, handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      // 第一次呼叫
      const promise1 = handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(isEjecting.value).toBe(true)

      // 第二次呼叫（應被忽略）
      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(mockUnbindFromPod).toHaveBeenCalledTimes(1) // 只呼叫一次

      await promise1
    })

    it('應呼叫 stopPropagation 和 preventDefault', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 200,
        bottom: 200,
        width: 100,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 200,
        bottom: 160,
        width: 100,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const stopPropagationSpy = vi.spyOn(mockEvent, 'stopPropagation')
      const preventDefaultSpy = vi.spyOn(mockEvent, 'preventDefault')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(stopPropagationSpy).toHaveBeenCalled()
      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('note 不存在時應 early return', async () => {
      mockGetNoteById.mockReturnValue(undefined)

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(mockSetNoteAnimating).not.toHaveBeenCalled()
      expect(mockUnbindFromPod).not.toHaveBeenCalled()
    })

    it('slotElement 為 null 時應 early return', async () => {
      slotRef.value = null

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(mockSetNoteAnimating).not.toHaveBeenCalled()
      expect(mockUnbindFromPod).not.toHaveBeenCalled()
    })

    it('找不到 .pod-with-notch 父元素時應 early return', async () => {
      const mockSlotElement = document.createElement('div')
      slotRef.value = mockSlotElement

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(mockSetNoteAnimating).not.toHaveBeenCalled()
      expect(mockUnbindFromPod).not.toHaveBeenCalled()
    })

    it('應計算彈出位置（rotation = 0，向右彈出）', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      // Pod 中心在 (200, 150)，zoom = 1，offset = (0, 0)
      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300, // right - offset.x = 300, / zoom = 300
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      mockPodRotation.mockReturnValue(0)

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      // baseX = 30, baseY = 0, rotation = 0
      // rotatedX = 30 * cos(0) - 0 * sin(0) = 30
      // rotatedY = 30 * sin(0) + 0 * cos(0) = 0
      // podCenterX = (300 - 0) / 1 = 300
      // podCenterY = (150 - 0) / 1 = 150
      // ejectX = 300 + 30 = 330
      // ejectY = 150 + 0 = 150
      expect(mockUnbindFromPod).toHaveBeenCalledWith('pod-1', { mode: 'move-to-position', position: { x: 330, y: 150 } })
    })

    it('應計算彈出位置（rotation = 90，向下彈出）', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      mockPodRotation.mockReturnValue(90)

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      // baseX = 30, baseY = 0, rotation = 90 degrees
      // radians = 90 * Math.PI / 180 = Math.PI / 2
      // rotatedX = 30 * cos(π/2) - 0 * sin(π/2) ≈ 0
      // rotatedY = 30 * sin(π/2) + 0 * cos(π/2) ≈ 30
      // podCenterX = 300, podCenterY = 150
      // ejectX ≈ 300, ejectY ≈ 180
      expect(mockUnbindFromPod).toHaveBeenCalledWith('pod-1', {
        mode: 'move-to-position',
        position: {
          x: expect.closeTo(300, 0.1),
          y: expect.closeTo(180, 0.1),
        },
      })
    })

    it('應計算彈出位置（rotation = 180，向左彈出）', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      mockPodRotation.mockReturnValue(180)

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      // baseX = 30, baseY = 0, rotation = 180 degrees
      // radians = 180 * Math.PI / 180 = Math.PI
      // rotatedX = 30 * cos(π) - 0 * sin(π) ≈ -30
      // rotatedY = 30 * sin(π) + 0 * cos(π) ≈ 0
      // ejectX ≈ 270, ejectY ≈ 150
      expect(mockUnbindFromPod).toHaveBeenCalledWith('pod-1', {
        mode: 'move-to-position',
        position: {
          x: expect.closeTo(270, 0.1),
          y: expect.closeTo(150, 0.1),
        },
      })
    })

    it('應計算彈出位置（rotation = 270，向上彈出）', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      mockPodRotation.mockReturnValue(270)

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      // baseX = 30, baseY = 0, rotation = 270 degrees
      // radians = 270 * Math.PI / 180 = 3π/2
      // rotatedX = 30 * cos(3π/2) - 0 * sin(3π/2) ≈ 0
      // rotatedY = 30 * sin(3π/2) + 0 * cos(3π/2) ≈ -30
      // ejectX ≈ 300, ejectY ≈ 120
      expect(mockUnbindFromPod).toHaveBeenCalledWith('pod-1', {
        mode: 'move-to-position',
        position: {
          x: expect.closeTo(300, 0.1),
          y: expect.closeTo(120, 0.1),
        },
      })
    })

    it('應考慮 viewport zoom（zoom = 2）', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 200,
        left: 200,
        right: 600, // 螢幕座標
        bottom: 400,
        width: 400,
        height: 200,
        x: 200,
        y: 200,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 300,
        left: 200,
        right: 600,
        bottom: 320,
        width: 400,
        height: 20,
        x: 200,
        y: 300,
        toJSON: () => {},
      })

      mockPodRotation.mockReturnValue(0)
      mockGetViewportZoom.mockReturnValue(2)

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      // podCenterX = (600 - 0) / 2 = 300
      // podCenterY = (300 - 0) / 2 = 150
      // ejectX = 300 + 30 = 330
      // ejectY = 150 + 0 = 150
      expect(mockUnbindFromPod).toHaveBeenCalledWith('pod-1', { mode: 'move-to-position', position: { x: 330, y: 150 } })
    })

    it('應考慮 viewport offset', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 150,
        right: 350,
        bottom: 250,
        width: 200,
        height: 100,
        x: 150,
        y: 150,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 200,
        left: 150,
        right: 350,
        bottom: 210,
        width: 200,
        height: 10,
        x: 150,
        y: 200,
        toJSON: () => {},
      })

      mockPodRotation.mockReturnValue(0)
      mockGetViewportOffset.mockReturnValue({ x: 50, y: 50 })

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      // podCenterX = (350 - 50) / 1 = 300
      // podCenterY = (200 - 50) / 1 = 150
      // ejectX = 300 + 30 = 330
      // ejectY = 150 + 0 = 150
      expect(mockUnbindFromPod).toHaveBeenCalledWith('pod-1', { mode: 'move-to-position', position: { x: 330, y: 150 } })
    })

    it('應呼叫 setNoteAnimating 和 unbindFromPod', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(mockSetNoteAnimating).toHaveBeenCalledWith('note-1', true)
      expect(mockUnbindFromPod).toHaveBeenCalledWith('pod-1', expect.objectContaining({ mode: 'move-to-position' }))
    })

    it('完成後應呼叫 onRemoved callback', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(mockOnRemoved).toHaveBeenCalledTimes(1)
    })

    it('300ms 後應重置 isEjecting 和 animating', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      const { isEjecting, handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      await handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)

      expect(isEjecting.value).toBe(true)
      expect(mockSetNoteAnimating).toHaveBeenCalledWith('note-1', true)

      // 快轉 300ms
      vi.advanceTimersByTime(300)

      expect(isEjecting.value).toBe(false)
      expect(mockSetNoteAnimating).toHaveBeenCalledWith('note-1', false)
    })

    it('unbindFromPod 失敗時應拋出錯誤', async () => {
      const mockSlotElement = document.createElement('div')
      const mockPodElement = document.createElement('div')
      mockPodElement.className = 'pod-with-notch'
      mockPodElement.appendChild(mockSlotElement)
      slotRef.value = mockSlotElement

      vi.spyOn(mockPodElement, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => {},
      })
      vi.spyOn(mockSlotElement, 'getBoundingClientRect').mockReturnValue({
        top: 150,
        left: 100,
        right: 300,
        bottom: 160,
        width: 200,
        height: 10,
        x: 100,
        y: 150,
        toJSON: () => {},
      })

      mockUnbindFromPod.mockRejectedValue(new Error('解綁失敗'))

      const { handleSlotClick } = useSlotEject({
        ...buildOptions(),
      })

      const mockEvent = new MouseEvent('click')
      const mockOnRemoved = vi.fn()

      // 不應 throw error
      await expect(handleSlotClick(mockEvent, 'note-1', 'pod-1', mockOnRemoved)).rejects.toThrow('解綁失敗')

      // 仍應設定 animating
      expect(mockSetNoteAnimating).toHaveBeenCalledWith('note-1', true)
    })
  })
})
