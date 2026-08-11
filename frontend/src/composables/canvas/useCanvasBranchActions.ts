import { ref, type Ref } from "vue";
import type { useConnectionStore } from "@/stores/connectionStore";

type ConnectionStore = ReturnType<typeof useConnectionStore>;

export interface BranchEditModalState {
  visible: boolean;
  connectionId: string;
  sourcePodId: string;
  isAlreadyBranch: boolean;
  initialLabel: string;
  initialDescription: string;
}

export interface ConnectionContextMenuRef {
  value: {
    data: {
      connectionId: string;
      triggerMode: "auto" | "branch" | "direct";
      label?: string;
      description?: string;
    };
  };
}

export interface CanvasBranchActions {
  branchEditModal: Ref<BranchEditModalState>;
  handleBranchModeClicked: () => void;
  handleBranchModalUpdateOpen: (open: boolean) => void;
  handleBranchModalSubmit: (payload: {
    label: string;
    description: string;
  }) => Promise<void>;
  handleBranchProviderChanged: () => void;
  handleBranchModelChanged: () => void;
}

export function useCanvasBranchActions(
  connectionStore: ConnectionStore,
  connectionContextMenu: ConnectionContextMenuRef,
): CanvasBranchActions {
  const branchEditModal = ref<BranchEditModalState>({
    visible: false,
    connectionId: "",
    sourcePodId: "",
    isAlreadyBranch: false,
    initialLabel: "",
    initialDescription: "",
  });

  const handleBranchModeClicked = (): void => {
    const data = connectionContextMenu.value.data;
    if (!data?.connectionId) return;

    const connection = connectionStore.connections.find(
      (item) => item.id === data.connectionId,
    );
    if (!connection?.sourcePodId) return;

    branchEditModal.value = {
      visible: true,
      connectionId: data.connectionId,
      sourcePodId: connection.sourcePodId,
      isAlreadyBranch: data.triggerMode === "branch",
      initialLabel: data.label ?? "",
      initialDescription: data.description ?? "",
    };
  };

  const handleBranchModalUpdateOpen = (open: boolean): void => {
    branchEditModal.value.visible = open;
  };

  const handleBranchModalSubmit = async (payload: {
    label: string;
    description: string;
  }): Promise<void> => {
    const { connectionId, sourcePodId, isAlreadyBranch } =
      branchEditModal.value;
    const result = await connectionStore.updateConnectionBranchSettings(
      connectionId,
      sourcePodId,
      {
        switchToBranch: !isAlreadyBranch,
        label: payload.label,
        description: payload.description,
      },
    );

    if (result) branchEditModal.value.visible = false;
  };

  const handleBranchProviderChanged = (): void => {};
  const handleBranchModelChanged = (): void => {};

  return {
    branchEditModal,
    handleBranchModeClicked,
    handleBranchModalUpdateOpen,
    handleBranchModalSubmit,
    handleBranchProviderChanged,
    handleBranchModelChanged,
  };
}
