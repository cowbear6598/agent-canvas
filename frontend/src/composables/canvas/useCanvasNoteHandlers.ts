import { computed } from "vue";
import type { ComputedRef, Ref } from "vue";
import { useNoteEventHandlers } from "@/composables/canvas/useNoteEventHandlers";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import type { usePodStore } from "@/stores/pod";
import type { useViewportStore } from "@/stores/pod";
import type {
  useOutputStyleStore,
  useSkillStore,
  useSubAgentStore,
  useRepositoryStore,
  useCommandStore,
  useMcpServerStore,
} from "@/stores/note";
import TrashZone from "@/components/canvas/TrashZone.vue";
import type { McpServerConfig } from "@/types";
import { useToast } from "@/composables/useToast";

type EditableNoteType = "outputStyle" | "subAgent" | "command";

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
  outputStyleStore: ReturnType<typeof useOutputStyleStore>;
  skillStore: ReturnType<typeof useSkillStore>;
  subAgentStore: ReturnType<typeof useSubAgentStore>;
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

type NoteType =
  | "outputStyle"
  | "skill"
  | "subAgent"
  | "repository"
  | "command"
  | "mcpServer";

export function useCanvasNoteHandlers(options: UseCanvasNoteHandlersOptions): {
  noteHandlerMap: Record<NoteType, ReturnType<typeof useNoteEventHandlers>>;
  showTrashZone: ComputedRef<boolean>;
  isTrashHighlighted: ComputedRef<boolean>;
  isCanvasEmpty: ComputedRef<boolean>;
  handleCreateOutputStyleNote: (itemId: string) => void;
  handleCreateSkillNote: (itemId: string) => void;
  handleCreateSubAgentNote: (itemId: string) => void;
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
    outputStyleStore,
    skillStore,
    subAgentStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
    trashZoneRef,
    handleOpenEditModal,
    mcpServerModal,
  } = options;

  const { showErrorToast } = useToast();

  const noteConfigs = [
    { store: outputStyleStore as NoteStoreBase, type: "outputStyle" as const },
    { store: skillStore as NoteStoreBase, type: "skill" as const },
    { store: subAgentStore as NoteStoreBase, type: "subAgent" as const },
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

  const handleCreateOutputStyleNote = createNoteHandler(
    outputStyleStore as NoteStoreBase,
  );
  const handleCreateSkillNote = createNoteHandler(skillStore as NoteStoreBase);
  const handleCreateSubAgentNote = createNoteHandler(
    subAgentStore as NoteStoreBase,
  );
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

  const editableNoteResourceIdGetters: Record<
    EditableNoteType,
    (noteId: string) => string | undefined
  > = {
    outputStyle: (noteId) =>
      outputStyleStore.typedNotes.find((note) => note.id === noteId)
        ?.outputStyleId,
    subAgent: (noteId) =>
      subAgentStore.typedNotes.find((note) => note.id === noteId)?.subAgentId,
    command: (noteId) =>
      commandStore.typedNotes.find((note) => note.id === noteId)?.commandId,
  };

  const handleMcpServerDoubleClick = async (noteId: string): Promise<void> => {
    const note = mcpServerStore.typedNotes.find((n) => n.id === noteId);
    if (!note) return;

    const mcpServerId = note.mcpServerId;
    const mcpServerData = await mcpServerStore.readMcpServer(mcpServerId);

    if (!mcpServerData) {
      showErrorToast("McpServer", "讀取 MCP Server 失敗");
      return;
    }

    mcpServerModal.value = {
      visible: true,
      mode: "edit",
      mcpServerId,
      initialName: mcpServerData.name,
      initialConfig: mcpServerData.config,
    };
  };

  const handleNoteDoubleClick = async (data: {
    noteId: string;
    noteType: NoteType;
  }): Promise<void> => {
    const { noteId, noteType } = data;

    if (noteType === "mcpServer") {
      await handleMcpServerDoubleClick(noteId);
      return;
    }

    const getResourceId =
      editableNoteResourceIdGetters[noteType as EditableNoteType];
    if (!getResourceId) return;

    const resourceId = getResourceId(noteId);

    if (resourceId) {
      await handleOpenEditModal(noteType as EditableNoteType, resourceId);
    } else {
      if (import.meta.env.DEV) {
        console.error(
          `無法找到 Note (id: ${noteId}, type: ${noteType}) 的資源 ID`,
        );
      }
    }
  };

  return {
    noteHandlerMap,
    showTrashZone,
    isTrashHighlighted,
    isCanvasEmpty,
    handleCreateOutputStyleNote,
    handleCreateSkillNote,
    handleCreateSubAgentNote,
    handleCreateRepositoryNote,
    handleCreateCommandNote,
    handleCreateMcpServerNote,
    getRepositoryBranchName,
    handleNoteDoubleClick,
  };
}
