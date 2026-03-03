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

export function collectBoundNotesFromStore<T, TNote extends NoteWithIndexSignature>(
  podId: string,
  store: StoreWithNotes<TNote>,
  mapFn: (note: TNote) => T
): T[] {
  return store.notes
    .filter(note => note.boundToPodId === podId)
    .map(note => mapFn(note))
}

export function collectBoundNotes(
  podId: string,
  outputStyleNotes: CopiedOutputStyleNote[],
  skillNotes: CopiedSkillNote[],
  repositoryNotes: CopiedRepositoryNote[],
  subAgentNotes: CopiedSubAgentNote[],
  commandNotes: CopiedCommandNote[],
  outputStyleStore: StoreWithNotes,
  skillStore: StoreWithNotes,
  repositoryStore: StoreWithNotes,
  subAgentStore: StoreWithNotes,
  commandStore: StoreWithNotes
): void {
  outputStyleNotes.push(...collectBoundNotesFromStore(
    podId,
    outputStyleStore,
    (note) => ({
      id: note.id as string,
      outputStyleId: note.outputStyleId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToPodId: note.boundToPodId,
      originalPosition: note.originalPosition as CopiedOutputStyleNote['originalPosition'],
    })
  ))

  skillNotes.push(...collectBoundNotesFromStore(
    podId,
    skillStore,
    (note) => ({
      id: note.id as string,
      skillId: note.skillId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToPodId: note.boundToPodId,
      originalPosition: note.originalPosition as CopiedSkillNote['originalPosition'],
    })
  ))

  repositoryNotes.push(...collectBoundNotesFromStore(
    podId,
    repositoryStore,
    (note) => ({
      repositoryId: note.repositoryId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition as CopiedRepositoryNote['originalPosition'],
    })
  ))

  subAgentNotes.push(...collectBoundNotesFromStore(
    podId,
    subAgentStore,
    (note) => ({
      id: note.id as string,
      subAgentId: note.subAgentId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToPodId: note.boundToPodId,
      originalPosition: note.originalPosition as CopiedSubAgentNote['originalPosition'],
    })
  ))

  commandNotes.push(...collectBoundNotesFromStore(
    podId,
    commandStore,
    (note) => ({
      commandId: note.commandId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition as CopiedCommandNote['originalPosition'],
    })
  ))
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

export function collectSelectedNotes(
  selectedElements: SelectableElement[],
  selectedPodIds: Set<string>,
  outputStyleStore: StoreWithNotes,
  skillStore: StoreWithNotes,
  repositoryStore: StoreWithNotes,
  subAgentStore: StoreWithNotes,
  commandStore: StoreWithNotes
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
    collectBoundNotes(podId, copiedOutputStyleNotes, copiedSkillNotes, copiedRepositoryNotes, copiedSubAgentNotes, copiedCommandNotes, outputStyleStore, skillStore, repositoryStore, subAgentStore, commandStore)
  }

  type OrigPos = { x: number; y: number } | null

  interface NoteStoreConfig {
    key: string
    store: StoreWithNotes
    array: AnyNote[]
    mapFn: (note: NoteWithIndexSignature) => AnyNote
  }

  const NOTE_STORE_CONFIGS: NoteStoreConfig[] = [
    {
      key: 'outputStyleNote',
      store: outputStyleStore,
      array: copiedOutputStyleNotes as AnyNote[],
      mapFn: (note): CopiedOutputStyleNote => ({
        id: note.id as string,
        outputStyleId: note.outputStyleId as string,
        name: note.name as string,
        x: note.x as number,
        y: note.y as number,
        boundToPodId: note.boundToPodId,
        originalPosition: note.originalPosition as OrigPos,
      }),
    },
    {
      key: 'skillNote',
      store: skillStore,
      array: copiedSkillNotes as AnyNote[],
      mapFn: (note): CopiedSkillNote => ({
        id: note.id as string,
        skillId: note.skillId as string,
        name: note.name as string,
        x: note.x as number,
        y: note.y as number,
        boundToPodId: note.boundToPodId,
        originalPosition: note.originalPosition as OrigPos,
      }),
    },
    {
      key: 'repositoryNote',
      store: repositoryStore,
      array: copiedRepositoryNotes as AnyNote[],
      mapFn: (note): CopiedRepositoryNote => ({
        repositoryId: note.repositoryId as string,
        name: note.name as string,
        x: note.x as number,
        y: note.y as number,
        boundToOriginalPodId: note.boundToPodId,
        originalPosition: note.originalPosition as OrigPos,
      }),
    },
    {
      key: 'subAgentNote',
      store: subAgentStore,
      array: copiedSubAgentNotes as AnyNote[],
      mapFn: (note): CopiedSubAgentNote => ({
        id: note.id as string,
        subAgentId: note.subAgentId as string,
        name: note.name as string,
        x: note.x as number,
        y: note.y as number,
        boundToPodId: note.boundToPodId,
        originalPosition: note.originalPosition as OrigPos,
      }),
    },
    {
      key: 'commandNote',
      store: commandStore,
      array: copiedCommandNotes as AnyNote[],
      mapFn: (note): CopiedCommandNote => ({
        commandId: note.commandId as string,
        name: note.name as string,
        x: note.x as number,
        y: note.y as number,
        boundToOriginalPodId: note.boundToPodId,
        originalPosition: note.originalPosition as OrigPos,
      }),
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
