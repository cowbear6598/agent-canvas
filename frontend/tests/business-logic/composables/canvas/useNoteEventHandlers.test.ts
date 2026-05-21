import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { useNoteEventHandlers } from '@/composables/canvas/useNoteEventHandlers'

describe('useNoteEventHandlers', () => {
  let mockStore: {
    updateNotePositionLocal: ReturnType<typeof vi.fn>
    updateNotePosition: ReturnType<typeof vi.fn>
    setIsOverTrash: ReturnType<typeof vi.fn>
    setNoteAnimating: ReturnType<typeof vi.fn>
    deleteNote: ReturnType<typeof vi.fn>
    getNoteById: ReturnType<typeof vi.fn>
  }

  let mockTrashZone: {
    isPointInZone: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllTimers()
    vi.useFakeTimers()

    mockStore = {
      updateNotePositionLocal: vi.fn(),
      updateNotePosition: vi.fn().mockResolvedValue(undefined),
      setIsOverTrash: vi.fn(),
      setNoteAnimating: vi.fn(),
      deleteNote: vi.fn().mockResolvedValue(undefined),
      getNoteById: vi.fn(),
    }

    mockTrashZone = {
      isPointInZone: vi.fn(),
    }
  })

  describe('handleDragEnd - Note 拖曳移動', () => {
    it('拖曳結束時應更新本地座標', () => {
      const trashZoneRef = ref(mockTrashZone)
      const { handleDragEnd } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handleDragEnd({ noteId: 'note-1', x: 100, y: 200 })

      expect(mockStore.updateNotePositionLocal).toHaveBeenCalledWith('note-1', 100, 200)
    })

    it('應處理多次拖曳移動', () => {
      const trashZoneRef = ref(mockTrashZone)
      const { handleDragEnd } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handleDragEnd({ noteId: 'note-1', x: 100, y: 200 })
      handleDragEnd({ noteId: 'note-1', x: 150, y: 250 })
      handleDragEnd({ noteId: 'note-1', x: 200, y: 300 })

      expect(mockStore.updateNotePositionLocal).toHaveBeenCalledTimes(3)
      expect(mockStore.updateNotePositionLocal).toHaveBeenNthCalledWith(1, 'note-1', 100, 200)
      expect(mockStore.updateNotePositionLocal).toHaveBeenNthCalledWith(2, 'note-1', 150, 250)
      expect(mockStore.updateNotePositionLocal).toHaveBeenNthCalledWith(3, 'note-1', 200, 300)
    })

    it('應處理不同 note 的拖曳', () => {
      const trashZoneRef = ref(mockTrashZone)
      const { handleDragEnd } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handleDragEnd({ noteId: 'note-1', x: 100, y: 200 })
      handleDragEnd({ noteId: 'note-2', x: 300, y: 400 })

      expect(mockStore.updateNotePositionLocal).toHaveBeenCalledWith('note-1', 100, 200)
      expect(mockStore.updateNotePositionLocal).toHaveBeenCalledWith('note-2', 300, 400)
    })
  })

  describe('handleDragMove - 垃圾桶檢測', () => {
    it('移動到垃圾桶上方時應設置 isOverTrash 為 true', () => {
      const trashZoneRef = ref(mockTrashZone)
      mockTrashZone.isPointInZone.mockReturnValue(true)

      const { handleDragMove } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handleDragMove({ noteId: 'note-1', screenX: 100, screenY: 200 })

      expect(mockTrashZone.isPointInZone).toHaveBeenCalledWith(100, 200)
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(true)
    })

    it('移動到垃圾桶外時應設置 isOverTrash 為 false', () => {
      const trashZoneRef = ref(mockTrashZone)
      mockTrashZone.isPointInZone.mockReturnValue(false)

      const { handleDragMove } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handleDragMove({ noteId: 'note-1', screenX: 500, screenY: 600 })

      expect(mockTrashZone.isPointInZone).toHaveBeenCalledWith(500, 600)
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })

    it('trashZoneRef 為 null 時應不執行任何操作', () => {
      const trashZoneRef = ref(null)
      const { handleDragMove } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handleDragMove({ noteId: 'note-1', screenX: 100, screenY: 200 })

      expect(mockStore.setIsOverTrash).not.toHaveBeenCalled()
    })

    it('應持續追蹤滑鼠位置變化', () => {
      const trashZoneRef = ref(mockTrashZone)
      mockTrashZone.isPointInZone
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)

      const { handleDragMove } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handleDragMove({ noteId: 'note-1', screenX: 50, screenY: 50 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)

      handleDragMove({ noteId: 'note-1', screenX: 100, screenY: 100 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)

      handleDragMove({ noteId: 'note-1', screenX: 150, screenY: 150 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(true)

      handleDragMove({ noteId: 'note-1', screenX: 160, screenY: 160 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(true)

      handleDragMove({ noteId: 'note-1', screenX: 200, screenY: 200 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })
  })

  describe('handleDragComplete - 未綁定 Note 拖到垃圾桶刪除', () => {
    it('未綁定的 Note 拖到垃圾桶應刪除', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 100, y: 200, boundToPodId: null })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: true, startX: 50, startY: 50 })

      expect(mockStore.deleteNote).toHaveBeenCalledWith('note-1')
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })

    it('刪除後應重置垃圾桶狀態', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 100, y: 200, boundToPodId: null })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: true, startX: 50, startY: 50 })

      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })
  })

  describe('handleDragComplete - 已綁定 Note 不可刪除', () => {
    it('已綁定的 Note 拖到垃圾桶應彈回原位', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 100, y: 200, boundToPodId: 'pod-1' })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: true, startX: 50, startY: 75 })

      expect(mockStore.deleteNote).not.toHaveBeenCalled()
      expect(mockStore.setNoteAnimating).toHaveBeenCalledWith('note-1', true)
      expect(mockStore.updateNotePosition).toHaveBeenCalledWith('note-1', 50, 75)
    })

    it('彈回動畫應在 300ms 後結束', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 100, y: 200, boundToPodId: 'pod-1' })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: true, startX: 50, startY: 75 })

      expect(mockStore.setNoteAnimating).toHaveBeenCalledWith('note-1', true)

      vi.advanceTimersByTime(300)

      expect(mockStore.setNoteAnimating).toHaveBeenCalledWith('note-1', false)
    })

    it('已綁定 Note 彈回後應重置垃圾桶狀態', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 100, y: 200, boundToPodId: 'pod-1' })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: true, startX: 50, startY: 75 })

      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })
  })

  describe('handleDragComplete - 拖曳完成同步', () => {
    it('未拖到垃圾桶時應同步位置到後端', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 300, y: 400, boundToPodId: null })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: false, startX: 100, startY: 200 })

      expect(mockStore.updateNotePosition).toHaveBeenCalledWith('note-1', 300, 400)
      expect(mockStore.deleteNote).not.toHaveBeenCalled()
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })

    it('應使用 note 當前位置而非 startX/startY 同步', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 500, y: 600, boundToPodId: null })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: false, startX: 100, startY: 200 })

      expect(mockStore.updateNotePosition).toHaveBeenCalledWith('note-1', 500, 600)
    })

    it('完成後應重置垃圾桶狀態', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 300, y: 400, boundToPodId: null })

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-1', isOverTrash: false, startX: 100, startY: 200 })

      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })
  })

  describe('handleDragComplete - Note 不存在', () => {
    it('Note 不存在時應不執行任何操作', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue(undefined)

      const { handleDragComplete } = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      await handleDragComplete({ noteId: 'note-999', isOverTrash: true, startX: 100, startY: 200 })

      expect(mockStore.deleteNote).not.toHaveBeenCalled()
      expect(mockStore.updateNotePosition).not.toHaveBeenCalled()
      expect(mockStore.setNoteAnimating).not.toHaveBeenCalled()
    })
  })

  describe('完整拖曳流程', () => {
    it('完整拖曳刪除流程：拖曳 -> 進入垃圾桶 -> 放開刪除', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 100, y: 200, boundToPodId: null })

      const handlers = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handlers.handleDragEnd({ noteId: 'note-1', x: 100, y: 200 })
      expect(mockStore.updateNotePositionLocal).toHaveBeenCalledWith('note-1', 100, 200)

      mockTrashZone.isPointInZone.mockReturnValue(false)
      handlers.handleDragMove({ noteId: 'note-1', screenX: 50, screenY: 50 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)

      mockTrashZone.isPointInZone.mockReturnValue(true)
      handlers.handleDragMove({ noteId: 'note-1', screenX: 150, screenY: 150 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(true)

      await handlers.handleDragComplete({ noteId: 'note-1', isOverTrash: true, startX: 50, startY: 50 })
      expect(mockStore.deleteNote).toHaveBeenCalledWith('note-1')
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })

    it('完整拖曳彈回流程：已綁定 Note 拖到垃圾桶應彈回', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 150, y: 200, boundToPodId: 'pod-1' })

      const handlers = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handlers.handleDragEnd({ noteId: 'note-1', x: 150, y: 200 })

      mockTrashZone.isPointInZone.mockReturnValue(true)
      handlers.handleDragMove({ noteId: 'note-1', screenX: 150, screenY: 150 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(true)

      await handlers.handleDragComplete({ noteId: 'note-1', isOverTrash: true, startX: 50, startY: 75 })
      expect(mockStore.deleteNote).not.toHaveBeenCalled()
      expect(mockStore.updateNotePosition).toHaveBeenCalledWith('note-1', 50, 75)
      expect(mockStore.setNoteAnimating).toHaveBeenCalledWith('note-1', true)

      vi.advanceTimersByTime(300)
      expect(mockStore.setNoteAnimating).toHaveBeenCalledWith('note-1', false)
    })

    it('完整拖曳同步流程：正常拖曳不經過垃圾桶', async () => {
      const trashZoneRef = ref(mockTrashZone)
      mockStore.getNoteById.mockReturnValue({ x: 300, y: 400, boundToPodId: null })

      const handlers = useNoteEventHandlers({ store: mockStore as any, trashZoneRef: trashZoneRef as any })

      handlers.handleDragEnd({ noteId: 'note-1', x: 300, y: 400 })
      expect(mockStore.updateNotePositionLocal).toHaveBeenCalledWith('note-1', 300, 400)

      mockTrashZone.isPointInZone.mockReturnValue(false)
      handlers.handleDragMove({ noteId: 'note-1', screenX: 300, screenY: 400 })
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)

      await handlers.handleDragComplete({ noteId: 'note-1', isOverTrash: false, startX: 100, startY: 200 })
      expect(mockStore.updateNotePosition).toHaveBeenCalledWith('note-1', 300, 400)
      expect(mockStore.deleteNote).not.toHaveBeenCalled()
      expect(mockStore.setIsOverTrash).toHaveBeenCalledWith(false)
    })
  })
})
