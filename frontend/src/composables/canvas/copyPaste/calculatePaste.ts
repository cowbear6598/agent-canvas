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

type UnboundNoteEntry = { noteList: { x: number; y: number }[]; getBoundKey: (n: { x: number; y: number }) => string | null }

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
  TO extends { x: number; y: number },
  TS extends { x: number; y: number },
  TR extends { x: number; y: number },
  TSA extends { x: number; y: number },
  TC extends { x: number; y: number }
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
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  }

  for (const pod of pods) {
    updateBoundingBox(bounds, pod.x, pod.y, POD_WIDTH, POD_HEIGHT)
  }

  const noteStoreConfigs: UnboundNoteEntry[] = [
    { noteList: notes.outputStyleNotes as { x: number; y: number }[], getBoundKey: getBoundKeys.outputStyleNote as (n: { x: number; y: number }) => string | null },
    { noteList: notes.skillNotes as { x: number; y: number }[], getBoundKey: getBoundKeys.skillNote as (n: { x: number; y: number }) => string | null },
    { noteList: notes.repositoryNotes as { x: number; y: number }[], getBoundKey: getBoundKeys.repositoryNote as (n: { x: number; y: number }) => string | null },
    { noteList: notes.subAgentNotes as { x: number; y: number }[], getBoundKey: getBoundKeys.subAgentNote as (n: { x: number; y: number }) => string | null },
    { noteList: notes.commandNotes as { x: number; y: number }[], getBoundKey: getBoundKeys.commandNote as (n: { x: number; y: number }) => string | null },
  ]

  updateBoundsForUnboundNotes(bounds, noteStoreConfigs)

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
  return connections.map(conn => ({
    originalSourcePodId: conn.sourcePodId,
    sourceAnchor: conn.sourceAnchor,
    originalTargetPodId: conn.targetPodId,
    targetAnchor: conn.targetAnchor,
    triggerMode: conn.triggerMode,
  }))
}

export function calculatePastePositions(
  targetPosition: { x: number; y: number },
  clipboardData: {
    pods: CopiedPod[]
    outputStyleNotes: CopiedOutputStyleNote[]
    skillNotes: CopiedSkillNote[]
    repositoryNotes: CopiedRepositoryNote[]
    subAgentNotes: CopiedSubAgentNote[]
    commandNotes: CopiedCommandNote[]
    connections: CopiedConnection[]
  }
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

  const isEmpty = pods.length === 0 && outputStyleNotes.length === 0 && skillNotes.length === 0 && repositoryNotes.length === 0 && subAgentNotes.length === 0 && commandNotes.length === 0
  if (isEmpty) {
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

  const newPods = transformPods(pods, offset)

  const newOutputStyleNotes = transformNotes(
    outputStyleNotes,
    offset,
    note => note.boundToPodId,
    (note, position) => ({
      outputStyleId: note.outputStyleId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition,
    })
  )

  const newSkillNotes = transformNotes(
    skillNotes,
    offset,
    note => note.boundToPodId,
    (note, position) => ({
      skillId: note.skillId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition,
    })
  )

  const newRepositoryNotes = transformNotes(
    repositoryNotes,
    offset,
    note => note.boundToOriginalPodId,
    (note, position) => ({
      repositoryId: note.repositoryId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToOriginalPodId,
      originalPosition: note.originalPosition,
    })
  )

  const newSubAgentNotes = transformNotes(
    subAgentNotes,
    offset,
    note => note.boundToPodId,
    (note, position) => ({
      subAgentId: note.subAgentId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToPodId,
      originalPosition: note.originalPosition,
    })
  )

  const newCommandNotes = transformNotes(
    commandNotes,
    offset,
    note => note.boundToOriginalPodId,
    (note, position) => ({
      commandId: note.commandId,
      name: note.name,
      x: position.x,
      y: position.y,
      boundToOriginalPodId: note.boundToOriginalPodId,
      originalPosition: note.originalPosition,
    })
  )

  const newConnections = transformConnections(connections)

  return {
    pods: newPods,
    outputStyleNotes: newOutputStyleNotes,
    skillNotes: newSkillNotes,
    repositoryNotes: newRepositoryNotes,
    subAgentNotes: newSubAgentNotes,
    commandNotes: newCommandNotes,
    connections: newConnections,
  }
}
