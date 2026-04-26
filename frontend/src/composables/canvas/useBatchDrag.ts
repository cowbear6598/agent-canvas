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
  commandStore: NoteStore;
  mcpServerStore: NoteStore;
}

interface MovedElementSets {
  movedPodIds: Set<string>;
  movedRepositoryNoteIds: Set<string>;
  movedCommandNoteIds: Set<string>;
  movedMcpServerNoteIds: Set<string>;
}

function createStoreConfigMap(
  stores: BatchDragStores,
  movedSets: MovedElementSets,
): Record<string, StoreConfigEntry> {
  const { podStore, repositoryStore, commandStore, mcpServerStore } = stores;
  const {
    movedPodIds,
    movedRepositoryNoteIds,
    movedCommandNoteIds,
    movedMcpServerNoteIds,
  } = movedSets;

  // 預建 Map 查找表，將每個 store 的 items 轉為 O(1) 查找，避免每幀拖曳的 O(n) Array.find
  const podMap = new Map(podStore.pods.map((p) => [p.id, p]));
  const repositoryMap = new Map(
    repositoryStore.notes.map((n) => [n.id ?? "", n]),
  );
  const commandMap = new Map(commandStore.notes.map((n) => [n.id ?? "", n]));
  const mcpServerMap = new Map(
    mcpServerStore.notes.map((n) => [n.id ?? "", n]),
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
    commandNote: {
      movedSet: movedCommandNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        commandStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => commandMap.get(id),
      isPod: false,
    },
    mcpServerNote: {
      movedSet: movedMcpServerNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        mcpServerStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => mcpServerMap.get(id),
      isPod: false,
    },
  };
}

export function useBatchDrag(): {
  isBatchDragging: import("vue").Ref<boolean>;
  startBatchDrag: (e: MouseEvent) => boolean;
  isElementSelected: (
    type: "pod" | "repositoryNote" | "commandNote" | "mcpServerNote",
    id: string,
  ) => boolean;
} {
  const {
    podStore,
    viewportStore,
    selectionStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
  } = useCanvasContext();

  const dragState = {
    startX: 0,
    startY: 0,
    movedPodIds: new Set<string>(),
    movedRepositoryNoteIds: new Set<string>(),
    movedCommandNoteIds: new Set<string>(),
    movedMcpServerNoteIds: new Set<string>(),
  };

  const clearDragState = (): void => {
    dragState.movedPodIds.clear();
    dragState.movedRepositoryNoteIds.clear();
    dragState.movedCommandNoteIds.clear();
    dragState.movedMcpServerNoteIds.clear();
  };

  const noteMovedSets: { set: Set<string>; store: NoteStore }[] = [
    { set: dragState.movedRepositoryNoteIds, store: repositoryStore },
    { set: dragState.movedCommandNoteIds, store: commandStore },
    { set: dragState.movedMcpServerNoteIds, store: mcpServerStore },
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
    const storeConfigMap = createStoreConfigMap(
      {
        podStore,
        repositoryStore,
        commandStore,
        mcpServerStore,
      },
      {
        movedPodIds: dragState.movedPodIds,
        movedRepositoryNoteIds: dragState.movedRepositoryNoteIds,
        movedCommandNoteIds: dragState.movedCommandNoteIds,
        movedMcpServerNoteIds: dragState.movedMcpServerNoteIds,
      },
    );

    for (const element of selectionStore.selectedElements) {
      const config = storeConfigMap[element.type];
      if (!config) continue;

      const item = config.getItem(element.id);
      if (!item) continue;

      const moveElement = config.isPod ? movePodElement : moveNoteElement;
      moveElement(config, element.id, item, deltaX, deltaY);
    }
  };

  const syncNotesByType = async <
    T extends { id?: string; x: number; y: number },
  >(
    movedNoteIds: Set<string>,
    store: {
      notes: T[];
      updateNotePosition: (
        noteId: string,
        x: number,
        y: number,
      ) => Promise<void>;
    },
  ): Promise<void> => {
    const updates = [...movedNoteIds].flatMap((noteId) => {
      const note = store.notes.find((note) => note.id === noteId);
      return note ? [store.updateNotePosition(noteId, note.x, note.y)] : [];
    });
    await Promise.all(updates);
  };

  const syncElementsToBackend = async (): Promise<void> => {
    dragState.movedPodIds.forEach((podId) => podStore.syncPodPosition(podId));

    await Promise.all(
      noteMovedSets.map(({ set, store }) => syncNotesByType(set, store)),
    );

    clearDragState();
  };

  const isElementSelected = (
    type: "pod" | "repositoryNote" | "commandNote" | "mcpServerNote",
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
