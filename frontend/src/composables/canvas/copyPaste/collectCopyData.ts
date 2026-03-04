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

type NoteBaseFields = { name: string; x: number; y: number; originalPosition: { x: number; y: number } | null }

function extractNoteBaseFields(note: NoteWithIndexSignature): NoteBaseFields {
  return {
    name: note.name as string,
    x: note.x as number,
    y: note.y as number,
    originalPosition: note.originalPosition as NoteBaseFields['originalPosition'],
  }
}

function createBoundNoteMapper<T extends NoteBaseFields & { boundToPodId: string | null }>(idField: string): (note: NoteWithIndexSignature) => T {
  return (note: NoteWithIndexSignature): T => ({
    ...extractNoteBaseFields(note),
    id: note.id as string,
    [idField]: note[idField] as string,
    boundToPodId: note.boundToPodId,
  }) as unknown as T
}

function createOriginalBoundNoteMapper<T extends NoteBaseFields & { boundToOriginalPodId: string | null }>(idField: string): (note: NoteWithIndexSignature) => T {
  return (note: NoteWithIndexSignature): T => ({
    ...extractNoteBaseFields(note),
    [idField]: note[idField] as string,
    boundToOriginalPodId: note.boundToPodId,
  }) as unknown as T
}

const mapToOutputStyleNote = createBoundNoteMapper<CopiedOutputStyleNote>('outputStyleId')
const mapToSkillNote = createBoundNoteMapper<CopiedSkillNote>('skillId')
const mapToSubAgentNote = createBoundNoteMapper<CopiedSubAgentNote>('subAgentId')
const mapToRepositoryNote = createOriginalBoundNoteMapper<CopiedRepositoryNote>('repositoryId')
const mapToCommandNote = createOriginalBoundNoteMapper<CopiedCommandNote>('commandId')

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

interface NoteStoreConfig {
  key: string
  getStore: (noteStores: NoteStores) => StoreWithNotes
  mapFn: (note: NoteWithIndexSignature) => AnyNote
}

const NOTE_STORE_CONFIGS: NoteStoreConfig[] = [
  {
    key: 'outputStyleNote',
    getStore: (noteStores) => noteStores.outputStyleStore,
    mapFn: mapToOutputStyleNote,
  },
  {
    key: 'skillNote',
    getStore: (noteStores) => noteStores.skillStore,
    mapFn: mapToSkillNote,
  },
  {
    key: 'repositoryNote',
    getStore: (noteStores) => noteStores.repositoryStore,
    mapFn: mapToRepositoryNote,
  },
  {
    key: 'subAgentNote',
    getStore: (noteStores) => noteStores.subAgentStore,
    mapFn: mapToSubAgentNote,
  },
  {
    key: 'commandNote',
    getStore: (noteStores) => noteStores.commandStore,
    mapFn: mapToCommandNote,
  },
]

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

  const arrays: Record<string, AnyNote[]> = {
    outputStyleNote: copiedOutputStyleNotes as AnyNote[],
    skillNote: copiedSkillNotes as AnyNote[],
    repositoryNote: copiedRepositoryNotes as AnyNote[],
    subAgentNote: copiedSubAgentNotes as AnyNote[],
    commandNote: copiedCommandNotes as AnyNote[],
  }

  const noteCollectorMap = Object.fromEntries(
    NOTE_STORE_CONFIGS.map(config => [
      config.key,
      {
        collector: createUnboundNoteCollector<AnyNote>(config.getStore(noteStores), config.mapFn),
        array: arrays[config.key],
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
