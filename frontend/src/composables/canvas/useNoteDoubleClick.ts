import type { Ref } from "vue";
import type { useCommandStore, useMcpServerStore } from "@/stores/note";
import type { McpServerConfig } from "@/types";
import { useToast } from "@/composables/useToast";

type EditableNoteType = "command";
type NoteType = "repository" | "command" | "mcpServer";

interface McpServerModalState {
  visible: boolean;
  mode: "create" | "edit";
  mcpServerId: string;
  initialName: string;
  initialConfig: McpServerConfig | undefined;
}

interface UseNoteDoubleClickStores {
  commandStore: ReturnType<typeof useCommandStore>;
  mcpServerStore: ReturnType<typeof useMcpServerStore>;
}

export function useNoteDoubleClick(
  stores: UseNoteDoubleClickStores,
  mcpServerModal: Ref<McpServerModalState>,
  handleOpenEditModal: (
    type: EditableNoteType,
    id: string,
  ) => Promise<void> | void,
): {
  handleNoteDoubleClick: (data: {
    noteId: string;
    noteType: NoteType;
  }) => Promise<void>;
} {
  const { commandStore, mcpServerStore } = stores;
  const { showErrorToast } = useToast();

  const editableNoteResourceIdGetters: Record<
    EditableNoteType,
    (noteId: string) => string | undefined
  > = {
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

  return { handleNoteDoubleClick };
}
