import type {
  SelectableElement,
  CopiedPod,
  CopiedRepositoryNote,
  CopiedConnection,
  AnchorPosition,
  TriggerMode,
  Pod,
  PodProvider,
} from "@/types";

type NoteWithIndexSignature = {
  boundToPodId: string | null;
  [key: string]: unknown;
};

type AnyNote = CopiedRepositoryNote;

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

/**
 * @internal 僅供模組內部與測試使用，不應從 index.ts re-export 給外部消費。
 */
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

const mapToRepositoryNote =
  createOriginalBoundNoteMapper<CopiedRepositoryNote>("repositoryId");

export interface NoteStores {
  repositoryStore: StoreWithNotes;
}

interface NoteStoreConfig {
  key: string;
  getStore: (stores: NoteStores) => StoreWithNotes;
  mapFn: (note: NoteWithIndexSignature) => AnyNote;
}

const NOTE_STORE_CONFIGS: NoteStoreConfig[] = [
  {
    key: "repositoryNote",
    getStore: (stores) => stores.repositoryStore,
    mapFn: mapToRepositoryNote,
  },
];

type CollectedNoteArrays = {
  repositoryNote: CopiedRepositoryNote[];
};

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
          mcpServerNames: pod.mcpServerNames,
          pluginIds: pod.pluginIds,
          repositoryId: pod.repositoryId,
          goal: pod.goal ?? null,
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

/**
 * 收集所有選取 Pod 的 bound notes（依 podId groupBy Map O(1) 查找）。
 * 分離自 collectSelectedNotes，單一職責：只處理 bound note 收集。
 */
function collectBoundNotesByPodIds(
  podIds: Set<string>,
  stores: NoteStores,
): CollectedNoteArrays {
  const repositoryBoundMap = buildBoundNotesByPodMap(
    stores.repositoryStore.notes,
  );

  const arrays: CollectedNoteArrays = {
    repositoryNote: [],
  };

  for (const podId of podIds) {
    arrays.repositoryNote.push(
      ...collectBoundNotesFromMap(
        podId,
        repositoryBoundMap,
        mapToRepositoryNote,
      ),
    );
  }

  return arrays;
}

/**
 * 建立 noteCollectorMap：將各 NoteStoreConfig 轉為 { collector, array } 查找表。
 * 讓 collectUnboundNotesByElements 只需負責「取 map → 遍歷」兩步，單一抽象層級。
 */
function buildNoteCollectorMap(
  stores: NoteStores,
  arrays: CollectedNoteArrays,
): Record<
  string,
  { collector: (id: string) => AnyNote | null; array: AnyNote[] }
> {
  return Object.fromEntries(
    NOTE_STORE_CONFIGS.map((config) => [
      config.key,
      {
        collector: createUnboundNoteCollectorFromMap<AnyNote>(
          buildNoteByIdMap(config.getStore(stores).notes),
          config.mapFn,
        ),
        array: arrays[config.key as keyof CollectedNoteArrays] as AnyNote[],
      },
    ]),
  ) as Record<
    string,
    { collector: (id: string) => AnyNote | null; array: AnyNote[] }
  >;
}

/**
 * 從 selectedElements 中收集 unbound notes（依 id→note Map O(1) 查找）。
 * 分離自 collectSelectedNotes，單一職責：只處理 unbound note 收集。
 * 結果合併進傳入的 arrays（in-place append）。
 */
function collectUnboundNotesByElements(
  elements: SelectableElement[],
  stores: NoteStores,
  arrays: CollectedNoteArrays,
): void {
  const noteCollectorMap = buildNoteCollectorMap(stores, arrays);

  for (const element of elements) {
    collectNoteFromElement(element, noteCollectorMap);
  }
}

export function collectSelectedNotes(
  selectedElements: SelectableElement[],
  selectedPodIds: Set<string>,
  noteStores: NoteStores,
): {
  repositoryNotes: CopiedRepositoryNote[];
} {
  // 高階組裝：bound notes（Pod 相關） + unbound notes（element 相關）
  const arrays = collectBoundNotesByPodIds(selectedPodIds, noteStores);
  collectUnboundNotesByElements(selectedElements, noteStores, arrays);

  return {
    repositoryNotes: arrays.repositoryNote,
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
    summaryProvider?: PodProvider | null;
    summaryModel?: string;
    summaryThinkingLevel?: string | null;
    label?: string;
    description?: string;
    branchProvider?: PodProvider;
    branchModel?: string;
    branchThinkingLevel?: string | null;
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
        summaryProvider: connection.summaryProvider,
        summaryModel: connection.summaryModel,
        summaryThinkingLevel: connection.summaryThinkingLevel,
        label: connection.label,
        description: connection.description,
        branchProvider: connection.branchProvider,
        branchModel: connection.branchModel,
        branchThinkingLevel: connection.branchThinkingLevel,
      });
    }
  }

  return copiedConnections;
}
