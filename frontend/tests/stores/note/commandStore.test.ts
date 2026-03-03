import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../../helpers/mockStoreFactory'
import { mockWebSocketModule, mockCreateWebSocketRequest, resetMockWebSocket } from '../../helpers/mockWebSocket'
import { createMockPod } from '../../helpers/factories'
import { useCommandStore } from '@/stores/note/commandStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Command, CommandNote, Group } from '@/types'

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
  }
})

// 取得 mock 函數的引用
const { useToast } = await import('@/composables/useToast')
const toast = useToast()
const mockShowSuccessToast = toast.showSuccessToast as ReturnType<typeof vi.fn>
const mockShowErrorToast = toast.showErrorToast as ReturnType<typeof vi.fn>

describe('commandStore', () => {
  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()
  })

  describe('初始狀態', () => {
    it('availableItems 應為空陣列', () => {
      const store = useCommandStore()

      expect(store.availableItems).toEqual([])
    })

    it('notes 應為空陣列', () => {
      const store = useCommandStore()

      expect(store.notes).toEqual([])
    })

    it('groups 應為空陣列', () => {
      const store = useCommandStore()

      expect(store.groups).toEqual([])
    })

    it('isLoading 應為 false', () => {
      const store = useCommandStore()

      expect(store.isLoading).toBe(false)
    })

    it('error 應為 null', () => {
      const store = useCommandStore()

      expect(store.error).toBeNull()
    })

    it('draggedNoteId 應為 null', () => {
      const store = useCommandStore()

      expect(store.draggedNoteId).toBeNull()
    })

    it('isDraggingNote 應為 false', () => {
      const store = useCommandStore()

      expect(store.isDraggingNote).toBe(false)
    })

    it('isOverTrash 應為 false', () => {
      const store = useCommandStore()

      expect(store.isOverTrash).toBe(false)
    })

    it('animatingNoteIds 應為空 Set', () => {
      const store = useCommandStore()

      expect(store.animatingNoteIds).toBeInstanceOf(Set)
      expect(store.animatingNoteIds.size).toBe(0)
    })

    it('expandedGroupIds 應為空 Set', () => {
      const store = useCommandStore()

      expect(store.expandedGroupIds).toBeInstanceOf(Set)
      expect(store.expandedGroupIds.size).toBe(0)
    })
  })

  describe('createCommand', () => {
    it('成功時應新增 Command 到 availableItems 並回傳成功結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const newCommand: Command = {
        id: 'cmd-1',
        name: 'Test Command',
        groupId: null,
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        command: newCommand,
      })

      const result = await store.createCommand('Test Command', 'echo "test"')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command:create',
        responseEvent: 'command:created',
        payload: {
          canvasId: 'canvas-1',
          name: 'Test Command',
          content: 'echo "test"',
        },
      })
      expect(result).toEqual({
        success: true,
        command: newCommand,
      })
      expect(store.availableItems).toContainEqual(newCommand)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '建立成功', 'Test Command')
    })

    it('失敗時應回傳錯誤結果並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.createCommand('Test Command', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('建立 Command 失敗')
      expect(store.availableItems).toHaveLength(0)
      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '建立失敗', '建立 Command 失敗')
    })

    it('回應無 command 時應回傳失敗結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.createCommand('Test Command', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('建立 Command 失敗')
    })
  })

  describe('updateCommand', () => {
    it('成功時應更新 availableItems 中的 Command 並回傳成功結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const originalCommand: Command = {
        id: 'cmd-1',
        name: 'Old Name',
        groupId: null,
      }
      store.availableItems = [originalCommand]

      const updatedCommand: Command = {
        id: 'cmd-1',
        name: 'Updated Command',
        groupId: null,
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        command: updatedCommand,
      })

      const result = await store.updateCommand('cmd-1', 'new content')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command:update',
        responseEvent: 'command:updated',
        payload: {
          canvasId: 'canvas-1',
          commandId: 'cmd-1',
          content: 'new content',
        },
      })
      expect(result).toEqual({
        success: true,
        command: updatedCommand,
      })
      expect(store.availableItems[0]).toEqual(updatedCommand)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '更新成功', 'Updated Command')
    })

    it('失敗時應回傳錯誤結果並保持原 availableItems', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const originalCommand: Command = {
        id: 'cmd-1',
        name: 'Old Name',
        groupId: null,
      }
      store.availableItems = [originalCommand]

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.updateCommand('cmd-1', 'content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('更新 Command 失敗')
      expect(store.availableItems[0]).toEqual(originalCommand)
      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '更新失敗', '更新 Command 失敗')
    })

    it('Command 不存在時應回傳失敗（index 為 -1）', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        command: { id: 'cmd-999', name: 'Not in list', groupId: null },
      })

      const result = await store.updateCommand('cmd-999', 'content')

      // updateItemsList 找不到 index，不會更新 items
      expect(store.availableItems).toHaveLength(0)
    })
  })

  describe('readCommand', () => {
    it('成功時應回傳 Command 完整資訊（含 content）', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        command: {
          id: 'cmd-1',
          name: 'Test Command',
          content: 'echo "hello"',
        },
      })

      const result = await store.readCommand('cmd-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command:read',
        responseEvent: 'command:read:result',
        payload: {
          canvasId: 'canvas-1',
          commandId: 'cmd-1',
        },
      })
      expect(result).toEqual({
        id: 'cmd-1',
        name: 'Test Command',
        content: 'echo "hello"',
      })
    })

    it('失敗時應回傳 null', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.readCommand('cmd-1')

      expect(result).toBeNull()
    })

    it('回應無 command 時應回傳 null', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      const result = await store.readCommand('cmd-1')

      expect(result).toBeNull()
    })
  })

  describe('deleteCommand', () => {
    it('應委派到 deleteItem', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const command: Command = {
        id: 'cmd-1',
        name: 'Test Command',
        groupId: null,
      }
      store.availableItems = [command]

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await store.deleteCommand('cmd-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command:delete',
        responseEvent: 'command:deleted',
        payload: {
          canvasId: 'canvas-1',
          commandId: 'cmd-1',
        },
      })
      expect(store.availableItems).toHaveLength(0)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '刪除成功', 'Test Command')
    })
  })

  describe('loadCommands', () => {
    it('應委派到 loadItems', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        commands: [
          { id: 'cmd-1', name: 'Command 1', groupId: null },
          { id: 'cmd-2', name: 'Command 2', groupId: null },
        ],
      })

      await store.loadCommands()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command:list',
        responseEvent: 'command:list:result',
        payload: {
          canvasId: 'canvas-1',
        },
      })
      expect(store.availableItems).toHaveLength(2)
    })

    it('無 activeCanvasId 時應 early return', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useCommandStore()

      await store.loadCommands()

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.isLoading).toBe(false)
    })
  })

  describe('rebuildNotesFromPods', () => {
    it('無 activeCanvasId 時應 early return', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useCommandStore()

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await store.rebuildNotesFromPods([])

      expect(consoleSpy).toHaveBeenCalledWith('[CommandStore] 沒有啟用的畫布')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('應為有 commandId 的 Pod 建立 Note', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      store.availableItems = [
        { id: 'cmd-1', name: 'Test Command', groupId: null },
      ]

      const pod1 = createMockPod({ id: 'pod-1', commandId: 'cmd-1', x: 100, y: 200 })

      const mockNote: CommandNote = {
        id: 'note-1',
        name: 'Test Command',
        commandId: 'cmd-1',
        x: 100,
        y: 100,
        boundToPodId: 'pod-1',
        originalPosition: { x: 100, y: 100 },
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        note: mockNote,
      })

      await store.rebuildNotesFromPods([pod1])

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command-note:create',
        responseEvent: 'command-note:created',
        payload: {
          canvasId: 'canvas-1',
          commandId: 'cmd-1',
          name: 'Test Command',
          x: 100,
          y: 100, // pod.y - 100
          boundToPodId: 'pod-1',
          originalPosition: { x: 100, y: 100 },
        },
      })
      expect(store.notes).toContainEqual(mockNote)
    })

    it('沒有 commandId 的 Pod 應跳過', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const pod1 = createMockPod({ id: 'pod-1', commandId: null })

      await store.rebuildNotesFromPods([pod1])

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.notes).toHaveLength(0)
    })

    it('已有 Note 的 Pod 應跳過', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const existingNote: CommandNote = {
        id: 'note-1',
        name: 'Existing',
        commandId: 'cmd-1',
        x: 100,
        y: 100,
        boundToPodId: 'pod-1',
        originalPosition: null,
      }
      store.notes = [existingNote as any]

      const pod1 = createMockPod({ id: 'pod-1', commandId: 'cmd-1' })

      await store.rebuildNotesFromPods([pod1])

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
      expect(store.notes).toHaveLength(1)
    })

    it('找不到對應 Command 時應使用 commandId 作為 name', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const pod1 = createMockPod({ id: 'pod-1', commandId: 'cmd-unknown', x: 100, y: 200 })

      const mockNote: CommandNote = {
        id: 'note-1',
        name: 'cmd-unknown',
        commandId: 'cmd-unknown',
        x: 100,
        y: 100,
        boundToPodId: 'pod-1',
        originalPosition: { x: 100, y: 100 },
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        note: mockNote,
      })

      await store.rebuildNotesFromPods([pod1])

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command-note:create',
        responseEvent: 'command-note:created',
        payload: {
          canvasId: 'canvas-1',
          commandId: 'cmd-unknown',
          name: 'cmd-unknown',
          x: 100,
          y: 100,
          boundToPodId: 'pod-1',
          originalPosition: { x: 100, y: 100 },
        },
      })
    })

    it('應並行處理多個 Pod', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      store.availableItems = [
        { id: 'cmd-1', name: 'Command 1', groupId: null },
        { id: 'cmd-2', name: 'Command 2', groupId: null },
      ]

      const pod1 = createMockPod({ id: 'pod-1', commandId: 'cmd-1', x: 100, y: 200 })
      const pod2 = createMockPod({ id: 'pod-2', commandId: 'cmd-2', x: 200, y: 300 })

      const mockNote1: CommandNote = {
        id: 'note-1',
        name: 'Command 1',
        commandId: 'cmd-1',
        x: 100,
        y: 100,
        boundToPodId: 'pod-1',
        originalPosition: { x: 100, y: 100 },
      }

      const mockNote2: CommandNote = {
        id: 'note-2',
        name: 'Command 2',
        commandId: 'cmd-2',
        x: 200,
        y: 200,
        boundToPodId: 'pod-2',
        originalPosition: { x: 200, y: 200 },
      }

      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ note: mockNote1 })
        .mockResolvedValueOnce({ note: mockNote2 })

      await store.rebuildNotesFromPods([pod1, pod2])

      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(2)
      expect(store.notes).toHaveLength(2)
      expect(store.notes).toContainEqual(mockNote1)
      expect(store.notes).toContainEqual(mockNote2)
    })

    it('回應無 note 時不應加入 notes 陣列', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const pod1 = createMockPod({ id: 'pod-1', commandId: 'cmd-1' })

      mockCreateWebSocketRequest.mockResolvedValueOnce({})

      await store.rebuildNotesFromPods([pod1])

      expect(store.notes).toHaveLength(0)
    })
  })

  describe('loadGroups', () => {
    it('成功時應設定 groups', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const mockGroups: Group[] = [
        { id: 'group-1', name: 'Group 1', type: 'command' },
        { id: 'group-2', name: 'Group 2', type: 'command' },
      ]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        groups: mockGroups,
      })

      await store.loadGroups()

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:list',
        responseEvent: 'group:list:result',
        payload: {
          canvasId: 'canvas-1',
          type: 'command',
        },
      })
      expect(store.groups).toEqual(mockGroups)
    })

    it('無 activeCanvasId 時應 early return', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useCommandStore()

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await store.loadGroups()

      expect(consoleSpy).toHaveBeenCalledWith('[CommandStore] 沒有啟用的畫布')
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('失敗時不應更新 groups 並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      await store.loadGroups()

      expect(store.groups).toHaveLength(0)
      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '載入群組失敗')
    })
  })

  describe('createGroup', () => {
    it('成功時應加入 groups 並回傳成功結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const mockGroup: Group = {
        id: 'group-1',
        name: 'New Group',
        type: 'command',
      }

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        group: mockGroup,
      })

      const result = await store.createGroup('New Group')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'group:create',
        responseEvent: 'group:created',
        payload: {
          canvasId: 'canvas-1',
          name: 'New Group',
          type: 'command',
        },
      })
      expect(result).toEqual({
        success: true,
        group: mockGroup,
        error: undefined,
      })
      expect(store.groups).toContainEqual(mockGroup)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '建立群組成功', 'New Group')
    })

    it('無 activeCanvasId 時應回傳失敗', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useCommandStore()

      const result = await store.createGroup('New Group')

      expect(result).toEqual({
        success: false,
        error: '無作用中的畫布',
      })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('失敗時應回傳錯誤結果並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.createGroup('New Group')

      expect(result).toEqual({
        success: false,
        error: '建立群組失敗',
      })
      expect(store.groups).toHaveLength(0)
      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '建立群組失敗')
    })
  })

  describe('deleteGroup', () => {
    it('成功時應從 groups 中移除並回傳成功結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const group: Group = {
        id: 'group-1',
        name: 'Test Group',
        type: 'command',
      }
      store.groups = [group]

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
      expect(result).toEqual({
        success: true,
        error: undefined,
      })
      expect(store.groups).toHaveLength(0)
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '刪除群組成功')
    })

    it('無 activeCanvasId 時應回傳失敗', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useCommandStore()

      const result = await store.deleteGroup('group-1')

      expect(result).toEqual({
        success: false,
        error: '無作用中的畫布',
      })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('失敗時應回傳錯誤結果並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.deleteGroup('group-1')

      expect(result).toEqual({
        success: false,
        error: '刪除群組失敗',
      })
      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '刪除群組失敗')
    })
  })

  describe('moveItemToGroup', () => {
    it('成功時應更新 item 的 groupId 並回傳成功結果', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const command: Command = {
        id: 'cmd-1',
        name: 'Test Command',
        groupId: null,
      }
      store.availableItems = [command]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        itemId: 'cmd-1',
        groupId: 'group-1',
      })

      const result = await store.moveItemToGroup('cmd-1', 'group-1')

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command:move-to-group',
        responseEvent: 'command:moved-to-group',
        payload: {
          canvasId: 'canvas-1',
          itemId: 'cmd-1',
          groupId: 'group-1',
        },
      })
      expect(result).toEqual({
        success: true,
        error: undefined,
      })
      expect((store.availableItems[0] as any)?.groupId).toBe('group-1')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '移動成功')
    })

    it('移出群組時應設定 groupId 為 null', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      const command: Command = {
        id: 'cmd-1',
        name: 'Test Command',
        groupId: 'group-1',
      }
      store.availableItems = [command]

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        itemId: 'cmd-1',
        groupId: null,
      })

      const result = await store.moveItemToGroup('cmd-1', null)

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: 'command:move-to-group',
        responseEvent: 'command:moved-to-group',
        payload: {
          canvasId: 'canvas-1',
          itemId: 'cmd-1',
          groupId: null,
        },
      })
      expect(result).toEqual({
        success: true,
        error: undefined,
      })
      expect((store.availableItems[0] as any)?.groupId).toBeNull()
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Command', '移動成功')
    })

    it('無 activeCanvasId 時應回傳失敗', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null
      const store = useCommandStore()

      const result = await store.moveItemToGroup('cmd-1', 'group-1')

      expect(result).toEqual({
        success: false,
        error: '無作用中的畫布',
      })
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })

    it('失敗時應回傳錯誤結果並顯示錯誤 Toast', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce(null)

      const result = await store.moveItemToGroup('cmd-1', 'group-1')

      expect(result).toEqual({
        success: false,
        error: '移動失敗',
      })
      expect(mockShowErrorToast).toHaveBeenCalledWith('Command', '移動失敗')
    })

    it('回應 success: false 時應回傳對應 error', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = 'canvas-1'
      const store = useCommandStore()

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: false,
        error: '項目不存在',
      })

      const result = await store.moveItemToGroup('cmd-1', 'group-1')

      expect(result).toEqual({
        success: false,
        error: '項目不存在',
      })
    })
  })
})
