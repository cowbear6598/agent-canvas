import { useCanvasContext } from './useCanvasContext'
import { useDragHandler } from '@/composables/useDragHandler'
import { MOUSE_BUTTON } from '@/lib/constants'

type NoteStore = {
  notes: { id?: string; x: number; y: number; boundToPodId?: string | null }[]
  updateNotePositionLocal: (id: string, x: number, y: number) => void
  updateNotePosition: (noteId: string, x: number, y: number) => Promise<void>
}

type StoreConfigEntry = {
  movedSet: Set<string>
  moveItem: (id: string, x: number, y: number) => void
  getItem: (id: string) => { x: number; y: number; boundToPodId?: string | null } | undefined
  isPod: boolean
}

interface BatchDragStores {
  podStore: ReturnType<typeof useCanvasContext>['podStore']
  outputStyleStore: NoteStore
  skillStore: NoteStore
  repositoryStore: NoteStore
  subAgentStore: NoteStore
  commandStore: NoteStore
  mcpServerStore: NoteStore
}

interface MovedElementSets {
  movedPodIds: Set<string>
  movedOutputStyleNoteIds: Set<string>
  movedSkillNoteIds: Set<string>
  movedRepositoryNoteIds: Set<string>
  movedSubAgentNoteIds: Set<string>
  movedCommandNoteIds: Set<string>
  movedMcpServerNoteIds: Set<string>
}

function createStoreConfigMap(
  stores: BatchDragStores,
  movedSets: MovedElementSets
): Record<string, StoreConfigEntry> {
  const { podStore, outputStyleStore, skillStore, repositoryStore, subAgentStore, commandStore, mcpServerStore } = stores
  const { movedPodIds, movedOutputStyleNoteIds, movedSkillNoteIds, movedRepositoryNoteIds, movedSubAgentNoteIds, movedCommandNoteIds, movedMcpServerNoteIds } = movedSets
  return {
    pod: {
      movedSet: movedPodIds,
      moveItem: (id: string, x: number, y: number) => podStore.movePod(id, x, y),
      getItem: (id: string) => podStore.pods.find(pod => pod.id === id),
      isPod: true
    },
    outputStyleNote: {
      movedSet: movedOutputStyleNoteIds,
      moveItem: (id: string, x: number, y: number) => outputStyleStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => outputStyleStore.notes.find(note => note.id === id),
      isPod: false
    },
    skillNote: {
      movedSet: movedSkillNoteIds,
      moveItem: (id: string, x: number, y: number) => skillStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => skillStore.notes.find(note => note.id === id),
      isPod: false
    },
    repositoryNote: {
      movedSet: movedRepositoryNoteIds,
      moveItem: (id: string, x: number, y: number) => repositoryStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => repositoryStore.notes.find(note => note.id === id),
      isPod: false
    },
    subAgentNote: {
      movedSet: movedSubAgentNoteIds,
      moveItem: (id: string, x: number, y: number) => subAgentStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => subAgentStore.notes.find(note => note.id === id),
      isPod: false
    },
    commandNote: {
      movedSet: movedCommandNoteIds,
      moveItem: (id: string, x: number, y: number) => commandStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => commandStore.notes.find(note => note.id === id),
      isPod: false
    },
    mcpServerNote: {
      movedSet: movedMcpServerNoteIds,
      moveItem: (id: string, x: number, y: number) => mcpServerStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => mcpServerStore.notes.find(note => note.id === id),
      isPod: false
    }
  }
}

export function useBatchDrag(): {
  isBatchDragging: import('vue').Ref<boolean>
  startBatchDrag: (e: MouseEvent) => boolean
  isElementSelected: (type: 'pod' | 'outputStyleNote' | 'skillNote' | 'repositoryNote' | 'subAgentNote' | 'commandNote' | 'mcpServerNote', id: string) => boolean
} {
  const { podStore, viewportStore, selectionStore, outputStyleStore, skillStore, repositoryStore, subAgentStore, commandStore, mcpServerStore } = useCanvasContext()

  const dragState = {
    startX: 0,
    startY: 0,
    movedPods: new Set<string>(),
    movedOutputStyleNotes: new Set<string>(),
    movedSkillNotes: new Set<string>(),
    movedRepositoryNotes: new Set<string>(),
    movedSubAgentNotes: new Set<string>(),
    movedCommandNotes: new Set<string>(),
    movedMcpServerNotes: new Set<string>(),
  }

  const clearDragState = (): void => {
    dragState.movedPods.clear()
    dragState.movedOutputStyleNotes.clear()
    dragState.movedSkillNotes.clear()
    dragState.movedRepositoryNotes.clear()
    dragState.movedSubAgentNotes.clear()
    dragState.movedCommandNotes.clear()
    dragState.movedMcpServerNotes.clear()
  }

  const noteMovedSets: { set: Set<string>; store: NoteStore }[] = [
    { set: dragState.movedOutputStyleNotes, store: outputStyleStore },
    { set: dragState.movedSkillNotes, store: skillStore },
    { set: dragState.movedRepositoryNotes, store: repositoryStore },
    { set: dragState.movedSubAgentNotes, store: subAgentStore },
    { set: dragState.movedCommandNotes, store: commandStore },
    { set: dragState.movedMcpServerNotes, store: mcpServerStore },
  ]

  const { isDragging: isBatchDragging, startDrag } = useDragHandler({
    onMove: (moveEvent: MouseEvent): void => {
      const deltaXInCanvasCoords = (moveEvent.clientX - dragState.startX) / viewportStore.zoom
      const deltaYInCanvasCoords = (moveEvent.clientY - dragState.startY) / viewportStore.zoom

      moveSelectedElements(deltaXInCanvasCoords, deltaYInCanvasCoords)

      dragState.startX = moveEvent.clientX
      dragState.startY = moveEvent.clientY
    },
    onEnd: async (): Promise<void> => {
      await syncElementsToBackend()
    }
  })

  const startBatchDrag = (e: MouseEvent): boolean => {
    if (e.button !== MOUSE_BUTTON.LEFT) return false

    if (!selectionStore.hasSelection) return false

    dragState.startX = e.clientX
    dragState.startY = e.clientY

    clearDragState()

    startDrag(e)

    return true
  }

  const movePodElement = (config: StoreConfigEntry, id: string, item: { x: number; y: number }, dx: number, dy: number): void => {
    config.moveItem(id, item.x + dx, item.y + dy)
    config.movedSet.add(id)
  }

  const moveNoteElement = (config: StoreConfigEntry, id: string, item: { x: number; y: number; boundToPodId?: string | null }, dx: number, dy: number): void => {
    if (item.boundToPodId) return
    config.moveItem(id, item.x + dx, item.y + dy)
    config.movedSet.add(id)
  }

  const moveSelectedElements = (dx: number, dy: number): void => {
    const storeConfigMap = createStoreConfigMap(
      { podStore, outputStyleStore, skillStore, repositoryStore, subAgentStore, commandStore, mcpServerStore },
      {
        movedPodIds: dragState.movedPods,
        movedOutputStyleNoteIds: dragState.movedOutputStyleNotes,
        movedSkillNoteIds: dragState.movedSkillNotes,
        movedRepositoryNoteIds: dragState.movedRepositoryNotes,
        movedSubAgentNoteIds: dragState.movedSubAgentNotes,
        movedCommandNoteIds: dragState.movedCommandNotes,
        movedMcpServerNoteIds: dragState.movedMcpServerNotes,
      }
    )

    for (const element of selectionStore.selectedElements) {
      const config = storeConfigMap[element.type]
      if (!config) continue

      const item = config.getItem(element.id)
      if (!item) continue

      if (config.isPod) {
        movePodElement(config, element.id, item, dx, dy)
      } else {
        moveNoteElement(config, element.id, item, dx, dy)
      }
    }
  }

  const syncNotesByType = async <T extends { id?: string; x: number; y: number }>(
    movedNoteIds: Set<string>,
    store: {
      notes: T[]
      updateNotePosition: (noteId: string, x: number, y: number) => Promise<void>
    }
  ): Promise<void> => {
    for (const noteId of movedNoteIds) {
      const note = store.notes.find(note => note.id === noteId)
      if (note) {
        await store.updateNotePosition(noteId, note.x, note.y)
      }
    }
  }

  const syncElementsToBackend = async (): Promise<void> => {
    for (const podId of dragState.movedPods) {
      podStore.syncPodPosition(podId)
    }

    for (const { set, store } of noteMovedSets) {
      await syncNotesByType(set, store)
    }

    clearDragState()
  }

  const isElementSelected = (type: 'pod' | 'outputStyleNote' | 'skillNote' | 'repositoryNote' | 'subAgentNote' | 'commandNote' | 'mcpServerNote', id: string): boolean => {
    return selectionStore.selectedElements.some(
      el => el.type === type && el.id === id
    )
  }

  return {
    isBatchDragging,
    startBatchDrag,
    isElementSelected
  }
}
