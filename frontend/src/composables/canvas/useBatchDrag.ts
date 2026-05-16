import { useCanvasContext } from "./useCanvasContext";
import { useDragHandler } from "@/composables/useDragHandler";
import { MOUSE_BUTTON } from "@/lib/constants";

type NoteStore = {
  notes: { id?: string; x: number; y: number; boundToPodId?: string | null }[];
  updateNotePositionLocal: (id: string, x: number, y: number) => void;
  updateNotePosition: (noteId: string, x: number, y: number) => Promise<void>;
};

type StoreConfigEntry = {
  movedSet: Set<string>;
  moveItem: (id: string, x: number, y: number) => void;
  getItem: (
    id: string,
  ) => { x: number; y: number; boundToPodId?: string | null } | undefined;
  isPod: boolean;
};

interface BatchDragStores {
  podStore: ReturnType<typeof useCanvasContext>["podStore"];
  repositoryStore: NoteStore;
}

interface MovedElementSets {
  movedPodIds: Set<string>;
  movedRepositoryNoteIds: Set<string>;
}

function createStoreConfigMap(
  stores: BatchDragStores,
  movedSets: MovedElementSets,
): Record<string, StoreConfigEntry> {
  const { podStore, repositoryStore } = stores;
  const { movedPodIds, movedRepositoryNoteIds } = movedSets;

  // 預建 Map 查找表，將每個 store 的 items 轉為 O(1) 查找，避免每幀拖曳的 O(n) Array.find
  const podMap = new Map(podStore.pods.map((p) => [p.id, p]));
  const repositoryMap = new Map(
    repositoryStore.notes.map((n) => [n.id ?? "", n]),
  );

  return {
    pod: {
      movedSet: movedPodIds,
      moveItem: (id: string, x: number, y: number) =>
        podStore.movePod(id, x, y),
      getItem: (id: string) => podMap.get(id),
      isPod: true,
    },
    repositoryNote: {
      movedSet: movedRepositoryNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        repositoryStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => repositoryMap.get(id),
      isPod: false,
    },
  };
}

export function useBatchDrag(): {
  isBatchDragging: import("vue").Ref<boolean>;
  startBatchDrag: (e: MouseEvent) => boolean;
  isElementSelected: (type: "pod" | "repositoryNote", id: string) => boolean;
} {
  const { podStore, viewportStore, selectionStore, repositoryStore } =
    useCanvasContext();

  const dragState = {
    startX: 0,
    startY: 0,
    movedPodIds: new Set<string>(),
    movedRepositoryNoteIds: new Set<string>(),
    // 拖曳開始時預建一次，避免每幀重建多份 Map（效能優化）
    storeConfigMap: null as ReturnType<typeof createStoreConfigMap> | null,
  };

  const clearDragState = (): void => {
    dragState.movedPodIds.clear();
    dragState.movedRepositoryNoteIds.clear();
    dragState.storeConfigMap = null;
  };

  const noteMovedSets: {
    set: Set<string>;
    configKey: "repositoryNote";
    store: NoteStore;
  }[] = [
    {
      set: dragState.movedRepositoryNoteIds,
      configKey: "repositoryNote",
      store: repositoryStore,
    },
  ];

  const { isDragging: isBatchDragging, startDrag } = useDragHandler({
    onMove: (moveEvent: MouseEvent): void => {
      const deltaXInCanvasCoords =
        (moveEvent.clientX - dragState.startX) / viewportStore.zoom;
      const deltaYInCanvasCoords =
        (moveEvent.clientY - dragState.startY) / viewportStore.zoom;

      moveSelectedElements(deltaXInCanvasCoords, deltaYInCanvasCoords);

      dragState.startX = moveEvent.clientX;
      dragState.startY = moveEvent.clientY;
    },
    onEnd: async (): Promise<void> => {
      await syncElementsToBackend();
    },
  });

  const startBatchDrag = (e: MouseEvent): boolean => {
    if (e.button !== MOUSE_BUTTON.LEFT) return false;

    if (!selectionStore.hasSelection) return false;

    dragState.startX = e.clientX;
    dragState.startY = e.clientY;

    clearDragState();

    // 拖曳開始時預建 storeConfigMap，整次拖曳只建一次，避免每幀重建四份 Map
    dragState.storeConfigMap = createStoreConfigMap(
      { podStore, repositoryStore },
      {
        movedPodIds: dragState.movedPodIds,
        movedRepositoryNoteIds: dragState.movedRepositoryNoteIds,
      },
    );

    startDrag(e);

    return true;
  };

  const movePodElement = (
    config: StoreConfigEntry,
    id: string,
    item: { x: number; y: number },
    deltaX: number,
    deltaY: number,
  ): void => {
    config.moveItem(id, item.x + deltaX, item.y + deltaY);
    config.movedSet.add(id);
  };

  const moveNoteElement = (
    config: StoreConfigEntry,
    id: string,
    item: { x: number; y: number; boundToPodId?: string | null },
    deltaX: number,
    deltaY: number,
  ): void => {
    if (item.boundToPodId) return;
    config.moveItem(id, item.x + deltaX, item.y + deltaY);
    config.movedSet.add(id);
  };

  const moveSelectedElements = (deltaX: number, deltaY: number): void => {
    if (!dragState.storeConfigMap) return;

    for (const element of selectionStore.selectedElements) {
      const config = dragState.storeConfigMap[element.type];
      if (!config) continue;

      const item = config.getItem(element.id);
      if (!item) continue;

      const moveElement = config.isPod ? movePodElement : moveNoteElement;
      moveElement(config, element.id, item, deltaX, deltaY);
    }
  };

  const syncNotesByType = async (
    movedNoteIds: Set<string>,
    configKey: "repositoryNote",
    store: {
      updateNotePosition: (
        noteId: string,
        x: number,
        y: number,
      ) => Promise<void>;
    },
  ): Promise<void> => {
    // 複用拖曳開始時預建的 Map，O(1) 查找取代 O(n) Array.find
    const configEntry = dragState.storeConfigMap?.[configKey];
    if (!configEntry) return;

    const updates = [...movedNoteIds].flatMap((noteId) => {
      const item = configEntry.getItem(noteId);
      return item ? [store.updateNotePosition(noteId, item.x, item.y)] : [];
    });
    await Promise.all(updates);
  };

  const syncElementsToBackend = async (): Promise<void> => {
    dragState.movedPodIds.forEach((podId) => podStore.syncPodPosition(podId));

    // 在 clearDragState 前完成 sync，storeConfigMap 才能做 O(1) 查找
    await Promise.all(
      noteMovedSets.map(({ set, configKey, store }) =>
        syncNotesByType(set, configKey, store),
      ),
    );

    clearDragState();
  };

  const isElementSelected = (
    type: "pod" | "repositoryNote",
    id: string,
  ): boolean => {
    // selectionStore.isElementSelected 內部使用 Set，O(1) 查找
    return selectionStore.isElementSelected(type, id);
  };

  return {
    isBatchDragging,
    startBatchDrag,
    isElementSelected,
  };
}
