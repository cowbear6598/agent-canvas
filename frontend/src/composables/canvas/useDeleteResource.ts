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
  typedAvailableItems: Array<{
    id: string;
    hasRepoMemory?: boolean;
  }>;
}

interface DeleteResourceStores {
  repositoryStore: DeletableStore & {
    deleteRepository: (id: string) => Promise<void>;
  };
}

export function useDeleteResource(stores: DeleteResourceStores): {
  showDeleteModal: Ref<boolean>;
  showDeleteMemoryModal: Ref<boolean>;
  deleteTarget: Ref<DeleteTarget | null>;
  isDeleteTargetInUse: ComputedRef<boolean>;
  hasDeleteTargetRepoMemory: ComputedRef<boolean>;
  handleOpenDeleteModal: (type: ItemType, id: string, name: string) => void;
  handleConfirmDelete: () => Promise<void>;
  handleConfirmDeleteWithMemory: () => Promise<void>;
  closeDeleteModal: () => void;
  closeDeleteMemoryModal: () => void;
} {
  const { repositoryStore } = stores;

  const showDeleteModal = ref(false);
  const showDeleteMemoryModal = ref(false);
  const deleteTarget = ref<DeleteTarget | null>(null);

  const isDeleteTargetInUse = computed((): boolean => {
    if (!deleteTarget.value) return false;

    const { type, id } = deleteTarget.value;

    const inUseChecks: Record<ItemType, () => boolean> = {
      repository: (): boolean => repositoryStore.isItemInUse(id),
    };

    return inUseChecks[type]();
  });

  const hasDeleteTargetRepoMemory = computed((): boolean => {
    if (!deleteTarget.value || deleteTarget.value.type !== "repository") {
      return false;
    }

    return (
      repositoryStore.typedAvailableItems.find(
        (item) => item.id === deleteTarget.value?.id,
      )?.hasRepoMemory === true
    );
  });

  function handleOpenDeleteModal(type: ItemType, id: string, name: string): void {
    deleteTarget.value = { type, id, name };
    showDeleteModal.value = true;
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!deleteTarget.value) return;

    if (isDeleteTargetInUse.value) {
      showDeleteModal.value = false;
      deleteTarget.value = null;
      return;
    }

    if (hasDeleteTargetRepoMemory.value) {
      showDeleteModal.value = false;
      showDeleteMemoryModal.value = true;
      return;
    }

    await handleConfirmDeleteWithMemory();
  }

  async function handleConfirmDeleteWithMemory(): Promise<void> {
    if (!deleteTarget.value) return;

    const { type, id } = deleteTarget.value;

    const deleteActions: Record<ItemType, () => Promise<void>> = {
      repository: (): Promise<void> => repositoryStore.deleteRepository(id),
    };

    await deleteActions[type]();

    showDeleteModal.value = false;
    showDeleteMemoryModal.value = false;
    deleteTarget.value = null;
  }

  function closeDeleteModal(): void {
    showDeleteModal.value = false;
    if (!showDeleteMemoryModal.value) {
      deleteTarget.value = null;
    }
  }

  function closeDeleteMemoryModal(): void {
    showDeleteMemoryModal.value = false;
    deleteTarget.value = null;
  }

  return {
    showDeleteModal,
    showDeleteMemoryModal,
    deleteTarget,
    isDeleteTargetInUse,
    hasDeleteTargetRepoMemory,
    handleOpenDeleteModal,
    handleConfirmDelete,
    handleConfirmDeleteWithMemory,
    closeDeleteModal,
    closeDeleteMemoryModal,
  };
}
