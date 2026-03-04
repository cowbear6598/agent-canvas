import { POD_WIDTH, POD_HEIGHT, NOTE_WIDTH, NOTE_HEIGHT } from '@/lib/constants'
import type {
  CopiedPod,
  CopiedOutputStyleNote,
  CopiedSkillNote,
  CopiedRepositoryNote,
  CopiedSubAgentNote,
  CopiedCommandNote,
  CopiedConnection,
  PastePodItem,
  PasteOutputStyleNoteItem,
  PasteSkillNoteItem,
  PasteRepositoryNoteItem,
  PasteSubAgentNoteItem,
  PasteCommandNoteItem,
  PasteConnectionItem,
} from '@/types'

type BoundingBox = { minX: number; maxX: number; minY: number; maxY: number }

function createInitialBounds(): BoundingBox {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
}

export function updateBoundingBox(
  bounds: BoundingBox,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.maxX = Math.max(bounds.maxX, x + width)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxY = Math.max(bounds.maxY, y + height)
}

type HasPosition = { x: number; y: number }

type UnboundNoteEntry = { noteList: HasPosition[]; getBoundKey: (n: HasPosition) => string | null }

function toUnboundNoteEntry<T extends HasPosition>(noteList: T[], getBoundKey: (n: T) => string | null): UnboundNoteEntry {
  return {
    noteList,
    getBoundKey: getBoundKey as (n: HasPosition) => string | null,
  }
}

function updateBoundsForUnboundNotes(bounds: BoundingBox, noteStoreConfigs: UnboundNoteEntry[]): void {
  for (const { noteList, getBoundKey } of noteStoreConfigs) {
    for (const note of noteList) {
      if (getBoundKey(note) === null) {
        updateBoundingBox(bounds, note.x, note.y, NOTE_WIDTH, NOTE_HEIGHT)
      }
    }
  }
}

export function calculateBoundingBox<
  TO extends HasPosition,
  TS extends HasPosition,
  TR extends HasPosition,
  TSA extends HasPosition,
  TC extends HasPosition
>(
  pods: CopiedPod[],
  notes: {
    outputStyleNotes: TO[]
    skillNotes: TS[]
    repositoryNotes: TR[]
    subAgentNotes: TSA[]
    commandNotes: TC[]
  },
  getBoundKeys: {
    outputStyleNote: (n: TO) => string | null
    skillNote: (n: TS) => string | null
    repositoryNote: (n: TR) => string | null
    subAgentNote: (n: TSA) => string | null
    commandNote: (n: TC) => string | null
  }
): BoundingBox {
  const bounds = createInitialBounds()

  for (const pod of pods) {
    updateBoundingBox(bounds, pod.x, pod.y, POD_WIDTH, POD_HEIGHT)
  }

  updateBoundsForUnboundNotes(bounds, [
    toUnboundNoteEntry(notes.outputStyleNotes, getBoundKeys.outputStyleNote),
    toUnboundNoteEntry(notes.skillNotes, getBoundKeys.skillNote),
    toUnboundNoteEntry(notes.repositoryNotes, getBoundKeys.repositoryNote),
    toUnboundNoteEntry(notes.subAgentNotes, getBoundKeys.subAgentNote),
    toUnboundNoteEntry(notes.commandNotes, getBoundKeys.commandNote),
  ])

  return bounds
}

export function calculateOffsets(
  boundingBox: BoundingBox,
  targetPosition: { x: number; y: number }
): { offsetX: number; offsetY: number } {
  const centerX = (boundingBox.minX + boundingBox.maxX) / 2
  const centerY = (boundingBox.minY + boundingBox.maxY) / 2

  return {
    offsetX: targetPosition.x - centerX,
    offsetY: targetPosition.y - centerY
  }
}

export function transformPods(
  pods: CopiedPod[],
  offset: { offsetX: number; offsetY: number }
): PastePodItem[] {
  return pods.map(pod => ({
    originalId: pod.id,
    name: pod.name,
    x: pod.x + offset.offsetX,
    y: pod.y + offset.offsetY,
    rotation: pod.rotation,
    outputStyleId: pod.outputStyleId,
    skillIds: pod.skillIds,
    subAgentIds: pod.subAgentIds,
    model: pod.model,
    repositoryId: pod.repositoryId,
    commandId: pod.commandId,
  }))
}

export function transformNotes<
  TSource extends { x: number; y: number; name: string; originalPosition: { x: number; y: number } | null },
  TResult
>(
  notes: TSource[],
  offset: { offsetX: number; offsetY: number },
  getBoundKey: (note: TSource) => string | null,
  mapFn: (note: TSource, position: { x: number; y: number }) => TResult
): TResult[] {
  return notes.map(note => {
    const isBound = getBoundKey(note) !== null
    const position = {
      x: isBound ? 0 : note.x + offset.offsetX,
      y: isBound ? 0 : note.y + offset.offsetY,
    }
    return mapFn(note, position)
  })
}

export function transformConnections(connections: CopiedConnection[]): PasteConnectionItem[] {
  return connections.map(connection => ({
    originalSourcePodId: connection.sourcePodId,
    sourceAnchor: connection.sourceAnchor,
    originalTargetPodId: connection.targetPodId,
    targetAnchor: connection.targetAnchor,
    triggerMode: connection.triggerMode,
  }))
}

type ClipboardData = {
  pods: CopiedPod[]
  outputStyleNotes: CopiedOutputStyleNote[]
  skillNotes: CopiedSkillNote[]
  repositoryNotes: CopiedRepositoryNote[]
  subAgentNotes: CopiedSubAgentNote[]
  commandNotes: CopiedCommandNote[]
  connections: CopiedConnection[]
}

type CopiedNote = CopiedOutputStyleNote | CopiedSkillNote | CopiedRepositoryNote | CopiedSubAgentNote | CopiedCommandNote

type NoteTransformConfig<TSource extends CopiedNote, TResult> = {
  notes: TSource[]
  getBoundKey: (note: TSource) => string | null
  mapFn: (note: TSource, position: { x: number; y: number }) => TResult
}

function isEmptyClipboard(clipboardData: ClipboardData): boolean {
  const { pods, outputStyleNotes, skillNotes, repositoryNotes, subAgentNotes, commandNotes } = clipboardData
  return (
    pods.length === 0 &&
    outputStyleNotes.length === 0 &&
    skillNotes.length === 0 &&
    repositoryNotes.length === 0 &&
    subAgentNotes.length === 0 &&
    commandNotes.length === 0
  )
}

export function calculatePastePositions(
  targetPosition: { x: number; y: number },
  clipboardData: ClipboardData
): {
  pods: PastePodItem[]
  outputStyleNotes: PasteOutputStyleNoteItem[]
  skillNotes: PasteSkillNoteItem[]
  repositoryNotes: PasteRepositoryNoteItem[]
  subAgentNotes: PasteSubAgentNoteItem[]
  commandNotes: PasteCommandNoteItem[]
  connections: PasteConnectionItem[]
} {
  const { pods, outputStyleNotes, skillNotes, repositoryNotes, subAgentNotes, commandNotes, connections } = clipboardData

  if (isEmptyClipboard(clipboardData)) {
    return { pods: [], outputStyleNotes: [], skillNotes: [], repositoryNotes: [], subAgentNotes: [], commandNotes: [], connections: [] }
  }

  const boundingBox = calculateBoundingBox(pods, {
    outputStyleNotes,
    skillNotes,
    repositoryNotes,
    subAgentNotes,
    commandNotes
  }, {
    outputStyleNote: note => note.boundToPodId,
    skillNote: note => note.boundToPodId,
    repositoryNote: note => note.boundToOriginalPodId,
    subAgentNote: note => note.boundToPodId,
    commandNote: note => note.boundToOriginalPodId
  })

  const offset = calculateOffsets(boundingBox, targetPosition)

  const outputStyleConfig: NoteTransformConfig<CopiedOutputStyleNote, PasteOutputStyleNoteItem> = {
    notes: outputStyleNotes,
    getBoundKey: note => note.boundToPodId,
    mapFn: (note, position) => ({
      outputStyleId: note.outputStyleId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition,
    }),
  }

  const skillConfig: NoteTransformConfig<CopiedSkillNote, PasteSkillNoteItem> = {
    notes: skillNotes,
    getBoundKey: note => note.boundToPodId,
    mapFn: (note, position) => ({
      skillId: note.skillId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition,
    }),
  }

  const repositoryConfig: NoteTransformConfig<CopiedRepositoryNote, PasteRepositoryNoteItem> = {
    notes: repositoryNotes,
    getBoundKey: note => note.boundToOriginalPodId,
    mapFn: (note, position) => ({
      repositoryId: note.repositoryId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToOriginalPodId,
      originalPosition: note.originalPosition,
    }),
  }

  const subAgentConfig: NoteTransformConfig<CopiedSubAgentNote, PasteSubAgentNoteItem> = {
    notes: subAgentNotes,
    getBoundKey: note => note.boundToPodId,
    mapFn: (note, position) => ({
      subAgentId: note.subAgentId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition,
    }),
  }

  const commandConfig: NoteTransformConfig<CopiedCommandNote, PasteCommandNoteItem> = {
    notes: commandNotes,
    getBoundKey: note => note.boundToOriginalPodId,
    mapFn: (note, position) => ({
      commandId: note.commandId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToOriginalPodId,
      originalPosition: note.originalPosition,
    }),
  }

  return {
    pods: transformPods(pods, offset),
    outputStyleNotes: transformNotes(outputStyleConfig.notes, offset, outputStyleConfig.getBoundKey, outputStyleConfig.mapFn),
    skillNotes: transformNotes(skillConfig.notes, offset, skillConfig.getBoundKey, skillConfig.mapFn),
    repositoryNotes: transformNotes(repositoryConfig.notes, offset, repositoryConfig.getBoundKey, repositoryConfig.mapFn),
    subAgentNotes: transformNotes(subAgentConfig.notes, offset, subAgentConfig.getBoundKey, subAgentConfig.mapFn),
    commandNotes: transformNotes(commandConfig.notes, offset, commandConfig.getBoundKey, commandConfig.mapFn),
    connections: transformConnections(connections),
  }
}
