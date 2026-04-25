import type { Ref } from "vue";
import { useToast } from "@/composables/useToast";
import { DEFAULT_TOAST_DURATION_MS } from "@/lib/constants";
import { t } from "@/i18n";
import type { UnbindBehavior } from "@/stores/note/noteBindingActions";

export type NoteType = "subAgent" | "repository" | "command" | "mcpServer";

interface NoteItem {
  subAgentId?: string;
  repositoryId?: string;
  commandId?: string;
  mcpServerId?: string;
}

export interface BaseBindableNoteStore {
  bindToPod: (noteId: string, podId: string) => Promise<void>;
  getNoteById: (noteId: string) => NoteItem | undefined;
}

interface NoteStoreMapping {
  bindToPod: (noteId: string, podId: string) => Promise<void>;
  getNoteById: (noteId: string) => NoteItem | undefined;
  isItemBoundToPod?: (itemId: string, podId: string) => boolean;
  unbindFromPod?: (podId: string, behavior: UnbindBehavior) => Promise<void>;
  getItemId: (note: NoteItem) => string | undefined;
  updatePodField?: (podId: string, itemId: string | null) => void;
}

interface NoteStores {
  subAgentStore: BaseBindableNoteStore & {
    isItemBoundToPod: (itemId: string, podId: string) => boolean;
  };
  repositoryStore: BaseBindableNoteStore & {
    unbindFromPod: (podId: string, behavior: UnbindBehavior) => Promise<void>;
  };
  commandStore: BaseBindableNoteStore & {
    unbindFromPod: (podId: string, behavior: UnbindBehavior) => Promise<void>;
  };
  mcpServerStore: BaseBindableNoteStore & {
    isItemBoundToPod: (itemId: string, podId: string) => boolean;
  };
  podStore: {
    updatePodRepository: (podId: string, itemId: string | null) => void;
    updatePodCommand: (podId: string, itemId: string | null) => void;
  };
}

interface UsePodNoteBindingReturn {
  handleNoteDrop: (noteType: NoteType, noteId: string) => Promise<void>;
  handleNoteRemove: (noteType: NoteType) => Promise<void>;
}

const DUPLICATE_BIND_MESSAGES: Partial<Record<NoteType, () => string>> = {
  subAgent: () => t("pod.slot.subAgentDuplicate"),
  mcpServer: () => t("pod.slot.mcpServerDuplicate"),
};

const isAlreadyBound = (
  mapping: NoteStoreMapping,
  note: NoteItem,
  podId: string,
): boolean => {
  if (!mapping.isItemBoundToPod) return false;
  const itemId = mapping.getItemId(note);
  return (
    itemId !== undefined &&
    itemId !== null &&
    mapping.isItemBoundToPod(itemId, podId)
  );
};

export function usePodNoteBinding(
  podId: Ref<string>,
  stores: NoteStores,
): UsePodNoteBindingReturn {
  const { toast } = useToast();
  const {
    subAgentStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
    podStore,
  } = stores;

  const noteStoreMap: Record<NoteType, NoteStoreMapping> = {
    subAgent: {
      bindToPod: (noteId, pid) => subAgentStore.bindToPod(noteId, pid),
      getNoteById: (noteId) => subAgentStore.getNoteById(noteId),
      isItemBoundToPod: (itemId, pid) =>
        subAgentStore.isItemBoundToPod(itemId, pid),
      getItemId: (note) => note.subAgentId,
    },
    repository: {
      bindToPod: (noteId, pid) => repositoryStore.bindToPod(noteId, pid),
      getNoteById: (noteId) => repositoryStore.getNoteById(noteId),
      unbindFromPod: (pid, behavior) =>
        repositoryStore.unbindFromPod(pid, behavior),
      getItemId: (note) => note.repositoryId,
      updatePodField: (pid, itemId) =>
        podStore.updatePodRepository(pid, itemId),
    },
    command: {
      bindToPod: (noteId, pid) => commandStore.bindToPod(noteId, pid),
      getNoteById: (noteId) => commandStore.getNoteById(noteId),
      unbindFromPod: (pid, behavior) =>
        commandStore.unbindFromPod(pid, behavior),
      getItemId: (note) => note.commandId,
      updatePodField: (pid, itemId) => podStore.updatePodCommand(pid, itemId),
    },
    mcpServer: {
      bindToPod: (noteId, pid) => mcpServerStore.bindToPod(noteId, pid),
      getNoteById: (noteId) => mcpServerStore.getNoteById(noteId),
      isItemBoundToPod: (itemId, pid) =>
        mcpServerStore.isItemBoundToPod(itemId, pid),
      getItemId: (note) => note.mcpServerId,
    },
  };

  const handleNoteDrop = async (
    noteType: NoteType,
    noteId: string,
  ): Promise<void> => {
    // 空值守門：空字串、undefined、null 皆視為無效，不進入綁定流程
    if (!noteId) return;
    const mapping = noteStoreMap[noteType];
    const note = mapping.getNoteById(noteId);
    if (!note) return;

    if (isAlreadyBound(mapping, note, podId.value)) {
      const descFn = DUPLICATE_BIND_MESSAGES[noteType];
      if (descFn) {
        toast({
          title: t("pod.slot.duplicateTitle"),
          description: descFn(),
          duration: DEFAULT_TOAST_DURATION_MS,
        });
      }
      return;
    }

    await mapping.bindToPod(noteId, podId.value);

    if (mapping.updatePodField) {
      const itemId = mapping.getItemId(note);
      mapping.updatePodField(podId.value, itemId ?? null);
    }
  };

  const handleNoteRemove = async (noteType: NoteType): Promise<void> => {
    const mapping = noteStoreMap[noteType];
    if (!mapping.unbindFromPod) return;

    await mapping.unbindFromPod(podId.value, { mode: "return-to-original" });

    if (mapping.updatePodField) {
      mapping.updatePodField(podId.value, null);
    }
  };

  return {
    handleNoteDrop,
    handleNoteRemove,
  };
}
