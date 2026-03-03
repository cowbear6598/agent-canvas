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

  const collectUnboundOutputStyleNote = createUnboundNoteCollector<CopiedOutputStyleNote>(
    outputStyleStore,
    (note) => ({
      id: note.id as string,
      outputStyleId: note.outputStyleId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToPodId: note.boundToPodId,
      originalPosition: note.originalPosition as OrigPos,
    })
  )

  const collectUnboundSkillNote = createUnboundNoteCollector<CopiedSkillNote>(
    skillStore,
    (note) => ({
      id: note.id as string,
      skillId: note.skillId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToPodId: note.boundToPodId,
      originalPosition: note.originalPosition as OrigPos,
    })
  )

  const collectUnboundRepositoryNote = createUnboundNoteCollector<CopiedRepositoryNote>(
    repositoryStore,
    (note) => ({
      repositoryId: note.repositoryId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition as OrigPos,
    })
  )

  const collectUnboundSubAgentNote = createUnboundNoteCollector<CopiedSubAgentNote>(
    subAgentStore,
    (note) => ({
      id: note.id as string,
      subAgentId: note.subAgentId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToPodId: note.boundToPodId,
      originalPosition: note.originalPosition as OrigPos,
    })
  )

  const collectUnboundCommandNote = createUnboundNoteCollector<CopiedCommandNote>(
    commandStore,
    (note) => ({
      commandId: note.commandId as string,
      name: note.name as string,
      x: note.x as number,
      y: note.y as number,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition as OrigPos,
    })
  )

  const noteCollectorMap = {
    outputStyleNote: { collector: collectUnboundOutputStyleNote, array: copiedOutputStyleNotes },
    skillNote: { collector: collectUnboundSkillNote, array: copiedSkillNotes },
    repositoryNote: { collector: collectUnboundRepositoryNote, array: copiedRepositoryNotes },
    subAgentNote: { collector: collectUnboundSubAgentNote, array: copiedSubAgentNotes },
    commandNote: { collector: collectUnboundCommandNote, array: copiedCommandNotes },
  } as const

  for (const element of selectedElements) {
    const collectorInfo = noteCollectorMap[element.type as keyof typeof noteCollectorMap]
    if (collectorInfo) {
      const note = collectorInfo.collector(element.id)
      if (note) {
        collectorInfo.array.push(note as never)
      }
    }
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
