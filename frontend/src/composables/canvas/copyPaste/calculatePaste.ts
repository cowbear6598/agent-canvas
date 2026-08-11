import {
  POD_WIDTH,
  POD_HEIGHT,
  NOTE_WIDTH,
  NOTE_HEIGHT,
  MAX_POD_NAME_LENGTH,
} from "@/lib/constants";
import type {
  CopiedPod,
  CopiedRepositoryNote,
  CopiedConnection,
  PastePodItem,
  PasteRepositoryNoteItem,
  PasteConnectionItem,
} from "@/types";

type BoundingBox = { minX: number; maxX: number; minY: number; maxY: number };

function createInitialBounds(): BoundingBox {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
}

function updateBoundingBox(
  bounds: BoundingBox,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x + width);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y + height);
}

type HasPosition = { x: number; y: number };

type UnboundNoteEntry = {
  noteList: HasPosition[];
  getBoundKey: (n: HasPosition) => string | null;
};

function toUnboundNoteEntry<T extends HasPosition>(
  noteList: T[],
  getBoundKey: (n: T) => string | null,
): UnboundNoteEntry {
  return {
    noteList,
    getBoundKey: getBoundKey as (n: HasPosition) => string | null,
  };
}

function updateBoundsForUnboundNotes(
  bounds: BoundingBox,
  noteStoreConfigs: UnboundNoteEntry[],
): void {
  const unboundNotes = noteStoreConfigs.flatMap(({ noteList, getBoundKey }) =>
    noteList.filter((note) => getBoundKey(note) === null),
  );
  for (const note of unboundNotes) {
    updateBoundingBox(bounds, note.x, note.y, NOTE_WIDTH, NOTE_HEIGHT);
  }
}

function calculateBoundingBox<TR extends HasPosition>(
  pods: CopiedPod[],
  notes: {
    repositoryNotes: TR[];
  },
  getBoundKeys: {
    repositoryNote: (n: TR) => string | null;
  },
): BoundingBox {
  const bounds = createInitialBounds();

  for (const pod of pods) {
    updateBoundingBox(bounds, pod.x, pod.y, POD_WIDTH, POD_HEIGHT);
  }

  updateBoundsForUnboundNotes(bounds, [
    toUnboundNoteEntry(notes.repositoryNotes, getBoundKeys.repositoryNote),
  ]);

  return bounds;
}

function calculateOffsets(
  boundingBox: BoundingBox,
  targetPosition: { x: number; y: number },
): { offsetX: number; offsetY: number } {
  const centerX = (boundingBox.minX + boundingBox.maxX) / 2;
  const centerY = (boundingBox.minY + boundingBox.maxY) / 2;

  return {
    offsetX: targetPosition.x - centerX,
    offsetY: targetPosition.y - centerY,
  };
}

const PASTE_NAME_MAX_COUNTER = 9999;
const SUFFIX_MAX_LENGTH = 7;

export function generatePasteName(
  originalName: string,
  existingNames: Set<string>,
): string {
  const suffixPattern = / \((\d+)\)$/;
  const match = originalName.match(suffixPattern);
  const baseName = match
    ? originalName.slice(0, -match[0].length)
    : originalName;

  const maxBaseLength = MAX_POD_NAME_LENGTH - SUFFIX_MAX_LENGTH;
  const safeBaseName =
    baseName.length > maxBaseLength
      ? baseName.slice(0, maxBaseLength)
      : baseName;

  let counter = 1;
  let candidate = `${safeBaseName} (${counter})`;
  while (existingNames.has(candidate) && counter < PASTE_NAME_MAX_COUNTER) {
    counter++;
    candidate = `${safeBaseName} (${counter})`;
  }
  return candidate;
}

export function transformPods(
  pods: CopiedPod[],
  offset: { offsetX: number; offsetY: number },
  existingNames: Set<string>,
): PastePodItem[] {
  const nameSet = new Set(existingNames);
  return pods.map((pod) => {
    const newName = generatePasteName(pod.name, nameSet);
    nameSet.add(newName);
    return {
      originalId: pod.id,
      name: newName,
      x: pod.x + offset.offsetX,
      y: pod.y + offset.offsetY,
      rotation: pod.rotation,
      provider: pod.provider,
      providerConfig: pod.providerConfig,
      fastModeEnabled: pod.fastModeEnabled === true,
      mcpServerNames: pod.mcpServerNames,
      pluginIds: pod.pluginIds,
      repositoryId: pod.repositoryId,
      goal: pod.goal ?? null,
    };
  });
}

function transformNotes<
  TSource extends {
    x: number;
    y: number;
    name: string;
    originalPosition: { x: number; y: number } | null;
  },
  TResult,
>(
  notes: TSource[],
  offset: { offsetX: number; offsetY: number },
  getBoundKey: (note: TSource) => string | null,
  mapFn: (note: TSource, position: { x: number; y: number }) => TResult,
): TResult[] {
  return notes.map((note) => {
    const isBound = getBoundKey(note) !== null;
    const position = {
      x: isBound ? 0 : note.x + offset.offsetX,
      y: isBound ? 0 : note.y + offset.offsetY,
    };
    return mapFn(note, position);
  });
}

function transformConnections(
  connections: CopiedConnection[],
): PasteConnectionItem[] {
  return connections.map((connection) => {
    const payload: PasteConnectionItem = {
      originalSourcePodId: connection.sourcePodId,
      sourceAnchor: connection.sourceAnchor,
      originalTargetPodId: connection.targetPodId,
      targetAnchor: connection.targetAnchor,
      triggerMode: connection.triggerMode,
      direct: connection.direct,
      summaryProvider: connection.summaryProvider,
      summaryModel: connection.summaryModel,
      summaryThinkingLevel: connection.summaryThinkingLevel,
      description: connection.description,
    };

    if (connection.label !== "") {
      payload.label = connection.label;
    }

    return payload;
  });
}

type ClipboardData = {
  pods: CopiedPod[];
  repositoryNotes: CopiedRepositoryNote[];
  connections: CopiedConnection[];
};

type CopiedNote = CopiedRepositoryNote;

type NoteTransformConfig<TSource extends CopiedNote, TResult> = {
  notes: TSource[];
  getBoundKey: (note: TSource) => string | null;
  mapFn: (note: TSource, position: { x: number; y: number }) => TResult;
};

function isEmptyClipboard(clipboardData: ClipboardData): boolean {
  const { pods, repositoryNotes } = clipboardData;
  return pods.length === 0 && repositoryNotes.length === 0;
}

export function calculatePastePositions(
  targetPosition: { x: number; y: number },
  clipboardData: ClipboardData,
  existingNames: Set<string>,
): {
  pods: PastePodItem[];
  repositoryNotes: PasteRepositoryNoteItem[];
  connections: PasteConnectionItem[];
} {
  const { pods, repositoryNotes, connections } = clipboardData;

  if (isEmptyClipboard(clipboardData)) {
    return {
      pods: [],
      repositoryNotes: [],
      connections: [],
    };
  }

  const boundingBox = calculateBoundingBox(
    pods,
    {
      repositoryNotes,
    },
    {
      repositoryNote: (note) => note.boundToOriginalPodId,
    },
  );

  const offset = calculateOffsets(boundingBox, targetPosition);

  function applyTransform<TSource extends CopiedNote, TResult>(
    config: NoteTransformConfig<TSource, TResult>,
  ): TResult[] {
    return transformNotes(
      config.notes,
      offset,
      config.getBoundKey,
      config.mapFn,
    );
  }

  return {
    pods: transformPods(pods, offset, existingNames),
    repositoryNotes: applyTransform<
      CopiedRepositoryNote,
      PasteRepositoryNoteItem
    >({
      notes: repositoryNotes,
      getBoundKey: (note) => note.boundToOriginalPodId,
      mapFn: (note, position) => ({
        repositoryId: note.repositoryId,
        name: note.name,
        x: position.x,
        y: position.y,
        boundToOriginalPodId: note.boundToOriginalPodId,
        originalPosition: note.originalPosition,
      }),
    }),
    connections: transformConnections(connections),
  };
}
