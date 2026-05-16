import { ref, computed } from "vue";
import type { Ref, ComputedRef } from "vue";

type ItemType = "repository";

interface DeleteTarget {
  type: ItemType;
  id: string;
  name: string;
}

interface DeletableStore {
  isItemInUse: (id: string) => boolean;
}

interface DeleteResourceStores {
  repositoryStore: DeletableStore & {
    deleteRepository: (id: string) => Promise<void>;
  };
}

export function useDeleteResource(stores: DeleteResourceStores): {
  showDeleteModal: Ref<boolean>;
  deleteTarget: Ref<DeleteTarget | null>;
  isDeleteTargetInUse: ComputedRef<boolean>;
  handleOpenDeleteModal: (type: ItemType, id: string, name: string) => void;
  handleConfirmDelete: () => Promise<void>;
  closeDeleteModal: () => void;
} {
  const { repositoryStore } = stores;

  const showDeleteModal = ref(false);
  const deleteTarget = ref<DeleteTarget | null>(null);

  const isDeleteTargetInUse = computed((): boolean => {
    if (!deleteTarget.value) return false;

    const { type, id } = deleteTarget.value;

    const inUseChecks: Record<ItemType, () => boolean> = {
      repository: (): boolean => repositoryStore.isItemInUse(id),
    };

    return inUseChecks[type]();
  });

  function handleOpenDeleteModal(type: ItemType, id: string, name: string): void {
    deleteTarget.value = { type, id, name };
    showDeleteModal.value = true;
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!deleteTarget.value) return;

    const { type, id } = deleteTarget.value;

    const deleteActions: Record<ItemType, () => Promise<void>> = {
      repository: (): Promise<void> => repositoryStore.deleteRepository(id),
    };

    await deleteActions[type]();

    showDeleteModal.value = false;
    deleteTarget.value = null;
  }

  function closeDeleteModal(): void {
    showDeleteModal.value = false;
    deleteTarget.value = null;
  }

  return {
    showDeleteModal,
    deleteTarget,
    isDeleteTargetInUse,
    handleOpenDeleteModal,
    handleConfirmDelete,
    closeDeleteModal,
  };
}
