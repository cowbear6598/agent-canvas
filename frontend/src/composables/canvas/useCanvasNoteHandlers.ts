import { computed } from "vue";
import type { ComputedRef, Ref } from "vue";
import { useNoteEventHandlers } from "@/composables/canvas/useNoteEventHandlers";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import type { usePodStore } from "@/stores/pod";
import type { useViewportStore } from "@/stores/pod";
import type { useRepositoryStore } from "@/stores/note";
import TrashZone from "@/components/canvas/TrashZone.vue";

interface NoteStoreBase {
  isDraggingNote: boolean;
  isOverTrash: boolean;
  notes: unknown[];
  createNote: (id: string, x: number, y: number) => void;
  updateNotePositionLocal: (noteId: string, x: number, y: number) => void;
  updateNotePosition: (noteId: string, x: number, y: number) => Promise<void>;
  setIsOverTrash: (isOver: boolean) => void;
  setNoteAnimating: (noteId: string, isAnimating: boolean) => void;
  deleteNote: (noteId: string) => Promise<void>;
  getNoteById: (
    noteId: string,
  ) => { x: number; y: number; boundToPodId: string | null } | undefined;
}

interface UseCanvasNoteHandlersOptions {
  podStore: ReturnType<typeof usePodStore>;
  viewportStore: ReturnType<typeof useViewportStore>;
  repositoryStore: ReturnType<typeof useRepositoryStore>;
  trashZoneRef: Ref<InstanceType<typeof TrashZone> | null>;
}

type NoteHandlerMap = {
  repository: ReturnType<typeof useNoteEventHandlers>;
};

export function useCanvasNoteHandlers(options: UseCanvasNoteHandlersOptions): {
  noteHandlerMap: NoteHandlerMap;
  showTrashZone: ComputedRef<boolean>;
  isTrashHighlighted: ComputedRef<boolean>;
  isCanvasEmpty: ComputedRef<boolean>;
  handleCreateRepositoryNote: (itemId: string) => void;
  getRepositoryBranchName: (repositoryId: string) => string | undefined;
} {
  const { podStore, viewportStore, repositoryStore, trashZoneRef } = options;

  const noteConfigs = [
    { store: repositoryStore as NoteStoreBase, type: "repository" as const },
  ] as const;

  const allNoteStores = noteConfigs.map((config) => config.store);

  const checkAnyStoreProperty = (
    property: "isDraggingNote" | "isOverTrash",
  ): boolean => allNoteStores.some((store) => store[property]);

  const showTrashZone = computed(() => checkAnyStoreProperty("isDraggingNote"));
  const isTrashHighlighted = computed(() =>
    checkAnyStoreProperty("isOverTrash"),
  );

  const isCanvasEmpty = computed(
    () =>
      podStore.podCount === 0 &&
      allNoteStores.every((store) => store.notes.length === 0),
  );

  const noteHandlerEntries = noteConfigs.map((config) => [
    config.type,
    useNoteEventHandlers({ store: config.store, trashZoneRef }),
  ]);
  const noteHandlerMap = Object.fromEntries(noteHandlerEntries) as NoteHandlerMap;

  const createNoteHandler = (store: NoteStoreBase) => {
    return (itemId: string): void => {
      if (!podStore.typeMenu.position) return;

      const { x, y } = screenToCanvasPosition(
        podStore.typeMenu.position,
        viewportStore,
      );

      store.createNote(itemId, x, y);
    };
  };

  const handleCreateRepositoryNote = createNoteHandler(
    repositoryStore as NoteStoreBase,
  );

  const getRepositoryBranchName = (
    repositoryId: string,
  ): string | undefined => {
    // 改用 itemById Map（O(1) 查找），取代 Array.find 線性掃描
    const repository = repositoryStore.itemById.get(repositoryId);
    return repository?.currentBranch;
  };

  return {
    noteHandlerMap,
    showTrashZone,
    isTrashHighlighted,
    isCanvasEmpty,
    handleCreateRepositoryNote,
    getRepositoryBranchName,
  };
}
