import { ref } from "vue";
import type { Ref } from "vue";
import type { Composer } from "vue-i18n";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import { useIntegrationStore } from "@/stores/integrationStore";
import { useRepositoryMemoryCoordinator } from "@/composables/canvas/useRepositoryMemoryCoordinator";
import type { Position } from "@/types";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import type { usePodStore } from "@/stores/pod/podStore";
import type { useViewportStore } from "@/stores/pod/viewportStore";
import type { useConnectionStore } from "@/stores/connectionStore";
import type { useRepositoryStore } from "@/stores/note/repositoryStore";

type PodStore = ReturnType<typeof usePodStore>;
type ViewportStore = ReturnType<typeof useViewportStore>;
type ConnectionStore = ReturnType<typeof useConnectionStore>;
type RepositoryStore = ReturnType<typeof useRepositoryStore>;

export interface BranchEditModalState {
  visible: boolean;
  connectionId: string;
  sourcePodId: string;
  isAlreadyBranch: boolean;
  initialLabel: string;
  initialDescription: string;
}

interface UseCanvasResourceActionControllerOptions {
  podStore: PodStore;
  viewportStore: ViewportStore;
  repositoryStore: RepositoryStore;
  connectionStore: ConnectionStore;
  connectionContextMenu: {
    value: {
      data: {
        connectionId: string;
        triggerMode: "auto" | "branch" | "direct";
        label?: string;
        description?: string;
      };
    };
  };
  t: Composer["t"];
  lastMenuPosition: Ref<Position | null>;
}

export function useCanvasResourceActionController(
  options: UseCanvasResourceActionControllerOptions,
): {
  showCreateRepositoryModal: Ref<boolean>;
  showCloneRepositoryModal: Ref<boolean>;
  podMemoryConfirmModal: Ref<{
    visible: boolean;
    podId: string;
    podName: string;
  }>;
  repoMemoryConfirmModal: Ref<{
    visible: boolean;
    repositoryId: string;
    repositoryName: string;
  }>;
  memoryViewerModal: Ref<{
    visible: boolean;
    title: string;
    summary: string | null;
    summaryUpdatedAt: string | null;
    emptyMessage: string;
  }>;
  integrationConnectModal: Ref<{
    visible: boolean;
    podId: string;
    provider: string;
  }>;
  branchEditModal: Ref<BranchEditModalState>;
  handleConnectIntegration: (podId: string, provider: string) => void;
  handleDisconnectIntegration: (
    podId: string,
    provider: string,
  ) => Promise<void>;
  handleSwitchPodProvider: (
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ) => Promise<void>;
  handleSetPodMemoryEnabled: (
    podId: string,
    memoryEnabled: boolean,
  ) => Promise<void>;
  handleSetRepoMemoryEnabled: (
    repositoryId: string,
    memoryEnabled: boolean,
  ) => Promise<void>;
  handleClearPodMemory: (podId: string) => Promise<void>;
  handleViewPodMemory: (podId: string) => Promise<void>;
  handleViewRepoMemory: (repositoryId: string) => Promise<void>;
  handleMemoryViewerModalOpenChange: (open: boolean) => void;
  handlePodMemoryConfirmModalOpenChange: (open: boolean) => void;
  handleConfirmClearPodMemory: () => Promise<void>;
  handleClearRepoMemory: (repositoryId: string) => void;
  handleRepoMemoryConfirmModalOpenChange: (open: boolean) => void;
  handleConfirmClearRepoMemory: () => Promise<void>;
  handleOpenCreateRepositoryModal: () => void;
  handleOpenCloneRepositoryModal: () => void;
  handleRepositoryCreated: (repository: { id: string; name: string }) => void;
  handleBranchModeClicked: () => void;
  handleBranchModalUpdateOpen: (open: boolean) => void;
  handleBranchModalSubmit: (payload: {
    label: string;
    description: string;
  }) => Promise<void>;
  handleBranchProviderChanged: () => void;
  handleBranchModelChanged: () => void;
  setIntegrationConnectModalOpen: (open: boolean) => void;
} {
  const repositoryMemoryCoordinator = useRepositoryMemoryCoordinator();
  const integrationStore = useIntegrationStore();

  const showCreateRepositoryModal = ref(false);
  const showCloneRepositoryModal = ref(false);
  const podMemoryConfirmModal = ref({
    visible: false,
    podId: "",
    podName: "",
  });
  const repoMemoryConfirmModal = ref({
    visible: false,
    repositoryId: "",
    repositoryName: "",
  });
  const memoryViewerModal = ref({
    visible: false,
    title: "",
    summary: null as string | null,
    summaryUpdatedAt: null as string | null,
    emptyMessage: "",
  });
  const integrationConnectModal = ref({
    visible: false,
    podId: "",
    provider: "",
  });
  const branchEditModal = ref<BranchEditModalState>({
    visible: false,
    connectionId: "",
    sourcePodId: "",
    isAlreadyBranch: false,
    initialLabel: "",
    initialDescription: "",
  });

  const handleConnectIntegration = (podId: string, provider: string): void => {
    integrationConnectModal.value = { visible: true, podId, provider };
  };

  const handleDisconnectIntegration = async (
    podId: string,
    provider: string,
  ): Promise<void> => {
    await integrationStore.unbindFromPod(provider, podId);
  };

  const handleSwitchPodProvider = async (
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ): Promise<void> => {
    await options.podStore.updatePodProvider(podId, provider, providerConfig);
  };

  const handleSetPodMemoryEnabled = async (
    podId: string,
    memoryEnabled: boolean,
  ): Promise<void> => {
    await options.podStore.setPodMemoryEnabledWithBackend(podId, memoryEnabled);
  };

  const handleSetRepoMemoryEnabled = async (
    repositoryId: string,
    memoryEnabled: boolean,
  ): Promise<void> => {
    await repositoryMemoryCoordinator.setRepoMemoryEnabled(
      repositoryId,
      memoryEnabled,
    );
  };

  const handleClearPodMemory = async (podId: string): Promise<void> => {
    const pod = options.podStore.getPodById(podId);
    if (!pod) return;

    podMemoryConfirmModal.value = {
      visible: true,
      podId,
      podName: pod.name,
    };
  };

  const handleViewPodMemory = async (podId: string): Promise<void> => {
    const pod = options.podStore.getPodById(podId);
    if (!pod) return;

    const result = await options.podStore.getPodMemory(podId);
    if (!result.success) return;

    memoryViewerModal.value = {
      visible: true,
      title: `${pod.name} · ${options.t("canvas.memoryViewer.podTitle")}`,
      summary: result.summary ?? null,
      summaryUpdatedAt: result.summaryUpdatedAt ?? null,
      emptyMessage: options.t("canvas.memoryViewer.emptyPod"),
    };
  };

  const handleViewRepoMemory = async (
    repositoryId: string,
  ): Promise<void> => {
    const repository = options.repositoryStore.typedAvailableItems.find(
      (item) => item.id === repositoryId,
    );
    if (!repository) return;

    const result = await repositoryMemoryCoordinator.getRepoMemory(repositoryId);
    if (!result.success) return;

    memoryViewerModal.value = {
      visible: true,
      title: `${repository.name} · ${options.t("canvas.memoryViewer.repoTitle")}`,
      summary: result.summary ?? null,
      summaryUpdatedAt: result.summaryUpdatedAt ?? null,
      emptyMessage: options.t("canvas.memoryViewer.emptyRepo"),
    };
  };

  const handleMemoryViewerModalOpenChange = (open: boolean): void => {
    if (open) {
      memoryViewerModal.value.visible = true;
      return;
    }

    memoryViewerModal.value = {
      visible: false,
      title: "",
      summary: null,
      summaryUpdatedAt: null,
      emptyMessage: "",
    };
  };

  const handlePodMemoryConfirmModalOpenChange = (open: boolean): void => {
    if (open) {
      podMemoryConfirmModal.value.visible = true;
      return;
    }

    podMemoryConfirmModal.value = {
      visible: false,
      podId: "",
      podName: "",
    };
  };

  const handleConfirmClearPodMemory = async (): Promise<void> => {
    const podId = podMemoryConfirmModal.value.podId;
    if (!podId) return;

    await options.podStore.clearPodMemoryWithBackend(podId);
    handlePodMemoryConfirmModalOpenChange(false);
  };

  const handleClearRepoMemory = (repositoryId: string): void => {
    const repository = options.repositoryStore.typedAvailableItems.find(
      (item) => item.id === repositoryId,
    );
    if (!repository) return;

    repoMemoryConfirmModal.value = {
      visible: true,
      repositoryId,
      repositoryName: repository.name,
    };
  };

  const handleRepoMemoryConfirmModalOpenChange = (open: boolean): void => {
    if (open) {
      repoMemoryConfirmModal.value.visible = true;
      return;
    }

    repoMemoryConfirmModal.value = {
      visible: false,
      repositoryId: "",
      repositoryName: "",
    };
  };

  const handleConfirmClearRepoMemory = async (): Promise<void> => {
    const repositoryId = repoMemoryConfirmModal.value.repositoryId;
    if (!repositoryId) return;

    await repositoryMemoryCoordinator.clearRepoMemory(repositoryId);
    handleRepoMemoryConfirmModalOpenChange(false);
  };

  const handleOpenCreateRepositoryModal = (): void => {
    showCreateRepositoryModal.value = true;
  };

  const handleOpenCloneRepositoryModal = (): void => {
    showCloneRepositoryModal.value = true;
  };

  const handleRepositoryCreated = (repository: {
    id: string;
    name: string;
  }): void => {
    const position = options.lastMenuPosition.value;
    if (!position) return;

    const { x, y } = screenToCanvasPosition(position, options.viewportStore);
    options.repositoryStore.createNote(repository.id, x, y);
  };

  const handleBranchModeClicked = (): void => {
    const data = options.connectionContextMenu.value.data;
    if (!data?.connectionId) return;

    const connection = options.connectionStore.connections.find(
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

    const result = await options.connectionStore.updateConnectionBranchSettings(
      connectionId,
      sourcePodId,
      {
        switchToBranch: !isAlreadyBranch,
        label: payload.label,
        description: payload.description,
      },
    );

    if (result) {
      branchEditModal.value.visible = false;
    }
  };

  const handleBranchProviderChanged = (): void => {};
  const handleBranchModelChanged = (): void => {};

  const setIntegrationConnectModalOpen = (open: boolean): void => {
    integrationConnectModal.value.visible = open;
  };

  return {
    showCreateRepositoryModal,
    showCloneRepositoryModal,
    podMemoryConfirmModal,
    repoMemoryConfirmModal,
    memoryViewerModal,
    integrationConnectModal,
    branchEditModal,
    handleConnectIntegration,
    handleDisconnectIntegration,
    handleSwitchPodProvider,
    handleSetPodMemoryEnabled,
    handleSetRepoMemoryEnabled,
    handleClearPodMemory,
    handleViewPodMemory,
    handleViewRepoMemory,
    handleMemoryViewerModalOpenChange,
    handlePodMemoryConfirmModalOpenChange,
    handleConfirmClearPodMemory,
    handleClearRepoMemory,
    handleRepoMemoryConfirmModalOpenChange,
    handleConfirmClearRepoMemory,
    handleOpenCreateRepositoryModal,
    handleOpenCloneRepositoryModal,
    handleRepositoryCreated,
    handleBranchModeClicked,
    handleBranchModalUpdateOpen,
    handleBranchModalSubmit,
    handleBranchProviderChanged,
    handleBranchModelChanged,
    setIntegrationConnectModalOpen,
  };
}
