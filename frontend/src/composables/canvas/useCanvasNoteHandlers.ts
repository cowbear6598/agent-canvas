import { computed } from "vue";
import type { ComputedRef, Ref } from "vue";
import { useNoteEventHandlers } from "@/composables/canvas/useNoteEventHandlers";
import { useNoteDoubleClick } from "@/composables/canvas/useNoteDoubleClick";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import type { usePodStore } from "@/stores/pod";
import type { useViewportStore } from "@/stores/pod";
import type {
  useRepositoryStore,
  useCommandStore,
  useMcpServerStore,
} from "@/stores/note";
import TrashZone from "@/components/canvas/TrashZone.vue";
import type { McpServerConfig } from "@/types";

// EditableNoteType 供 UseCanvasNoteHandlersOptions.handleOpenEditModal 型別引用
type EditableNoteType = "command";

interface McpServerModalState {
  visible: boolean;
  mode: "create" | "edit";
  mcpServerId: string;
  initialName: string;
  initialConfig: McpServerConfig | undefined;
}

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
  mcpServerStore: ReturnType<typeof useMcpServerStore>;
  trashZoneRef: Ref<InstanceType<typeof TrashZone> | null>;
  handleOpenEditModal: (
    type: EditableNoteType,
    id: string,
  ) => Promise<void> | void;
  mcpServerModal: Ref<McpServerModalState>;
}

type NoteType = "repository" | "command" | "mcpServer";

export function useCanvasNoteHandlers(options: UseCanvasNoteHandlersOptions): {
  noteHandlerMap: Record<NoteType, ReturnType<typeof useNoteEventHandlers>>;
  showTrashZone: ComputedRef<boolean>;
  isTrashHighlighted: ComputedRef<boolean>;
  isCanvasEmpty: ComputedRef<boolean>;
  handleCreateRepositoryNote: (itemId: string) => void;
  handleCreateCommandNote: (itemId: string) => void;
  handleCreateMcpServerNote: (itemId: string) => void;
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
    mcpServerStore,
    trashZoneRef,
    handleOpenEditModal,
    mcpServerModal,
  } = options;

  const noteConfigs = [
    { store: repositoryStore as NoteStoreBase, type: "repository" as const },
    { store: commandStore as NoteStoreBase, type: "command" as const },
    { store: mcpServerStore as NoteStoreBase, type: "mcpServer" as const },
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
  const handleCreateMcpServerNote = createNoteHandler(
    mcpServerStore as NoteStoreBase,
  );

  const getRepositoryBranchName = (
    repositoryId: string,
  ): string | undefined => {
    const repository = repositoryStore.typedAvailableItems.find(
      (r) => r.id === repositoryId,
    );
    return repository?.currentBranch ?? repository?.branchName;
  };

  const { handleNoteDoubleClick } = useNoteDoubleClick(
    { commandStore, mcpServerStore },
    mcpServerModal,
    handleOpenEditModal,
  );

  return {
    noteHandlerMap,
    showTrashZone,
    isTrashHighlighted,
    isCanvasEmpty,
    handleCreateRepositoryNote,
    handleCreateCommandNote,
    handleCreateMcpServerNote,
    getRepositoryBranchName,
    handleNoteDoubleClick,
  };
}
