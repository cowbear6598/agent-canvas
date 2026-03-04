import type {
  SelectableElement,
  CopiedPod,
  CopiedOutputStyleNote,
  CopiedSkillNote,
  CopiedRepositoryNote,
  CopiedSubAgentNote,
  CopiedCommandNote,
  CopiedConnection,
  AnchorPosition,
  TriggerMode,
  Pod,
} from '@/types'

type NoteWithIndexSignature = { boundToPodId: string | null; [key: string]: unknown }

type AnyNote = CopiedOutputStyleNote | CopiedSkillNote | CopiedRepositoryNote | CopiedSubAgentNote | CopiedCommandNote

type StoreWithNotes<TNote extends NoteWithIndexSignature = NoteWithIndexSignature> = {
  notes: TNote[]
}

export interface BoundNoteStores {
  outputStyleStore: StoreWithNotes
  skillStore: StoreWithNotes
  repositoryStore: StoreWithNotes
  subAgentStore: StoreWithNotes
  commandStore: StoreWithNotes
}

export interface BoundNotesByType {
  outputStyleNotes: CopiedOutputStyleNote[]
  skillNotes: CopiedSkillNote[]
  repositoryNotes: CopiedRepositoryNote[]
  subAgentNotes: CopiedSubAgentNote[]
  commandNotes: CopiedCommandNote[]
}

export function collectBoundNotesFromStore<T, TNote extends NoteWithIndexSignature>(
  podId: string,
  store: StoreWithNotes<TNote>,
  mapFn: (note: TNote) => T
): T[] {
  return store.notes
    .filter(note => note.boundToPodId === podId)
    .map(note => mapFn(note))
}

function mapToOutputStyleNote(note: NoteWithIndexSignature): CopiedOutputStyleNote {
  return {
    id: note.id as string,
    outputStyleId: note.outputStyleId as string,
    name: note.name as string,
    x: note.x as number,
    y: note.y as number,
    boundToPodId: note.boundToPodId,
    originalPosition: note.originalPosition as CopiedOutputStyleNote['originalPosition'],
  }
}

function mapToSkillNote(note: NoteWithIndexSignature): CopiedSkillNote {
  return {
    id: note.id as string,
    skillId: note.skillId as string,
    name: note.name as string,
    x: note.x as number,
    y: note.y as number,
    boundToPodId: note.boundToPodId,
    originalPosition: note.originalPosition as CopiedSkillNote['originalPosition'],
  }
}

function mapToRepositoryNote(note: NoteWithIndexSignature): CopiedRepositoryNote {
  return {
    repositoryId: note.repositoryId as string,
    name: note.name as string,
    x: note.x as number,
    y: note.y as number,
    boundToOriginalPodId: note.boundToPodId,
    originalPosition: note.originalPosition as CopiedRepositoryNote['originalPosition'],
  }
}

function mapToSubAgentNote(note: NoteWithIndexSignature): CopiedSubAgentNote {
  return {
    id: note.id as string,
    subAgentId: note.subAgentId as string,
    name: note.name as string,
    x: note.x as number,
    y: note.y as number,
    boundToPodId: note.boundToPodId,
    originalPosition: note.originalPosition as CopiedSubAgentNote['originalPosition'],
  }
}

function mapToCommandNote(note: NoteWithIndexSignature): CopiedCommandNote {
  return {
    commandId: note.commandId as string,
    name: note.name as string,
    x: note.x as number,
    y: note.y as number,
    boundToOriginalPodId: note.boundToPodId,
    originalPosition: note.originalPosition as CopiedCommandNote['originalPosition'],
  }
}

export function collectBoundNotes(podId: string, stores: BoundNoteStores): BoundNotesByType {
  return {
    outputStyleNotes: collectBoundNotesFromStore(podId, stores.outputStyleStore, mapToOutputStyleNote),
    skillNotes: collectBoundNotesFromStore(podId, stores.skillStore, mapToSkillNote),
    repositoryNotes: collectBoundNotesFromStore(podId, stores.repositoryStore, mapToRepositoryNote),
    subAgentNotes: collectBoundNotesFromStore(podId, stores.subAgentStore, mapToSubAgentNote),
    commandNotes: collectBoundNotesFromStore(podId, stores.commandStore, mapToCommandNote),
  }
}

export function createUnboundNoteCollector<T>(
  store: StoreWithNotes,
  mapFn: (note: NoteWithIndexSignature) => T
): (noteId: string) => T | null {
  return (noteId: string): T | null => {
    const note = store.notes.find(note => note.id === noteId)
    if (!note || note.boundToPodId !== null) return null
    return mapFn(note)
  }
}

export function collectSelectedPods(
  selectedElements: SelectableElement[],
  pods: Pod[]
): CopiedPod[] {
  const copiedPods: CopiedPod[] = []

  for (const element of selectedElements) {
    if (element.type === 'pod') {
      const pod = pods.find(pod => pod.id === element.id)
      if (pod) {
        copiedPods.push({
          id: pod.id,
          name: pod.name,
          x: pod.x,
          y: pod.y,
          rotation: pod.rotation,
          outputStyleId: pod.outputStyleId,
          skillIds: pod.skillIds,
          subAgentIds: pod.subAgentIds,
          model: pod.model,
          repositoryId: pod.repositoryId,
          commandId: pod.commandId,
        })
      }
    }
  }

  return copiedPods
}

function collectNoteFromElement(
  element: SelectableElement,
  noteCollectorMap: Record<string, { collector: (id: string) => AnyNote | null; array: AnyNote[] }>
): void {
  const collectorInfo = noteCollectorMap[element.type as keyof typeof noteCollectorMap]
  if (!collectorInfo) return
  const note = collectorInfo.collector(element.id)
  if (note) {
    collectorInfo.array.push(note)
  }
}

export interface NoteStores {
  outputStyleStore: StoreWithNotes
  skillStore: StoreWithNotes
  repositoryStore: StoreWithNotes
  subAgentStore: StoreWithNotes
  commandStore: StoreWithNotes
}

export function collectSelectedNotes(
  selectedElements: SelectableElement[],
  selectedPodIds: Set<string>,
  noteStores: NoteStores
): {
  outputStyleNotes: CopiedOutputStyleNote[]
  skillNotes: CopiedSkillNote[]
  repositoryNotes: CopiedRepositoryNote[]
  subAgentNotes: CopiedSubAgentNote[]
  commandNotes: CopiedCommandNote[]
} {
  const copiedOutputStyleNotes: CopiedOutputStyleNote[] = []
  const copiedSkillNotes: CopiedSkillNote[] = []
  const copiedRepositoryNotes: CopiedRepositoryNote[] = []
  const copiedSubAgentNotes: CopiedSubAgentNote[] = []
  const copiedCommandNotes: CopiedCommandNote[] = []

  for (const podId of selectedPodIds) {
    const boundNotes = collectBoundNotes(podId, noteStores)
    copiedOutputStyleNotes.push(...boundNotes.outputStyleNotes)
    copiedSkillNotes.push(...boundNotes.skillNotes)
    copiedRepositoryNotes.push(...boundNotes.repositoryNotes)
    copiedSubAgentNotes.push(...boundNotes.subAgentNotes)
    copiedCommandNotes.push(...boundNotes.commandNotes)
  }

  interface LocalNoteStoreConfig {
    key: string
    store: StoreWithNotes
    array: AnyNote[]
    mapFn: (note: NoteWithIndexSignature) => AnyNote
  }

  const NOTE_STORE_CONFIGS: LocalNoteStoreConfig[] = [
    {
      key: 'outputStyleNote',
      store: noteStores.outputStyleStore,
      array: copiedOutputStyleNotes as AnyNote[],
      mapFn: mapToOutputStyleNote,
    },
    {
      key: 'skillNote',
      store: noteStores.skillStore,
      array: copiedSkillNotes as AnyNote[],
      mapFn: mapToSkillNote,
    },
    {
      key: 'repositoryNote',
      store: noteStores.repositoryStore,
      array: copiedRepositoryNotes as AnyNote[],
      mapFn: mapToRepositoryNote,
    },
    {
      key: 'subAgentNote',
      store: noteStores.subAgentStore,
      array: copiedSubAgentNotes as AnyNote[],
      mapFn: mapToSubAgentNote,
    },
    {
      key: 'commandNote',
      store: noteStores.commandStore,
      array: copiedCommandNotes as AnyNote[],
      mapFn: mapToCommandNote,
    },
  ]

  const noteCollectorMap = Object.fromEntries(
    NOTE_STORE_CONFIGS.map(config => [
      config.key,
      {
        collector: createUnboundNoteCollector<AnyNote>(config.store, config.mapFn),
        array: config.array,
      },
    ])
  ) as Record<string, { collector: (id: string) => AnyNote | null; array: AnyNote[] }>

  for (const element of selectedElements) {
    collectNoteFromElement(element, noteCollectorMap)
  }

  return {
    outputStyleNotes: copiedOutputStyleNotes,
    skillNotes: copiedSkillNotes,
    repositoryNotes: copiedRepositoryNotes,
    subAgentNotes: copiedSubAgentNotes,
    commandNotes: copiedCommandNotes,
  }
}

export function collectRelatedConnections(
  selectedPodIds: Set<string>,
  connections: { id: string; sourcePodId?: string; targetPodId: string; sourceAnchor: AnchorPosition; targetAnchor: AnchorPosition; triggerMode: TriggerMode }[]
): CopiedConnection[] {
  const copiedConnections: CopiedConnection[] = []

  for (const connection of connections) {
    if (
      connection.sourcePodId &&
      selectedPodIds.has(connection.sourcePodId) &&
      selectedPodIds.has(connection.targetPodId)
    ) {
      copiedConnections.push({
        sourcePodId: connection.sourcePodId,
        sourceAnchor: connection.sourceAnchor,
        targetPodId: connection.targetPodId,
        targetAnchor: connection.targetAnchor,
        triggerMode: connection.triggerMode,
      })
    }
  }

  return copiedConnections
}
