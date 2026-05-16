import type { Ref } from "vue";
import type { UnbindBehavior } from "@/stores/note/noteBindingActions";

export type NoteType = "repository";

interface NoteItem {
  repositoryId?: string;
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
  repositoryStore: BaseBindableNoteStore & {
    unbindFromPod: (podId: string, behavior: UnbindBehavior) => Promise<void>;
  };
  podStore: {
    updatePodRepository: (podId: string, itemId: string | null) => void;
  };
}

interface UsePodNoteBindingReturn {
  handleNoteDrop: (noteType: NoteType, noteId: string) => Promise<void>;
  handleNoteRemove: (noteType: NoteType) => Promise<void>;
}

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
  const { repositoryStore, podStore } = stores;

  const noteStoreMap: Record<NoteType, NoteStoreMapping> = {
    repository: {
      bindToPod: (noteId, pid) => repositoryStore.bindToPod(noteId, pid),
      getNoteById: (noteId) => repositoryStore.getNoteById(noteId),
      unbindFromPod: (pid, behavior) =>
        repositoryStore.unbindFromPod(pid, behavior),
      getItemId: (note) => note.repositoryId,
      updatePodField: (pid, itemId) =>
        podStore.updatePodRepository(pid, itemId),
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

    if (isAlreadyBound(mapping, note, podId.value)) return;

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
