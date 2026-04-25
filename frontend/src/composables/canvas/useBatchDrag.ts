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
  skillStore: NoteStore;
  repositoryStore: NoteStore;
  subAgentStore: NoteStore;
  commandStore: NoteStore;
  mcpServerStore: NoteStore;
}

interface MovedElementSets {
  movedPodIds: Set<string>;
  movedSkillNoteIds: Set<string>;
  movedRepositoryNoteIds: Set<string>;
  movedSubAgentNoteIds: Set<string>;
  movedCommandNoteIds: Set<string>;
  movedMcpServerNoteIds: Set<string>;
}

function createStoreConfigMap(
  stores: BatchDragStores,
  movedSets: MovedElementSets,
): Record<string, StoreConfigEntry> {
  const {
    podStore,
    skillStore,
    repositoryStore,
    subAgentStore,
    commandStore,
    mcpServerStore,
  } = stores;
  const {
    movedPodIds,
    movedSkillNoteIds,
    movedRepositoryNoteIds,
    movedSubAgentNoteIds,
    movedCommandNoteIds,
    movedMcpServerNoteIds,
  } = movedSets;
  return {
    pod: {
      movedSet: movedPodIds,
      moveItem: (id: string, x: number, y: number) =>
        podStore.movePod(id, x, y),
      getItem: (id: string) => podStore.pods.find((pod) => pod.id === id),
      isPod: true,
    },
    skillNote: {
      movedSet: movedSkillNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        skillStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) => skillStore.notes.find((note) => note.id === id),
      isPod: false,
    },
    repositoryNote: {
      movedSet: movedRepositoryNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        repositoryStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) =>
        repositoryStore.notes.find((note) => note.id === id),
      isPod: false,
    },
    subAgentNote: {
      movedSet: movedSubAgentNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        subAgentStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) =>
        subAgentStore.notes.find((note) => note.id === id),
      isPod: false,
    },
    commandNote: {
      movedSet: movedCommandNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        commandStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) =>
        commandStore.notes.find((note) => note.id === id),
      isPod: false,
    },
    mcpServerNote: {
      movedSet: movedMcpServerNoteIds,
      moveItem: (id: string, x: number, y: number) =>
        mcpServerStore.updateNotePositionLocal(id, x, y),
      getItem: (id: string) =>
        mcpServerStore.notes.find((note) => note.id === id),
      isPod: false,
    },
  };
}

export function useBatchDrag(): {
  isBatchDragging: import("vue").Ref<boolean>;
  startBatchDrag: (e: MouseEvent) => boolean;
  isElementSelected: (
    type:
      | "pod"
      | "skillNote"
      | "repositoryNote"
      | "subAgentNote"
      | "commandNote"
      | "mcpServerNote",
    id: string,
  ) => boolean;
} {
  const {
    podStore,
    viewportStore,
    selectionStore,
    skillStore,
    repositoryStore,
    subAgentStore,
    commandStore,
    mcpServerStore,
  } = useCanvasContext();

  const dragState = {
    startX: 0,
    startY: 0,
    movedPodIds: new Set<string>(),
    movedSkillNoteIds: new Set<string>(),
    movedRepositoryNoteIds: new Set<string>(),
    movedSubAgentNoteIds: new Set<string>(),
    movedCommandNoteIds: new Set<string>(),
    movedMcpServerNoteIds: new Set<string>(),
  };

  const clearDragState = (): void => {
    dragState.movedPodIds.clear();
    dragState.movedSkillNoteIds.clear();
    dragState.movedRepositoryNoteIds.clear();
    dragState.movedSubAgentNoteIds.clear();
    dragState.movedCommandNoteIds.clear();
    dragState.movedMcpServerNoteIds.clear();
  };

  const noteMovedSets: { set: Set<string>; store: NoteStore }[] = [
    { set: dragState.movedSkillNoteIds, store: skillStore },
    { set: dragState.movedRepositoryNoteIds, store: repositoryStore },
    { set: dragState.movedSubAgentNoteIds, store: subAgentStore },
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
        skillStore,
        repositoryStore,
        subAgentStore,
        commandStore,
        mcpServerStore,
      },
      {
        movedPodIds: dragState.movedPodIds,
        movedSkillNoteIds: dragState.movedSkillNoteIds,
        movedRepositoryNoteIds: dragState.movedRepositoryNoteIds,
        movedSubAgentNoteIds: dragState.movedSubAgentNoteIds,
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
    type:
      | "pod"
      | "skillNote"
      | "repositoryNote"
      | "subAgentNote"
      | "commandNote"
      | "mcpServerNote",
    id: string,
  ): boolean => {
    return selectionStore.selectedElements.some(
      (el) => el.type === type && el.id === id,
    );
  };

  return {
    isBatchDragging,
    startBatchDrag,
    isElementSelected,
  };
}
