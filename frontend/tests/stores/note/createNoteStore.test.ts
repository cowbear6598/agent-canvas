import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket } from '../../helpers/mockWebSocket'
import { createMockNote, createMockCanvas } from '../../helpers/factories'
import { useCanvasStore } from '@/stores/canvasStore'
import { createNoteStore, type NoteStoreConfig } from '@/stores/note/createNoteStore'
import type { BaseNote } from '@/types'
import type { Group } from '@/types/group'

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
const mockToast = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
    toast: mockToast,
  }),
}))

interface TestItem {
  id: string
  name: string
  groupId?: string | null
}

interface TestNote extends BaseNote {
  [key: string]: unknown
  testItemId: string
}

function createTestConfig(overrides?: Partial<NoteStoreConfig<TestItem>>): NoteStoreConfig<TestItem> {
  return {
    storeName: 'test',
    relationship: 'one-to-many',
    responseItemsKey: 'items',
    itemIdField: 'testItemId',
    events: {
      listItems: { request: 'test:list-items', response: 'test:items-listed' },
      listNotes: { request: 'test:list-notes', response: 'test:notes-listed' },
      createNote: { request: 'test:create-note', response: 'test:note-created' },
      updateNote: { request: 'test:update-note', response: 'test:note-updated' },
      deleteNote: { request: 'test:delete-note', response: 'test:note-deleted' },
    },
    bindEvents: {
      request: 'test:bind',
      response: 'test:bound',
    },
    unbindEvents: {
      request: 'test:unbind',
      response: 'test:unbound',
    },
    deleteItemEvents: {
      request: 'test:delete-item',
      response: 'test:item-deleted',
    },
    groupEvents: {
      listGroups: { request: 'test:list-groups', response: 'test:groups-listed' },
      createGroup: { request: 'test:create-group', response: 'test:group-created' },
      deleteGroup: { request: 'test:delete-group', response: 'test:group-deleted' },
      moveItemToGroup: { request: 'test:move-to-group', response: 'test:moved-to-group' },
    },
    createNotePayload: (item: TestItem) => ({ testItemId: item.id }),
    getItemId: (item: TestItem) => item.id,
    getItemName: (item: TestItem) => item.name,
    ...overrides,
  }
}

describe('createNoteStore', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()
  })

  describe('初始狀態', () => {
    it('availableItems 應為空陣列', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.availableItems).toEqual([])
    })

    it('notes 應為空陣列', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.notes).toEqual([])
    })

    it('isLoading 應為 false', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.isLoading).toBe(false)
    })

    it('error 應為 null', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.error).toBeNull()
    })

    it('groups 應為空陣列', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.groups).toEqual([])
    })

    it('draggedNoteId 應為 null', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.draggedNoteId).toBeNull()
    })

    it('animatingNoteIds 應為空 Set', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.animatingNoteIds).toBeInstanceOf(Set)
      expect(store.animatingNoteIds.size).toBe(0)
    })

    it('isDraggingNote 應為 false', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.isDraggingNote).toBe(false)
    })

    it('isOverTrash 應為 false', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.isOverTrash).toBe(false)
    })

    it('expandedGroupIds 應為空 Set', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(store.expandedGroupIds).toBeInstanceOf(Set)
      expect(store.expandedGroupIds.size).toBe(0)
    })
  })

  describe('getters', () => {
    describe('typedAvailableItems', () => {
      it('應返回型別化的 availableItems', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const items: TestItem[] = [
          { id: 'item-1', name: 'Item 1' },
          { id: 'item-2', name: 'Item 2' },
        ]
        store.availableItems = items as unknown[]

        const result = store.typedAvailableItems

        expect(result).toEqual(items)
      })
    })

    describe('typedNotes', () => {
      it('應返回型別化的 notes', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note1 = { ...createMockNote('skill'), testItemId: 'item-1' } as TestNote
        const note2 = { ...createMockNote('skill'), testItemId: 'item-2' } as TestNote
        store.notes = [note1, note2]

        const result = store.typedNotes

        expect(result).toEqual([note1, note2])
      })
    })

    describe('getUnboundNotes', () => {
      it('應篩選 boundToPodId 為 null 的 Note', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const unboundNote = { ...createMockNote('skill'), boundToPodId: null, testItemId: 'item-1' } as TestNote
        const boundNote = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-2' } as TestNote
        store.notes = [unboundNote, boundNote]

        const result = store.getUnboundNotes

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual(unboundNote)
      })

      it('所有 Note 都綁定時應返回空陣列', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const boundNote1 = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        const boundNote2 = { ...createMockNote('skill'), boundToPodId: 'pod-2', testItemId: 'item-2' } as TestNote
        store.notes = [boundNote1, boundNote2]

        const result = store.getUnboundNotes

        expect(result).toEqual([])
      })
    })

    describe('getNotesByPodId (one-to-one)', () => {
      it('one-to-one 模式應僅回傳一個 Note', () => {
        const config = createTestConfig({ relationship: 'one-to-one' })
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note1 = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        const note2 = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-2' } as TestNote
        store.notes = [note1, note2]

        const result = store.getNotesByPodId('pod-1')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual(note1)
      })

      it('one-to-one 模式找不到時應返回空陣列', () => {
        const config = createTestConfig({ relationship: 'one-to-one' })
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        store.notes = [note]

        const result = store.getNotesByPodId('pod-2')

        expect(result).toEqual([])
      })
    })

    describe('getNotesByPodId (one-to-many)', () => {
      it('one-to-many 模式應回傳多個 Note', () => {
        const config = createTestConfig({ relationship: 'one-to-many' })
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note1 = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        const note2 = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-2' } as TestNote
        const note3 = { ...createMockNote('skill'), boundToPodId: 'pod-2', testItemId: 'item-3' } as TestNote
        store.notes = [note1, note2, note3]

        const result = store.getNotesByPodId('pod-1')

        expect(result).toHaveLength(2)
        expect(result[0]).toEqual(note1)
        expect(result[1]).toEqual(note2)
      })

      it('one-to-many 模式找不到時應返回空陣列', () => {
        const config = createTestConfig({ relationship: 'one-to-many' })
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        store.notes = [note]

        const result = store.getNotesByPodId('pod-2')

        expect(result).toEqual([])
      })
    })

    describe('getNoteById', () => {
      it('應依 id 找到 Note', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note1 = { ...createMockNote('skill', { id: 'note-1' }), testItemId: 'item-1' } as TestNote
        const note2 = { ...createMockNote('skill', { id: 'note-2' }), testItemId: 'item-2' } as TestNote
        store.notes = [note1, note2]

        const result = store.getNoteById('note-2')

        expect(result).toEqual(note2)
      })

      it('找不到時應返回 undefined', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note = { ...createMockNote('skill', { id: 'note-1' }), testItemId: 'item-1' } as TestNote
        store.notes = [note]

        const result = store.getNoteById('non-existent')

        expect(result).toBeUndefined()
      })
    })

    describe('isNoteAnimating', () => {
      it('noteId 在 animatingNoteIds Set 中時應返回 true', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.animatingNoteIds = new Set(['note-1', 'note-2'])

        expect(store.isNoteAnimating('note-1')).toBe(true)
      })

      it('noteId 不在 animatingNoteIds Set 中時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.animatingNoteIds = new Set(['note-1'])

        expect(store.isNoteAnimating('note-2')).toBe(false)
      })
    })

    describe('canDeleteDraggedNote', () => {
      it('有 draggedNoteId 且未綁定時應返回 true', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const unboundNote = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: null, testItemId: 'item-1' } as TestNote
        store.notes = [unboundNote]
        store.draggedNoteId = 'note-1'

        expect(store.canDeleteDraggedNote).toBe(true)
      })

      it('draggedNoteId 為 null 時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const unboundNote = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: null, testItemId: 'item-1' } as TestNote
        store.notes = [unboundNote]
        store.draggedNoteId = null

        expect(store.canDeleteDraggedNote).toBe(false)
      })

      it('draggedNote 已綁定時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const boundNote = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        store.notes = [boundNote]
        store.draggedNoteId = 'note-1'

        expect(store.canDeleteDraggedNote).toBe(false)
      })

      it('draggedNote 不存在時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.notes = []
        store.draggedNoteId = 'non-existent'

        expect(store.canDeleteDraggedNote).toBe(false)
      })
    })

    describe('isItemInUse', () => {
      it('item 有綁定到 Pod 的 Note 時應返回 true', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const boundNote = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        store.notes = [boundNote]

        expect(store.isItemInUse('item-1')).toBe(true)
      })

      it('item 沒有綁定到 Pod 的 Note 時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const unboundNote = { ...createMockNote('skill'), boundToPodId: null, testItemId: 'item-1' } as TestNote
        store.notes = [unboundNote]

        expect(store.isItemInUse('item-1')).toBe(false)
      })

      it('item 不存在時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        expect(store.isItemInUse('non-existent')).toBe(false)
      })
    })

    describe('isItemBoundToPod', () => {
      it('item 綁定到指定 Pod 時應返回 true', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const boundNote = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        store.notes = [boundNote]

        expect(store.isItemBoundToPod('item-1', 'pod-1')).toBe(true)
      })

      it('item 綁定到其他 Pod 時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const boundNote = { ...createMockNote('skill'), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
        store.notes = [boundNote]

        expect(store.isItemBoundToPod('item-1', 'pod-2')).toBe(false)
      })

      it('item 未綁定時應返回 false', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const unboundNote = { ...createMockNote('skill'), boundToPodId: null, testItemId: 'item-1' } as TestNote
        store.notes = [unboundNote]

        expect(store.isItemBoundToPod('item-1', 'pod-1')).toBe(false)
      })
    })

    describe('getSortedItemsWithGroups', () => {
      it('groups 和 rootItems 應分別排序', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.groups = [
          { id: 'group-2', name: 'Group B', type: 'outputStyle' },
          { id: 'group-1', name: 'Group A', type: 'outputStyle' },
        ] as Group[]
        store.availableItems = [
          { id: 'item-3', name: 'Item C' },
          { id: 'item-1', name: 'Item A' },
          { id: 'item-2', name: 'Item B', groupId: 'group-1' },
        ] as unknown[]

        const result = store.getSortedItemsWithGroups

        expect(result.groups).toHaveLength(2)
        expect(result.groups[0]!.name).toBe('Group A')
        expect(result.groups[1]!.name).toBe('Group B')
        expect(result.rootItems).toHaveLength(2)
        expect(result.rootItems[0]!.name).toBe('Item A')
        expect(result.rootItems[1]!.name).toBe('Item C')
      })

      it('沒有 groups 時應只返回排序的 rootItems', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.groups = []
        store.availableItems = [
          { id: 'item-2', name: 'Item B' },
          { id: 'item-1', name: 'Item A' },
        ] as unknown[]

        const result = store.getSortedItemsWithGroups

        expect(result.groups).toEqual([])
        expect(result.rootItems).toHaveLength(2)
        expect(result.rootItems[0]!.name).toBe('Item A')
        expect(result.rootItems[1]!.name).toBe('Item B')
      })

      it('所有 items 都有 groupId 時 rootItems 應為空陣列', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.groups = [{ id: 'group-1', name: 'Group A', type: 'outputStyle' }] as Group[]
        store.availableItems = [
          { id: 'item-1', name: 'Item A', groupId: 'group-1' },
          { id: 'item-2', name: 'Item B', groupId: 'group-1' },
        ] as unknown[]

        const result = store.getSortedItemsWithGroups

        expect(result.groups).toHaveLength(1)
        expect(result.rootItems).toEqual([])
      })
    })
  })

  describe('loadItems', () => {
    it('成功時應設定 availableItems、isLoading 切換', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      const items = [
        { id: 'item-1', name: 'Item 1' },
        { id: 'item-2', name: 'Item 2' },
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ items })

      await store.loadItems()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:list-items',
        responseEvent: 'test:items-listed',
        payload: { canvasId: 'canvas-1' },
      })
      expect(store.availableItems).toEqual(items)
      expect(store.isLoading).toBe(false)
      expect(store.error).toBeNull()
    })

    it('無 activeCanvasId 時不應載入', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      await store.loadItems()

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.isLoading).toBe(false)
    })

    it('失敗時應設定 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      await store.loadItems()

      expect(store.error).toBe('載入失敗')
      expect(store.isLoading).toBe(false)
    })

    it('response 無對應 key 時不應設定 availableItems', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      await store.loadItems()

      expect(store.availableItems).toEqual([])
      expect(store.isLoading).toBe(false)
    })
  })

  describe('loadNotesFromBackend', () => {
    it('成功時應設定 notes', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      const notes = [
        { ...createMockNote('skill'), testItemId: 'item-1' },
        { ...createMockNote('skill'), testItemId: 'item-2' },
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ notes })

      await store.loadNotesFromBackend()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:list-notes',
        responseEvent: 'test:notes-listed',
        payload: { canvasId: 'canvas-1' },
      })
      expect(store.notes).toEqual(notes)
      expect(store.isLoading).toBe(false)
      expect(store.error).toBeNull()
    })

    it('無 activeCanvasId 時不應載入', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      await store.loadNotesFromBackend()

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.isLoading).toBe(false)
    })

    it('失敗時應設定 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      await store.loadNotesFromBackend()

      expect(store.error).toBe('載入失敗')
      expect(store.isLoading).toBe(false)
    })
  })

  describe('createNote', () => {
    it('應發送 WebSocket 請求', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const item: TestItem = { id: 'item-1', name: 'Item 1' }
      store.availableItems = [item] as unknown[]

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      await store.createNote('item-1', 300, 400)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:create-note',
        responseEvent: 'test:note-created',
        payload: {
          canvasId: 'canvas-1',
          testItemId: 'item-1',
          name: 'Item 1',
          x: 300,
          y: 400,
          boundToPodId: null,
          originalPosition: null,
        },
      })
    })

    it('item 不存在時不應發送請求', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      await store.createNote('non-existent', 300, 400)

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('無 activeCanvasId 時應 throw Error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const item: TestItem = { id: 'item-1', name: 'Item 1' }
      store.availableItems = [item] as unknown[]

      await expect(store.createNote('item-1', 300, 400)).rejects.toThrow(
        '沒有啟用的畫布'
      )
    })
  })

  describe('updateNotePosition', () => {
    it('成功時應更新 note 座標', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1', x: 100, y: 200 }), testItemId: 'item-1' } as TestNote
      store.notes = [note]

      const updatedNote = { ...note, x: 300, y: 400 }
      mockCreateWebSocketRequest.mockResolvedValueOnce({ note: updatedNote })

      await store.updateNotePosition('note-1', 300, 400)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:update-note',
        responseEvent: 'test:note-updated',
        payload: {
          canvasId: 'canvas-1',
          noteId: 'note-1',
          x: 300,
          y: 400,
        },
      })
      expect(store.notes[0]?.x).toBe(300)
      expect(store.notes[0]?.y).toBe(400)
    })

    it('失敗時應 rollback 到原始座標', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1', x: 100, y: 200 }), testItemId: 'item-1' } as TestNote
      store.notes = [note]

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      await store.updateNotePosition('note-1', 300, 400)

      expect(store.notes[0]?.x).toBe(100)
      expect(store.notes[0]?.y).toBe(200)
    })

    it('note 不存在時不應報錯', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      await expect(store.updateNotePosition('non-existent', 300, 400)).resolves.not.toThrow()
    })
  })

  describe('updateNotePositionLocal', () => {
    it('應直接更新本地 note 座標', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1', x: 100, y: 200 }), testItemId: 'item-1' } as TestNote
      store.notes = [note]

      store.updateNotePositionLocal('note-1', 300, 400)

      expect(store.notes[0]?.x).toBe(300)
      expect(store.notes[0]?.y).toBe(400)
    })

    it('note 不存在時不應報錯', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(() => store.updateNotePositionLocal('non-existent', 300, 400)).not.toThrow()
    })
  })

  describe('bindToPod', () => {
    it('one-to-one 時如 Pod 已有綁定應先 unbind', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ relationship: 'one-to-one' })
      const store = createNoteStore<TestItem, TestNote>(config)()
      const existingNote = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
      const newNote = { ...createMockNote('skill', { id: 'note-2' }), boundToPodId: null, testItemId: 'item-2' } as TestNote
      store.notes = [existingNote, newNote]

      mockCreateWebSocketRequest.mockResolvedValue({})

      await store.bindToPod('note-2', 'pod-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(4)
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:unbind',
        responseEvent: 'test:unbound',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
        },
      })
    })

    it('應發送 bind 和 update 兩個 WebSocket 請求', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1', x: 300, y: 400 }), boundToPodId: null, testItemId: 'item-1' } as TestNote
      store.notes = [note]

      mockCreateWebSocketRequest.mockResolvedValue({})

      await store.bindToPod('note-1', 'pod-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:bind',
        responseEvent: 'test:bound',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
          testItemId: 'item-1',
        },
      })
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:update-note',
        responseEvent: 'test:note-updated',
        payload: {
          canvasId: 'canvas-1',
          noteId: 'note-1',
          boundToPodId: 'pod-1',
          originalPosition: { x: 300, y: 400 },
        },
      })
    })

    it('無 bindEvents config 時不應操作', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ bindEvents: undefined })
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: null, testItemId: 'item-1' } as TestNote
      store.notes = [note]

      await store.bindToPod('note-1', 'pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('note 不存在時不應操作', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      await store.bindToPod('non-existent', 'pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })
  })

  describe('unbindFromPod', () => {
    it('one-to-one 且有 unbindEvents 時應操作', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ relationship: 'one-to-one' })
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
      store.notes = [note]

      mockCreateWebSocketRequest.mockResolvedValue({})

      await store.unbindFromPod('pod-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:unbind',
        responseEvent: 'test:unbound',
        payload: {
          canvasId: 'canvas-1',
          podId: 'pod-1',
        },
      })
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:update-note',
        responseEvent: 'test:note-updated',
        payload: {
          canvasId: 'canvas-1',
          noteId: 'note-1',
          boundToPodId: null,
          originalPosition: null,
        },
      })
    })

    it('returnToOriginal: true 時應使用 originalPosition', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ relationship: 'one-to-one' })
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = {
        ...createMockNote('skill', { id: 'note-1', originalPosition: { x: 100, y: 200 } }),
        boundToPodId: 'pod-1',
        testItemId: 'item-1',
      } as TestNote
      store.notes = [note]

      mockCreateWebSocketRequest.mockResolvedValue({})

      await store.unbindFromPod('pod-1', true)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            x: 100,
            y: 200,
          }),
        })
      )
    })

    it('提供 targetPosition 時應使用 targetPosition', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ relationship: 'one-to-one' })
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
      store.notes = [note]

      mockCreateWebSocketRequest.mockResolvedValue({})

      await store.unbindFromPod('pod-1', false, { x: 500, y: 600 })

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            x: 500,
            y: 600,
          }),
        })
      )
    })

    it('one-to-many 時不應操作', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ relationship: 'one-to-many' })
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
      store.notes = [note]

      await store.unbindFromPod('pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('無 unbindEvents 時不應操作', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ relationship: 'one-to-one', unbindEvents: undefined })
      const store = createNoteStore<TestItem, TestNote>(config)()
      const note = { ...createMockNote('skill', { id: 'note-1' }), boundToPodId: 'pod-1', testItemId: 'item-1' } as TestNote
      store.notes = [note]

      await store.unbindFromPod('pod-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })
  })

  describe('deleteNote', () => {
    it('應發送 WebSocket 請求', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      mockCreateWebSocketRequest.mockResolvedValue({})

      await store.deleteNote('note-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:delete-note',
        responseEvent: 'test:note-deleted',
        payload: {
          canvasId: 'canvas-1',
          noteId: 'note-1',
        },
      })
    })
  })

  describe('deleteItem', () => {
    it('成功時應從 availableItems 移除、刪除相關 notes、顯示成功 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const item: TestItem = { id: 'item-1', name: 'Item 1' }
      store.availableItems = [item] as unknown[]
      const note1 = { ...createMockNote('skill', { id: 'note-1' }), testItemId: 'item-1' } as TestNote
      const note2 = { ...createMockNote('skill', { id: 'note-2' }), testItemId: 'item-2' } as TestNote
      store.notes = [note1, note2]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        deletedNoteIds: ['note-1'],
      })

      await store.deleteItem('item-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'test:delete-item',
        responseEvent: 'test:item-deleted',
        payload: {
          canvasId: 'canvas-1',
          testItemId: 'item-1',
        },
      })
      expect(store.availableItems).toHaveLength(0)
      expect(store.notes).toHaveLength(1)
      expect(store.notes[0]?.id).toBe('note-2')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Note', '刪除成功', 'Item 1')
    })

    it('WebSocket 失敗時靜默失敗，不顯示 Toast，項目保持不變', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const item: TestItem = { id: 'item-1', name: 'Item 1' }
      store.availableItems = [item] as unknown[]

      const error = new Error('Delete failed')
      mockCreateWebSocketRequest.mockRejectedValueOnce(error)

      await store.deleteItem('item-1')

      expect(mockToast).not.toHaveBeenCalled()
      expect(store.availableItems).toHaveLength(1)
    })

    it('無 deleteItemEvents 時不應操作', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig({ deleteItemEvents: undefined })
      const store = createNoteStore<TestItem, TestNote>(config)()

      await store.deleteItem('item-1')

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('WebSocket 回傳失敗時靜默失敗，不顯示 Toast，項目保持不變', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const item: TestItem = { id: 'item-1', name: 'Item 1' }
      store.availableItems = [item] as unknown[]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: false })

      await store.deleteItem('item-1')

      expect(mockShowErrorToast).not.toHaveBeenCalled()
      expect(store.availableItems).toHaveLength(1)
    })

    it('WebSocket 回傳 null 時靜默失敗，項目保持不變', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()
      const item: TestItem = { id: 'item-1', name: 'Item 1' }
      store.availableItems = [item] as unknown[]

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      await store.deleteItem('item-1')

      expect(mockShowErrorToast).not.toHaveBeenCalled()
      expect(store.availableItems).toHaveLength(1)
    })
  })

  describe('事件處理 FromEvent', () => {
    describe('addNoteFromEvent', () => {
      it('應新增 Note 到 notes 陣列', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note = { ...createMockNote('skill'), testItemId: 'item-1' } as TestNote

        store.addNoteFromEvent(note)

        expect(store.notes).toHaveLength(1)
        expect(store.notes[0]).toEqual(note)
      })

      it('不應重複新增相同 id 的 Note', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note = { ...createMockNote('skill', { id: 'note-1' }), testItemId: 'item-1' } as TestNote
        store.notes = [note]

        store.addNoteFromEvent(note)

        expect(store.notes).toHaveLength(1)
      })
    })

    describe('updateNoteFromEvent', () => {
      it('應替換既有 Note', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const originalNote = { ...createMockNote('skill', { id: 'note-1', name: 'Original' }), testItemId: 'item-1' } as TestNote
        store.notes = [originalNote]

        const updatedNote = { ...createMockNote('skill', { id: 'note-1', name: 'Updated' }), testItemId: 'item-1' } as TestNote
        store.updateNoteFromEvent(updatedNote)

        expect(store.notes).toHaveLength(1)
        expect(store.notes[0]?.name).toBe('Updated')
      })

      it('Note 不存在時不應報錯', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note = { ...createMockNote('skill', { id: 'non-existent' }), testItemId: 'item-1' } as TestNote

        expect(() => store.updateNoteFromEvent(note)).not.toThrow()
      })
    })

    describe('removeNoteFromEvent', () => {
      it('應移除 Note', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const note1 = { ...createMockNote('skill', { id: 'note-1' }), testItemId: 'item-1' } as TestNote
        const note2 = { ...createMockNote('skill', { id: 'note-2' }), testItemId: 'item-2' } as TestNote
        store.notes = [note1, note2]

        store.removeNoteFromEvent('note-1')

        expect(store.notes).toHaveLength(1)
        expect(store.notes[0]?.id).toBe('note-2')
      })

      it('Note 不存在時不應報錯', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        expect(() => store.removeNoteFromEvent('non-existent')).not.toThrow()
      })
    })

    describe('addItemFromEvent', () => {
      it('應新增 item 到 availableItems', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const item: TestItem = { id: 'item-1', name: 'Item 1' }

        store.addItemFromEvent(item)

        expect(store.availableItems).toHaveLength(1)
        expect(store.availableItems[0]).toEqual(item)
      })

      it('不應重複新增相同 id 的 item', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const item: TestItem = { id: 'item-1', name: 'Item 1' }
        store.availableItems = [item] as unknown[]

        store.addItemFromEvent(item)

        expect(store.availableItems).toHaveLength(1)
      })
    })

    describe('removeItemFromEvent', () => {
      it('應移除 item 及相關 notes', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const item1: TestItem = { id: 'item-1', name: 'Item 1' }
        const item2: TestItem = { id: 'item-2', name: 'Item 2' }
        store.availableItems = [item1, item2] as unknown[]
        const note1 = { ...createMockNote('skill', { id: 'note-1' }), testItemId: 'item-1' } as TestNote
        const note2 = { ...createMockNote('skill', { id: 'note-2' }), testItemId: 'item-2' } as TestNote
        store.notes = [note1, note2]

        store.removeItemFromEvent('item-1', ['note-1'])

        expect(store.availableItems).toHaveLength(1)
        expect((store.availableItems[0] as TestItem).id).toBe('item-2')
        expect(store.notes).toHaveLength(1)
        expect(store.notes[0]?.id).toBe('note-2')
      })

      it('無 deletedNoteIds 時應只移除 item', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const item1: TestItem = { id: 'item-1', name: 'Item 1' }
        const item2: TestItem = { id: 'item-2', name: 'Item 2' }
        store.availableItems = [item1, item2] as unknown[]
        const note1 = { ...createMockNote('skill', { id: 'note-1' }), testItemId: 'item-1' } as TestNote
        store.notes = [note1]

        store.removeItemFromEvent('item-1')

        expect(store.availableItems).toHaveLength(1)
        expect(store.notes).toHaveLength(1)
      })
    })

    describe('addGroupFromEvent', () => {
      it('應新增 group', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const group: Group = { id: 'group-1', name: 'Group 1', type: 'outputStyle' }

        store.addGroupFromEvent(group)

        expect(store.groups).toHaveLength(1)
        expect(store.groups[0]).toEqual(group)
      })

      it('不應重複新增相同 id 的 group', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const group: Group = { id: 'group-1', name: 'Group 1', type: 'outputStyle' }
        store.groups = [group]

        store.addGroupFromEvent(group)

        expect(store.groups).toHaveLength(1)
      })
    })

    describe('removeGroupFromEvent', () => {
      it('應移除 group', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const group1: Group = { id: 'group-1', name: 'Group 1', type: 'outputStyle' }
        const group2: Group = { id: 'group-2', name: 'Group 2', type: 'outputStyle' }
        store.groups = [group1, group2]

        store.removeGroupFromEvent('group-1')

        expect(store.groups).toHaveLength(1)
        expect(store.groups[0]?.id).toBe('group-2')
      })

      it('group 不存在時不應報錯', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        expect(() => store.removeGroupFromEvent('non-existent')).not.toThrow()
      })
    })
  })

  describe('拖曳狀態', () => {
    describe('setDraggedNote', () => {
      it('應設定 draggedNoteId', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        store.setDraggedNote('note-1')

        expect(store.draggedNoteId).toBe('note-1')
      })

      it('可以清除 draggedNoteId', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.draggedNoteId = 'note-1'

        store.setDraggedNote(null)

        expect(store.draggedNoteId).toBeNull()
      })
    })

    describe('setNoteAnimating', () => {
      it('isAnimating: true 時應新增到 animatingNoteIds', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        store.setNoteAnimating('note-1', true)

        expect(store.animatingNoteIds.has('note-1')).toBe(true)
      })

      it('isAnimating: false 時應從 animatingNoteIds 移除', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.animatingNoteIds = new Set(['note-1'])

        store.setNoteAnimating('note-1', false)

        expect(store.animatingNoteIds.has('note-1')).toBe(false)
      })
    })

    describe('setIsDraggingNote', () => {
      it('應設定 isDraggingNote', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        store.setIsDraggingNote(true)

        expect(store.isDraggingNote).toBe(true)
      })

      it('可以清除 isDraggingNote', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.isDraggingNote = true

        store.setIsDraggingNote(false)

        expect(store.isDraggingNote).toBe(false)
      })
    })

    describe('setIsOverTrash', () => {
      it('應設定 isOverTrash', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        store.setIsOverTrash(true)

        expect(store.isOverTrash).toBe(true)
      })

      it('可以清除 isOverTrash', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.isOverTrash = true

        store.setIsOverTrash(false)

        expect(store.isOverTrash).toBe(false)
      })
    })
  })

  describe('群組展開', () => {
    describe('toggleGroupExpand', () => {
      it('群組未展開時應展開', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        store.toggleGroupExpand('group-1')

        expect(store.expandedGroupIds.has('group-1')).toBe(true)
      })

      it('群組已展開時應收合', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        store.expandedGroupIds = new Set(['group-1'])

        store.toggleGroupExpand('group-1')

        expect(store.expandedGroupIds.has('group-1')).toBe(false)
      })
    })

    describe('updateItemGroupId', () => {
      it('應更新 item 的 groupId', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const item: TestItem = { id: 'item-1', name: 'Item 1', groupId: null }
        store.availableItems = [item] as unknown[]

        store.updateItemGroupId('item-1', 'group-1')

        expect((store.availableItems[0] as TestItem).groupId).toBe('group-1')
      })

      it('可以清除 groupId', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()
        const item: TestItem = { id: 'item-1', name: 'Item 1', groupId: 'group-1' }
        store.availableItems = [item] as unknown[]

        store.updateItemGroupId('item-1', null)

        expect((store.availableItems[0] as TestItem).groupId).toBeNull()
      })

      it('item 不存在時不應報錯', () => {
        const config = createTestConfig()
        const store = createNoteStore<TestItem, TestNote>(config)()

        expect(() => store.updateItemGroupId('non-existent', 'group-1')).not.toThrow()
      })
    })
  })

  describe('buildCRUDActions', () => {
    function createCRUDConfig(): Parameters<typeof createTestConfig>[0] {
      return {
        crudConfig: {
          resourceType: 'TestResource',
          methodPrefix: 'testResource',
          toastCategory: 'Skill',
          events: {
            create: {
              request: 'output-style:create' as any,
              response: 'output-style:created' as any,
            },
            update: {
              request: 'output-style:update' as any,
              response: 'output-style:updated' as any,
            },
            read: {
              request: 'output-style:read' as any,
              response: 'output-style:read:result' as any,
            },
          },
          payloadConfig: {
            getUpdatePayload: (itemId: string, content: string) => ({ itemId, content }),
            getReadPayload: (itemId: string) => ({ itemId }),
            extractItemFromResponse: {
              create: (response: unknown) => (response as any)?.item,
              update: (response: unknown) => (response as any)?.item,
              read: (response: unknown) => (response as any)?.item,
            },
            updateItemsList: (items: any[], itemId: string, newItem: any) => {
              const index = items.findIndex(i => i.id === itemId)
              if (index !== -1) items.splice(index, 1, newItem)
            },
          },
        },
      }
    }

    it('不提供 crudConfig 時不應產生額外的 CRUD action', () => {
      const config = createTestConfig()
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect((store as any).createTestResource).toBeUndefined()
      expect((store as any).updateTestResource).toBeUndefined()
      expect((store as any).readTestResource).toBeUndefined()
      expect((store as any).deleteTestResource).toBeUndefined()
      expect((store as any).loadTestResources).toBeUndefined()
    })

    it('提供 crudConfig 後 store 應有對應的 createXxx action', () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig(createCRUDConfig())
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(typeof (store as any).createTestResource).toBe('function')
    })

    it('提供 crudConfig 後 store 應有 updateXxx、readXxx、deleteXxx、loadXxxs actions', () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const config = createTestConfig(createCRUDConfig())
      const store = createNoteStore<TestItem, TestNote>(config)()

      expect(typeof (store as any).updateTestResource).toBe('function')
      expect(typeof (store as any).readTestResource).toBe('function')
      expect(typeof (store as any).deleteTestResource).toBe('function')
      expect(typeof (store as any).loadTestResources).toBe('function')
    })
  })
})
