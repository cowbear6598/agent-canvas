import type {
  SelectableElement,
  CopiedPod,
  CopiedRepositoryNote,
  CopiedSubAgentNote,
  CopiedCommandNote,
  CopiedMcpServerNote,
  CopiedConnection,
  AnchorPosition,
  TriggerMode,
  Pod,
} from "@/types";

type NoteWithIndexSignature = {
  boundToPodId: string | null;
  [key: string]: unknown;
};

type AnyNote =
  | CopiedRepositoryNote
  | CopiedSubAgentNote
  | CopiedCommandNote
  | CopiedMcpServerNote;

type StoreWithNotes<
  TNote extends NoteWithIndexSignature = NoteWithIndexSignature,
> = {
  notes: TNote[];
};

export interface BoundNotesByType {
  repositoryNotes: CopiedRepositoryNote[];
  subAgentNotes: CopiedSubAgentNote[];
  commandNotes: CopiedCommandNote[];
  mcpServerNotes: CopiedMcpServerNote[];
}

export function collectBoundNotesFromStore<
  T,
  TNote extends NoteWithIndexSignature,
>(podId: string, store: StoreWithNotes<TNote>, mapFn: (note: TNote) => T): T[] {
  return store.notes
    .filter((note) => note.boundToPodId === podId)
    .map((note) => mapFn(note));
}

type NoteBaseFields = {
  name: string;
  x: number;
  y: number;
  originalPosition: { x: number; y: number } | null;
};

function extractNoteBaseFields(note: NoteWithIndexSignature): NoteBaseFields {
  return {
    name: note.name as string,
    x: note.x as number,
    y: note.y as number,
    originalPosition:
      note.originalPosition as NoteBaseFields["originalPosition"],
  };
}

function createBoundNoteMapper<
  T extends NoteBaseFields & { boundToPodId: string | null },
>(idField: string): (note: NoteWithIndexSignature) => T {
  return (note: NoteWithIndexSignature): T =>
    ({
      ...extractNoteBaseFields(note),
      id: note.id as string,
      [idField]: note[idField] as string,
      boundToPodId: note.boundToPodId,
    }) as unknown as T;
}

function createOriginalBoundNoteMapper<
  T extends NoteBaseFields & { boundToOriginalPodId: string | null },
>(idField: string): (note: NoteWithIndexSignature) => T {
  return (note: NoteWithIndexSignature): T =>
    ({
      ...extractNoteBaseFields(note),
      [idField]: note[idField] as string,
      boundToOriginalPodId: note.boundToPodId,
    }) as unknown as T;
}

const mapToSubAgentNote =
  createBoundNoteMapper<CopiedSubAgentNote>("subAgentId");
const mapToMcpServerNote =
  createBoundNoteMapper<CopiedMcpServerNote>("mcpServerId");
const mapToRepositoryNote =
  createOriginalBoundNoteMapper<CopiedRepositoryNote>("repositoryId");
const mapToCommandNote =
  createOriginalBoundNoteMapper<CopiedCommandNote>("commandId");

export function collectBoundNotes(
  podId: string,
  stores: NoteStores,
): BoundNotesByType {
  return {
    repositoryNotes: collectBoundNotesFromStore(
      podId,
      stores.repositoryStore,
      mapToRepositoryNote,
    ),
    subAgentNotes: collectBoundNotesFromStore(
      podId,
      stores.subAgentStore,
      mapToSubAgentNote,
    ),
    commandNotes: collectBoundNotesFromStore(
      podId,
      stores.commandStore,
      mapToCommandNote,
    ),
    mcpServerNotes: collectBoundNotesFromStore(
      podId,
      stores.mcpServerStore,
      mapToMcpServerNote,
    ),
  };
}

export function createUnboundNoteCollector<T>(
  store: StoreWithNotes,
  mapFn: (note: NoteWithIndexSignature) => T,
): (noteId: string) => T | null {
  return (noteId: string): T | null => {
    const note = store.notes.find((note) => note.id === noteId);
    if (!note || note.boundToPodId !== null) return null;
    return mapFn(note);
  };
}

export function collectSelectedPods(
  selectedElements: SelectableElement[],
  pods: Pod[],
): CopiedPod[] {
  const podMap = new Map(pods.map((pod) => [pod.id, pod]));

  return selectedElements
    .filter((element) => element.type === "pod")
    .flatMap((element) => {
      const pod = podMap.get(element.id);
      if (!pod) return [];
      return [
        {
          id: pod.id,
          name: pod.name,
          x: pod.x,
          y: pod.y,
          rotation: pod.rotation,
          provider: pod.provider,
          providerConfig: pod.providerConfig,
          subAgentIds: pod.subAgentIds,
          repositoryId: pod.repositoryId,
          commandId: pod.commandId,
        },
      ];
    });
}

function collectNoteFromElement(
  element: SelectableElement,
  noteCollectorMap: Record<
    string,
    { collector: (id: string) => AnyNote | null; array: AnyNote[] }
  >,
): void {
  const collectorInfo =
    noteCollectorMap[element.type as keyof typeof noteCollectorMap];
  if (!collectorInfo) return;
  const note = collectorInfo.collector(element.id);
  if (note) {
    collectorInfo.array.push(note);
  }
}

export interface NoteStores {
  repositoryStore: StoreWithNotes;
  subAgentStore: StoreWithNotes;
  commandStore: StoreWithNotes;
  mcpServerStore: StoreWithNotes;
}

interface NoteStoreConfig {
  key: string;
  getStore: (noteStores: NoteStores) => StoreWithNotes;
  mapFn: (note: NoteWithIndexSignature) => AnyNote;
}

const NOTE_STORE_CONFIGS: NoteStoreConfig[] = [
  {
    key: "repositoryNote",
    getStore: (noteStores) => noteStores.repositoryStore,
    mapFn: mapToRepositoryNote,
  },
  {
    key: "subAgentNote",
    getStore: (noteStores) => noteStores.subAgentStore,
    mapFn: mapToSubAgentNote,
  },
  {
    key: "commandNote",
    getStore: (noteStores) => noteStores.commandStore,
    mapFn: mapToCommandNote,
  },
  {
    key: "mcpServerNote",
    getStore: (noteStores) => noteStores.mcpServerStore,
    mapFn: mapToMcpServerNote,
  },
];

type CollectedNoteArrays = {
  repositoryNote: CopiedRepositoryNote[];
  subAgentNote: CopiedSubAgentNote[];
  commandNote: CopiedCommandNote[];
  mcpServerNote: CopiedMcpServerNote[];
};

export function collectSelectedNotes(
  selectedElements: SelectableElement[],
  selectedPodIds: Set<string>,
  noteStores: NoteStores,
): {
  repositoryNotes: CopiedRepositoryNote[];
  subAgentNotes: CopiedSubAgentNote[];
  commandNotes: CopiedCommandNote[];
  mcpServerNotes: CopiedMcpServerNote[];
} {
  const arrays: CollectedNoteArrays = {
    repositoryNote: [],
    subAgentNote: [],
    commandNote: [],
    mcpServerNote: [],
  };

  for (const podId of selectedPodIds) {
    const boundNotes = collectBoundNotes(podId, noteStores);
    arrays.repositoryNote.push(...boundNotes.repositoryNotes);
    arrays.subAgentNote.push(...boundNotes.subAgentNotes);
    arrays.commandNote.push(...boundNotes.commandNotes);
    arrays.mcpServerNote.push(...boundNotes.mcpServerNotes);
  }

  const noteCollectorMap = Object.fromEntries(
    NOTE_STORE_CONFIGS.map((config) => [
      config.key,
      {
        collector: createUnboundNoteCollector<AnyNote>(
          config.getStore(noteStores),
          config.mapFn,
        ),
        array: arrays[config.key as keyof CollectedNoteArrays] as AnyNote[],
      },
    ]),
  ) as Record<
    string,
    { collector: (id: string) => AnyNote | null; array: AnyNote[] }
  >;

  for (const element of selectedElements) {
    collectNoteFromElement(element, noteCollectorMap);
  }

  return {
    repositoryNotes: arrays.repositoryNote,
    subAgentNotes: arrays.subAgentNote,
    commandNotes: arrays.commandNote,
    mcpServerNotes: arrays.mcpServerNote,
  };
}

export function collectRelatedConnections(
  selectedPodIds: Set<string>,
  connections: {
    id: string;
    sourcePodId?: string;
    targetPodId: string;
    sourceAnchor: AnchorPosition;
    targetAnchor: AnchorPosition;
    triggerMode: TriggerMode;
  }[],
): CopiedConnection[] {
  const copiedConnections: CopiedConnection[] = [];

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
      });
    }
  }

  return copiedConnections;
}
