import { ref, computed } from "vue";
import type { Ref, ComputedRef } from "vue";
import type { Group } from "@/types";

type ItemType = "skill" | "repository" | "subAgent" | "command" | "mcpServer";
type GroupType = "subAgentGroup" | "commandGroup";
type ExtendedItemType = ItemType | GroupType;

interface DeleteTarget {
  type: ExtendedItemType;
  id: string;
  name: string;
}

interface DeletableStore {
  isItemInUse: (id: string) => boolean;
}

interface DeleteResourceStores {
  skillStore: DeletableStore & {
    deleteSkill: (id: string) => Promise<void>;
  };
  subAgentStore: DeletableStore & {
    deleteSubAgent: (id: string) => Promise<void>;
    deleteGroup: (id: string) => Promise<{ success: boolean; error?: string }>;
  };
  repositoryStore: DeletableStore & {
    deleteRepository: (id: string) => Promise<void>;
  };
  commandStore: DeletableStore & {
    deleteCommand: (id: string) => Promise<void>;
    deleteGroup: (id: string) => Promise<{ success: boolean; error?: string }>;
  };
  mcpServerStore: DeletableStore & {
    deleteMcpServer: (id: string) => Promise<void>;
  };
}

export function useDeleteResource(stores: DeleteResourceStores): {
  showDeleteModal: Ref<boolean>;
  deleteTarget: Ref<DeleteTarget | null>;
  isDeleteTargetInUse: ComputedRef<boolean>;
  handleOpenDeleteModal: (
    type: ExtendedItemType,
    id: string,
    name: string,
  ) => void;
  handleOpenDeleteGroupModal: (
    groupType: GroupType,
    groupId: string,
    name: string,
  ) => void;
  handleConfirmDelete: () => Promise<void>;
  closeDeleteModal: () => void;
} {
  const {
    skillStore,
    subAgentStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
  } = stores;

  const showDeleteModal = ref(false);
  const deleteTarget = ref<DeleteTarget | null>(null);

  const isDeleteTargetInUse = computed((): boolean => {
    if (!deleteTarget.value) return false;

    const { type, id } = deleteTarget.value;

    const inUseChecks: Record<ExtendedItemType, () => boolean> = {
      skill: (): boolean => skillStore.isItemInUse(id),
      subAgent: (): boolean => subAgentStore.isItemInUse(id),
      repository: (): boolean => repositoryStore.isItemInUse(id),
      command: (): boolean => commandStore.isItemInUse(id),
      mcpServer: (): boolean => mcpServerStore.isItemInUse(id),
      subAgentGroup: (): boolean => false,
      commandGroup: (): boolean => false,
    };

    return inUseChecks[type]();
  });

  function handleOpenDeleteModal(
    type: ExtendedItemType,
    id: string,
    name: string,
  ): void {
    deleteTarget.value = { type, id, name };
    showDeleteModal.value = true;
  }

  function handleOpenDeleteGroupModal(
    groupType: GroupType,
    groupId: string,
    name: string,
  ): void {
    deleteTarget.value = { type: groupType, id: groupId, name };
    showDeleteModal.value = true;
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!deleteTarget.value) return;

    const { type, id } = deleteTarget.value;

    const deleteActions: Record<
      ExtendedItemType,
      () => Promise<void | { success: boolean; group?: Group; error?: string }>
    > = {
      skill: (): Promise<void> => skillStore.deleteSkill(id),
      subAgent: (): Promise<void> => subAgentStore.deleteSubAgent(id),
      repository: (): Promise<void> => repositoryStore.deleteRepository(id),
      command: (): Promise<void> => commandStore.deleteCommand(id),
      mcpServer: (): Promise<void> => mcpServerStore.deleteMcpServer(id),
      subAgentGroup: () => subAgentStore.deleteGroup(id),
      commandGroup: () => commandStore.deleteGroup(id),
    };

    const result = await deleteActions[type]();

    if (result && typeof result === "object" && !result.success) {
      console.error("刪除失敗:", result.error);
      return;
    }

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
    handleOpenDeleteGroupModal,
    handleConfirmDelete,
    closeDeleteModal,
  };
}
