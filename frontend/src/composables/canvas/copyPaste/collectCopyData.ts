import type {
  SelectableElement,
  CopiedPod,
  CopiedRepositoryNote,
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

type AnyNote = CopiedRepositoryNote | CopiedCommandNote | CopiedMcpServerNote;

type StoreWithNotes<
  TNote extends NoteWithIndexSignature = NoteWithIndexSignature,
> = {
  notes: TNote[];
};

/** 將 notes 依 boundToPodId 建立 groupBy Map，O(N) 一次完成 */
function buildBoundNotesByPodMap<TNote extends NoteWithIndexSignature>(
  notes: TNote[],
): Map<string, TNote[]> {
  const map = new Map<string, TNote[]>();
  for (const note of notes) {
    if (note.boundToPodId === null) continue;
    const list = map.get(note.boundToPodId);
    if (list) {
      list.push(note);
    } else {
      map.set(note.boundToPodId, [note]);
    }
  }
  return map;
}

/** 將 notes 依 id 建立查找 Map，供 O(1) 單筆取得 */
function buildNoteByIdMap<TNote extends NoteWithIndexSignature>(
  notes: TNote[],
): Map<string, TNote> {
  return new Map(notes.map((note) => [note.id as string, note]));
}

export interface BoundNotesByType {
  repositoryNotes: CopiedRepositoryNote[];
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

/**
 * 利用預建的 groupBy Map 取出指定 podId 的 bound notes，O(1) 查找。
 * 相較 collectBoundNotesFromStore 每次都全掃 store.notes，
 * 此版本需呼叫者先以 buildBoundNotesByPodMap 建立 Map。
 */
function collectBoundNotesFromMap<T, TNote extends NoteWithIndexSignature>(
  podId: string,
  boundByPodMap: Map<string, TNote[]>,
  mapFn: (note: TNote) => T,
): T[] {
  return (boundByPodMap.get(podId) ?? []).map((note) => mapFn(note));
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

/**
 * 利用預建的 id→note Map 進行 O(1) 查找，取代 store.notes.find O(n)。
 * 呼叫者應先以 buildNoteByIdMap 建立 noteByIdMap。
 */
function createUnboundNoteCollectorFromMap<T>(
  noteByIdMap: Map<string, NoteWithIndexSignature>,
  mapFn: (note: NoteWithIndexSignature) => T,
): (noteId: string) => T | null {
  return (noteId: string): T | null => {
    const note = noteByIdMap.get(noteId);
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
      // SECURITY：providerConfig 包含 API key 等敏感設定，存於 in-memory clipboardStore。
      // paste 出來的新 Pod 需要 providerConfig 才能正常運作，因此必須保留此欄位。
      // XSS 防線在框架層（Vue 的 template 自動 escape），此處不另行過濾。
      return [
        {
          id: pod.id,
          name: pod.name,
          x: pod.x,
          y: pod.y,
          rotation: pod.rotation,
          provider: pod.provider,
          providerConfig: pod.providerConfig,
          mcpServerIds: pod.mcpServerIds,
          pluginIds: pod.pluginIds,
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
  commandNote: CopiedCommandNote[];
  mcpServerNote: CopiedMcpServerNote[];
};

export function collectSelectedNotes(
  selectedElements: SelectableElement[],
  selectedPodIds: Set<string>,
  noteStores: NoteStores,
): {
  repositoryNotes: CopiedRepositoryNote[];
  commandNotes: CopiedCommandNote[];
  mcpServerNotes: CopiedMcpServerNote[];
} {
  const arrays: CollectedNoteArrays = {
    repositoryNote: [],
    commandNote: [],
    mcpServerNote: [],
  };

  // 各 store 各建一份 groupBy Map（O(N)），供後續 bound note 查找使用（#51）
  const repositoryBoundMap = buildBoundNotesByPodMap(
    noteStores.repositoryStore.notes,
  );
  const commandBoundMap = buildBoundNotesByPodMap(
    noteStores.commandStore.notes,
  );
  const mcpServerBoundMap = buildBoundNotesByPodMap(
    noteStores.mcpServerStore.notes,
  );

  for (const podId of selectedPodIds) {
    arrays.repositoryNote.push(
      ...collectBoundNotesFromMap(
        podId,
        repositoryBoundMap,
        mapToRepositoryNote,
      ),
    );
    arrays.commandNote.push(
      ...collectBoundNotesFromMap(podId, commandBoundMap, mapToCommandNote),
    );
    arrays.mcpServerNote.push(
      ...collectBoundNotesFromMap(podId, mcpServerBoundMap, mapToMcpServerNote),
    );
  }

  // 各 store 各建一份 id→note Map（O(N)），供 unbound note 查找使用（#53）
  const noteCollectorMap = Object.fromEntries(
    NOTE_STORE_CONFIGS.map((config) => [
      config.key,
      {
        collector: createUnboundNoteCollectorFromMap<AnyNote>(
          buildNoteByIdMap(config.getStore(noteStores).notes),
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
