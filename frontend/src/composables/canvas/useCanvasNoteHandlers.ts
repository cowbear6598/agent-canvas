import { computed } from "vue";
import type { ComputedRef, Ref } from "vue";
import { useNoteEventHandlers } from "@/composables/canvas/useNoteEventHandlers";
import { useNoteDoubleClick } from "@/composables/canvas/useNoteDoubleClick";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import type { usePodStore } from "@/stores/pod";
import type { useViewportStore } from "@/stores/pod";
import type { useRepositoryStore, useCommandStore } from "@/stores/note";
import TrashZone from "@/components/canvas/TrashZone.vue";

// EditableNoteType 供 UseCanvasNoteHandlersOptions.handleOpenEditModal 型別引用
type EditableNoteType = "command";

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
  commandStore: ReturnType<typeof useCommandStore>;
  trashZoneRef: Ref<InstanceType<typeof TrashZone> | null>;
  handleOpenEditModal: (
    type: EditableNoteType,
    id: string,
  ) => Promise<void> | void;
}

type NoteType = "repository" | "command";

export function useCanvasNoteHandlers(options: UseCanvasNoteHandlersOptions): {
  noteHandlerMap: Record<NoteType, ReturnType<typeof useNoteEventHandlers>>;
  showTrashZone: ComputedRef<boolean>;
  isTrashHighlighted: ComputedRef<boolean>;
  isCanvasEmpty: ComputedRef<boolean>;
  handleCreateRepositoryNote: (itemId: string) => void;
  handleCreateCommandNote: (itemId: string) => void;
  getRepositoryBranchName: (repositoryId: string) => string | undefined;
  handleNoteDoubleClick: (data: {
    noteId: string;
    noteType: NoteType;
  }) => Promise<void>;
} {
  const {
    podStore,
    viewportStore,
    repositoryStore,
    commandStore,
    trashZoneRef,
    handleOpenEditModal,
  } = options;

  const noteConfigs = [
    { store: repositoryStore as NoteStoreBase, type: "repository" as const },
    { store: commandStore as NoteStoreBase, type: "command" as const },
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

  const noteHandlerMap = Object.fromEntries(
    noteConfigs.map((config) => [
      config.type,
      useNoteEventHandlers({ store: config.store, trashZoneRef }),
    ]),
  ) as Record<NoteType, ReturnType<typeof useNoteEventHandlers>>;

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
  const handleCreateCommandNote = createNoteHandler(
    commandStore as NoteStoreBase,
  );

  const getRepositoryBranchName = (
    repositoryId: string,
  ): string | undefined => {
    // 改用 itemById Map（O(1) 查找），取代 Array.find 線性掃描
    const repository = repositoryStore.itemById.get(repositoryId);
    return repository?.currentBranch;
  };

  const { handleNoteDoubleClick } = useNoteDoubleClick(
    { commandStore },
    handleOpenEditModal,
  );

  return {
    noteHandlerMap,
    showTrashZone,
    isTrashHighlighted,
    isCanvasEmpty,
    handleCreateRepositoryNote,
    handleCreateCommandNote,
    getRepositoryBranchName,
    handleNoteDoubleClick,
  };
}
