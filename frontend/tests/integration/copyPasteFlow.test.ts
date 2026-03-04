import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { setupTestPinia } from '../helpers/mockStoreFactory'
import { mockWebSocketModule, resetMockWebSocket } from '../helpers/mockWebSocket'
import { createMockPod, createMockNote, createMockConnection } from '../helpers/factories'
import { usePodStore, useSelectionStore, useViewportStore } from '@/stores/pod'
import { useOutputStyleStore, useSkillStore, useRepositoryStore, useSubAgentStore, useCommandStore } from '@/stores/note'
import { useConnectionStore } from '@/stores/connectionStore'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type { SelectableElement } from '@/types'

const { mockShowSuccessToast, mockShowErrorToast, mockToast } = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
  mockToast: vi.fn(),
}))

vi.mock('@/services/websocket', async () => {
  const actual = await vi.importActual<typeof import('@/services/websocket')>('@/services/websocket')
  return {
    ...mockWebSocketModule(),
    WebSocketRequestEvents: actual.WebSocketRequestEvents,
    WebSocketResponseEvents: actual.WebSocketResponseEvents,
  }
})

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}))

describe('複製貼上/批量操作完整流程', () => {
  let podStore: ReturnType<typeof usePodStore>
  let selectionStore: ReturnType<typeof useSelectionStore>
  let viewportStore: ReturnType<typeof useViewportStore>
  let outputStyleStore: ReturnType<typeof useOutputStyleStore>
  let skillStore: ReturnType<typeof useSkillStore>
  let repositoryStore: ReturnType<typeof useRepositoryStore>
  let subAgentStore: ReturnType<typeof useSubAgentStore>
  let commandStore: ReturnType<typeof useCommandStore>
  let connectionStore: ReturnType<typeof useConnectionStore>
  let clipboardStore: ReturnType<typeof useClipboardStore>
  let canvasStore: ReturnType<typeof useCanvasStore>

  beforeEach(() => {
    const pinia = setupTestPinia()
    setActivePinia(pinia)
    resetMockWebSocket()
    vi.clearAllMocks()

    podStore = usePodStore()
    selectionStore = useSelectionStore()
    viewportStore = useViewportStore()
    outputStyleStore = useOutputStyleStore()
    skillStore = useSkillStore()
    repositoryStore = useRepositoryStore()
    subAgentStore = useSubAgentStore()
    commandStore = useCommandStore()
    connectionStore = useConnectionStore()
    clipboardStore = useClipboardStore()
    canvasStore = useCanvasStore()
    canvasStore.activeCanvasId = 'test-canvas-id'
  })

  describe('框選 -> 複製 -> 貼上', () => {
    it('應正確將框選的 Pod 和 Note 複製到 clipboardStore', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 200, y: 200 })
      const outputNote = createMockNote('outputStyle', { id: 'note-1', x: 300, y: 300, boundToPodId: null })
      const skillNote = createMockNote('skill', { id: 'note-2', x: 400, y: 400, boundToPodId: null })

      podStore.pods = [pod1, pod2]
      outputStyleStore.notes = [outputNote as any]
      skillStore.notes = [skillNote as any]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(500, 500)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )

      const selectedElements = selectionStore.selectedElements
      const selectedPodIds = new Set(selectedElements.filter(el => el.type === 'pod').map(el => el.id))
      const copiedPods = podStore.pods.filter(p => selectedPodIds.has(p.id)).map(p => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        rotation: p.rotation,
        outputStyleId: p.outputStyleId,
        skillIds: p.skillIds,
        subAgentIds: p.subAgentIds,
        model: p.model,
        repositoryId: p.repositoryId,
        commandId: p.commandId,
      }))

      const copiedOutputStyleNotes = outputStyleStore.notes
        .filter(n => selectedElements.some(el => el.type === 'outputStyleNote' && el.id === n.id))
        .map(n => ({
          id: n.id,
          outputStyleId: n.outputStyleId,
          name: n.name,
          x: n.x,
          y: n.y,
          boundToPodId: n.boundToPodId,
          originalPosition: n.originalPosition,
        }))

      const copiedSkillNotes = skillStore.notes
        .filter(n => selectedElements.some(el => el.type === 'skillNote' && el.id === n.id))
        .map(n => ({
          id: n.id,
          skillId: n.skillId,
          name: n.name,
          x: n.x,
          y: n.y,
          boundToPodId: n.boundToPodId,
          originalPosition: n.originalPosition,
        }))

      clipboardStore.setCopy(copiedPods, copiedOutputStyleNotes as any, copiedSkillNotes as any, [], [], [], [])

      expect(clipboardStore.isEmpty).toBe(false)
      expect(clipboardStore.copiedPods).toHaveLength(2)
      expect(clipboardStore.copiedOutputStyleNotes).toHaveLength(1)
      expect(clipboardStore.copiedSkillNotes).toHaveLength(1)
      expect(clipboardStore.copiedPods[0]!.id).toBe('pod-1')
      expect(clipboardStore.copiedPods[1]!.id).toBe('pod-2')
    })

    it('應過濾掉已綁定的 Note，只複製未綁定的 Note', () => {
      const pod = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const boundNote = createMockNote('outputStyle', { id: 'note-1', x: 150, y: 150, boundToPodId: 'pod-1' })
      const unboundNote = createMockNote('outputStyle', { id: 'note-2', x: 200, y: 200, boundToPodId: null })

      podStore.pods = [pod]
      outputStyleStore.notes = [boundNote as any, unboundNote as any]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(500, 500)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )

      const selectedElements = selectionStore.selectedElements
      const copiedOutputStyleNotes = outputStyleStore.notes
        .filter(n => selectedElements.some(el => el.type === 'outputStyleNote' && el.id === n.id) && n.boundToPodId === null)
        .map(n => ({
          id: n.id,
          outputStyleId: n.outputStyleId,
          name: n.name,
          x: n.x,
          y: n.y,
          boundToPodId: n.boundToPodId,
          originalPosition: n.originalPosition,
        }))

      clipboardStore.setCopy([], copiedOutputStyleNotes as any, [], [], [], [], [])

      expect(clipboardStore.copiedOutputStyleNotes).toHaveLength(1)
      expect(clipboardStore.copiedOutputStyleNotes[0]!.id).toBe('note-2')
    })

    it('應複製兩個 Pod 之間的 Connection', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 200, y: 200 })
      const connection = createMockConnection({
        id: 'conn-1',
        sourcePodId: 'pod-1',
        targetPodId: 'pod-2',
        sourceAnchor: 'bottom',
        targetAnchor: 'top',
      })

      podStore.pods = [pod1, pod2]
      connectionStore.connections = [connection]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(500, 500)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )

      const selectedElements = selectionStore.selectedElements
      const selectedPodIds = new Set(selectedElements.filter(el => el.type === 'pod').map(el => el.id))
      const copiedConnections = connectionStore.connections
        .filter(conn => selectedPodIds.has(conn.sourcePodId!) && selectedPodIds.has(conn.targetPodId))
        .map(conn => ({
          sourcePodId: conn.sourcePodId,
          sourceAnchor: conn.sourceAnchor,
          targetPodId: conn.targetPodId,
          targetAnchor: conn.targetAnchor,
          triggerMode: conn.triggerMode,
        }))

      clipboardStore.setCopy([], [], [], [], [], [], copiedConnections as any)

      expect(clipboardStore.copiedConnections).toHaveLength(1)
      expect(clipboardStore.copiedConnections[0]!.sourcePodId).toBe('pod-1')
      expect(clipboardStore.copiedConnections[0]!.targetPodId).toBe('pod-2')
    })

    it('應在貼上後更新 selectionStore 為新建立的元素', () => {
      const pod = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const note = createMockNote('outputStyle', { id: 'note-1', x: 200, y: 200, boundToPodId: null })

      clipboardStore.setCopy(
        [{
          id: pod.id,
          name: pod.name,
          x: pod.x,
          y: pod.y,
          rotation: pod.rotation,
        }],
        [{
          id: note.id,
          outputStyleId: (note as any).outputStyleId,
          name: note.name,
          x: note.x,
          y: note.y,
          boundToPodId: note.boundToPodId,
          originalPosition: note.originalPosition,
        }],
        [],
        [],
        [],
        [],
        []
      )

      const newSelectedElements: SelectableElement[] = [
        { type: 'pod', id: 'new-pod-1' },
        { type: 'outputStyleNote', id: 'new-note-1' },
      ]
      selectionStore.setSelectedElements(newSelectedElements)

      expect(selectionStore.selectedElements).toHaveLength(2)
      expect(selectionStore.selectedElements).toEqual(newSelectedElements)
      expect(selectionStore.selectedPodIds).toEqual(['new-pod-1'])
      expect(selectionStore.selectedOutputStyleNoteIds).toEqual(['new-note-1'])
    })
  })

  describe('框選 -> 批量拖曳', () => {
    it('應更新所有選中 Pod 的座標', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 200, y: 200 })

      podStore.pods = [pod1, pod2]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(500, 500)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )

      const dx = 50
      const dy = 50

      selectionStore.selectedElements.forEach(element => {
        if (element.type === 'pod') {
          const pod = podStore.pods.find(p => p.id === element.id)
          if (pod) {
            podStore.movePod(element.id, pod.x + dx, pod.y + dy)
          }
        }
      })

      const updatedPod1 = podStore.pods.find(p => p.id === 'pod-1')
      const updatedPod2 = podStore.pods.find(p => p.id === 'pod-2')

      expect(updatedPod1?.x).toBe(150)
      expect(updatedPod1?.y).toBe(150)
      expect(updatedPod2?.x).toBe(250)
      expect(updatedPod2?.y).toBe(250)
    })

    it('應更新所有選中的未綁定 Note 的座標', () => {
      const note1 = createMockNote('outputStyle', { id: 'note-1', x: 100, y: 100, boundToPodId: null })
      const note2 = createMockNote('skill', { id: 'note-2', x: 200, y: 200, boundToPodId: null })
      const boundNote = createMockNote('outputStyle', { id: 'note-3', x: 300, y: 300, boundToPodId: 'pod-1' })

      outputStyleStore.notes = [note1 as any, boundNote as any]
      skillStore.notes = [note2 as any]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(500, 500)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )

      const dx = 30
      const dy = 40

      selectionStore.selectedElements.forEach(element => {
        if (element.type === 'outputStyleNote') {
          const note = outputStyleStore.notes.find(n => n.id === element.id)
          if (note && note.boundToPodId === null) {
            outputStyleStore.updateNotePositionLocal(element.id, note.x + dx, note.y + dy)
          }
        } else if (element.type === 'skillNote') {
          const note = skillStore.notes.find(n => n.id === element.id)
          if (note && note.boundToPodId === null) {
            skillStore.updateNotePositionLocal(element.id, note.x + dx, note.y + dy)
          }
        }
      })

      const updatedNote1 = outputStyleStore.notes.find(n => n.id === 'note-1')
      const updatedNote2 = skillStore.notes.find(n => n.id === 'note-2')
      const updatedBoundNote = outputStyleStore.notes.find(n => n.id === 'note-3')

      expect(updatedNote1?.x).toBe(130)
      expect(updatedNote1?.y).toBe(140)
      expect(updatedNote2?.x).toBe(230)
      expect(updatedNote2?.y).toBe(240)
      expect(updatedBoundNote?.x).toBe(300)
      expect(updatedBoundNote?.y).toBe(300)
    })

    it('應在拖曳後調用 syncPodPosition 同步到後端', () => {
      const pod = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      podStore.pods = [pod]

      selectionStore.setSelectedElements([{ type: 'pod', id: 'pod-1' }])

      const syncSpy = vi.spyOn(podStore, 'syncPodPosition')

      podStore.movePod('pod-1', 150, 150)
      podStore.syncPodPosition('pod-1')

      expect(syncSpy).toHaveBeenCalledWith('pod-1')
    })

    it('應在拖曳後調用 updateNotePosition 同步 Note 到後端', async () => {
      const note = createMockNote('outputStyle', { id: 'note-1', x: 100, y: 100, boundToPodId: null })
      outputStyleStore.notes = [note as any]

      selectionStore.setSelectedElements([{ type: 'outputStyleNote', id: 'note-1' }])

      const updateSpy = vi.spyOn(outputStyleStore, 'updateNotePosition')

      outputStyleStore.updateNotePositionLocal('note-1', 150, 150)
      await outputStyleStore.updateNotePosition('note-1', 150, 150)

      expect(updateSpy).toHaveBeenCalledWith('note-1', 150, 150)
    })
  })

  describe('框選 -> 批量刪除', () => {
    it('應刪除所有選中的 Pod', async () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 200, y: 200 })
      const pod3 = createMockPod({ id: 'pod-3', x: 1000, y: 1000 })

      podStore.pods = [pod1, pod2, pod3]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(500, 500)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )

      expect(selectionStore.selectedPodIds).toHaveLength(2)

      const deletePromises: Promise<void>[] = []
      selectionStore.selectedPodIds.forEach(id => {
        deletePromises.push(podStore.deletePodWithBackend(id))
      })

      await Promise.allSettled(deletePromises)

      expect(deletePromises).toHaveLength(2)
    })

    it('應刪除所有選中的 Note', async () => {
      const note1 = createMockNote('outputStyle', { id: 'note-1', x: 100, y: 100, boundToPodId: null })
      const note2 = createMockNote('skill', { id: 'note-2', x: 200, y: 200, boundToPodId: null })
      const note3 = createMockNote('outputStyle', { id: 'note-3', x: 1000, y: 1000, boundToPodId: null })

      outputStyleStore.notes = [note1 as any, note3 as any]
      skillStore.notes = [note2 as any]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(500, 500)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )

      const deletePromises: Promise<void>[] = []

      selectionStore.selectedOutputStyleNoteIds.forEach(id => {
        deletePromises.push(outputStyleStore.deleteNote(id))
      })

      selectionStore.selectedSkillNoteIds.forEach(id => {
        deletePromises.push(skillStore.deleteNote(id))
      })

      await Promise.allSettled(deletePromises)

      expect(deletePromises).toHaveLength(2)
    })

    it('應在刪除後清空 selection', () => {
      selectionStore.setSelectedElements([
        { type: 'pod', id: 'pod-1' },
        { type: 'outputStyleNote', id: 'note-1' },
      ])

      expect(selectionStore.hasSelection).toBe(true)

      selectionStore.clearSelection()

      expect(selectionStore.hasSelection).toBe(false)
      expect(selectionStore.selectedElements).toHaveLength(0)
    })

    it('應在刪除 Pod 時自動清理相關 Connection', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 200, y: 200 })
      const connection = createMockConnection({
        id: 'conn-1',
        sourcePodId: 'pod-1',
        targetPodId: 'pod-2',
      })

      podStore.pods = [pod1, pod2]
      connectionStore.connections = [connection]

      const deleteConnSpy = vi.spyOn(connectionStore, 'deleteConnectionsByPodId')

      podStore.removePod('pod-1')

      expect(deleteConnSpy).toHaveBeenCalledWith('pod-1')
      expect(connectionStore.connections.filter(c => c.sourcePodId === 'pod-1' || c.targetPodId === 'pod-1')).toHaveLength(0)
    })
  })

  describe('Ctrl 框選', () => {
    it('第一次框選應選中元素', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 200, y: 200 })

      podStore.pods = [pod1, pod2]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(300, 300)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )
      selectionStore.endSelection()

      expect(selectionStore.selectedPodIds).toEqual(['pod-1', 'pod-2'])
    })

    it('Ctrl 第二次框選應 toggle 反選', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 250, y: 250 })
      const pod3 = createMockPod({ id: 'pod-3', x: 400, y: 400 })

      podStore.pods = [pod1, pod2, pod3]

      selectionStore.startSelection(0, 0)
      selectionStore.updateSelection(350, 350)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )
      selectionStore.endSelection()

      expect(selectionStore.selectedPodIds).toEqual(['pod-1', 'pod-2'])

      selectionStore.startSelection(350, 350, true)
      selectionStore.updateSelection(700, 700)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )
      selectionStore.endSelection()

      expect(selectionStore.selectedPodIds).toEqual(['pod-1', 'pod-3'])
    })

    it('Ctrl 框選已選中的元素應移除該元素', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })

      podStore.pods = [pod1]

      selectionStore.setSelectedElements([{ type: 'pod', id: 'pod-1' }])
      expect(selectionStore.selectedPodIds).toEqual(['pod-1'])

      selectionStore.startSelection(0, 0, true)
      selectionStore.updateSelection(300, 300)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )
      selectionStore.endSelection()

      expect(selectionStore.selectedPodIds).toEqual([])
    })

    it('Ctrl 框選未選中的元素應加入該元素', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })
      const pod2 = createMockPod({ id: 'pod-2', x: 500, y: 500 })

      podStore.pods = [pod1, pod2]

      selectionStore.setSelectedElements([{ type: 'pod', id: 'pod-1' }])

      selectionStore.startSelection(400, 400, true)
      selectionStore.updateSelection(600, 600)
      selectionStore.calculateSelectedElements(
        podStore.pods,
        outputStyleStore.notes,
        skillStore.notes,
        repositoryStore.notes,
        subAgentStore.notes,
        commandStore.notes
      )
      selectionStore.endSelection()

      expect(selectionStore.selectedPodIds).toEqual(['pod-1', 'pod-2'])
    })

    it('應正確處理 Ctrl 模式的 initialSelectedElements', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })

      podStore.pods = [pod1]

      selectionStore.setSelectedElements([{ type: 'pod', id: 'pod-1' }])

      selectionStore.startSelection(0, 0, true)

      expect(selectionStore.initialSelectedElements).toEqual([{ type: 'pod', id: 'pod-1' }])
      expect(selectionStore.isCtrlMode).toBe(true)
    })

    it('應在 endSelection 後重置 isCtrlMode 和 initialSelectedElements', () => {
      const pod1 = createMockPod({ id: 'pod-1', x: 100, y: 100 })

      podStore.pods = [pod1]

      selectionStore.setSelectedElements([{ type: 'pod', id: 'pod-1' }])

      selectionStore.startSelection(0, 0, true)
      expect(selectionStore.isCtrlMode).toBe(true)

      selectionStore.endSelection()

      expect(selectionStore.isCtrlMode).toBe(false)
      expect(selectionStore.initialSelectedElements).toEqual([])
    })
  })
})
