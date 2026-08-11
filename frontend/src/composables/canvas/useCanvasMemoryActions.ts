import { ref, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import { useRepositoryMemoryCoordinator } from "@/composables/canvas/useRepositoryMemoryCoordinator";
import type { usePodStore } from "@/stores/pod/podStore";
import type { useRepositoryStore } from "@/stores/note/repositoryStore";
import type { Repository } from "@/types/repository";

type PodStore = ReturnType<typeof usePodStore>;
type RepositoryStore = ReturnType<typeof useRepositoryStore>;
type RepositoryMemoryCoordinator = ReturnType<
  typeof useRepositoryMemoryCoordinator
>;

interface PodMemoryConfirmModalState {
  visible: boolean;
  podId: string;
  podName: string;
}

interface RepoMemoryConfirmModalState {
  visible: boolean;
  repositoryId: string;
  repositoryName: string;
}

interface MemoryViewerModalState {
  visible: boolean;
  title: string;
  summary: string | null;
  summaryUpdatedAt: string | null;
  emptyMessage: string;
}

interface UseCanvasMemoryActionsOptions {
  podStore: PodStore;
  repositoryStore: RepositoryStore;
  t: Composer["t"];
}

export interface CanvasMemoryActions {
  podMemoryConfirmModal: Ref<PodMemoryConfirmModalState>;
  repoMemoryConfirmModal: Ref<RepoMemoryConfirmModalState>;
  memoryViewerModal: Ref<MemoryViewerModalState>;
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
}

type PodMemoryActions = Pick<
  CanvasMemoryActions,
  | "handleSetPodMemoryEnabled"
  | "handleClearPodMemory"
  | "handleViewPodMemory"
  | "handlePodMemoryConfirmModalOpenChange"
  | "handleConfirmClearPodMemory"
>;

type RepositoryMemoryActions = Pick<
  CanvasMemoryActions,
  | "handleSetRepoMemoryEnabled"
  | "handleViewRepoMemory"
  | "handleClearRepoMemory"
  | "handleRepoMemoryConfirmModalOpenChange"
  | "handleConfirmClearRepoMemory"
>;

function createPodMemoryActions(
  options: UseCanvasMemoryActionsOptions,
  confirmModal: Ref<PodMemoryConfirmModalState>,
  viewerModal: Ref<MemoryViewerModalState>,
): PodMemoryActions {
  const handlePodMemoryConfirmModalOpenChange = (open: boolean): void => {
    confirmModal.value = open
      ? { ...confirmModal.value, visible: true }
      : { visible: false, podId: "", podName: "" };
  };
  const handleSetPodMemoryEnabled = async (
    podId: string,
    memoryEnabled: boolean,
  ): Promise<void> => {
    await options.podStore.setPodMemoryEnabledWithBackend(podId, memoryEnabled);
  };
  const handleClearPodMemory = async (podId: string): Promise<void> => {
    const pod = options.podStore.getPodById(podId);
    if (!pod) return;
    confirmModal.value = { visible: true, podId, podName: pod.name };
  };
  const handleViewPodMemory = async (podId: string): Promise<void> => {
    const pod = options.podStore.getPodById(podId);
    if (!pod) return;

    const result = await options.podStore.getPodMemory(podId);
    if (!result.success) return;
    viewerModal.value = {
      visible: true,
      title: `${pod.name} · ${options.t("canvas.memoryViewer.podTitle")}`,
      summary: result.summary ?? null,
      summaryUpdatedAt: result.summaryUpdatedAt ?? null,
      emptyMessage: options.t("canvas.memoryViewer.emptyPod"),
    };
  };
  const handleConfirmClearPodMemory = async (): Promise<void> => {
    const podId = confirmModal.value.podId;
    if (!podId) return;
    await options.podStore.clearPodMemoryWithBackend(podId);
    handlePodMemoryConfirmModalOpenChange(false);
  };

  return {
    handleSetPodMemoryEnabled,
    handleClearPodMemory,
    handleViewPodMemory,
    handlePodMemoryConfirmModalOpenChange,
    handleConfirmClearPodMemory,
  };
}

function createRepositoryMemoryActions(
  options: UseCanvasMemoryActionsOptions,
  coordinator: RepositoryMemoryCoordinator,
  confirmModal: Ref<RepoMemoryConfirmModalState>,
  viewerModal: Ref<MemoryViewerModalState>,
): RepositoryMemoryActions {
  const findRepository = (repositoryId: string): Repository | undefined =>
    options.repositoryStore.typedAvailableItems.find(
      (item) => item.id === repositoryId,
    );
  const handleRepoMemoryConfirmModalOpenChange = (open: boolean): void => {
    confirmModal.value = open
      ? { ...confirmModal.value, visible: true }
      : { visible: false, repositoryId: "", repositoryName: "" };
  };
  const handleSetRepoMemoryEnabled = async (
    repositoryId: string,
    memoryEnabled: boolean,
  ): Promise<void> => {
    await coordinator.setRepoMemoryEnabled(repositoryId, memoryEnabled);
  };
  const handleViewRepoMemory = async (
    repositoryId: string,
  ): Promise<void> => {
    const repository = findRepository(repositoryId);
    if (!repository) return;

    const result = await coordinator.getRepoMemory(repositoryId);
    if (!result.success) return;
    viewerModal.value = {
      visible: true,
      title: `${repository.name} · ${options.t("canvas.memoryViewer.repoTitle")}`,
      summary: result.summary ?? null,
      summaryUpdatedAt: result.summaryUpdatedAt ?? null,
      emptyMessage: options.t("canvas.memoryViewer.emptyRepo"),
    };
  };
  const handleClearRepoMemory = (repositoryId: string): void => {
    const repository = findRepository(repositoryId);
    if (!repository) return;
    confirmModal.value = {
      visible: true,
      repositoryId,
      repositoryName: repository.name,
    };
  };
  const handleConfirmClearRepoMemory = async (): Promise<void> => {
    const repositoryId = confirmModal.value.repositoryId;
    if (!repositoryId) return;
    await coordinator.clearRepoMemory(repositoryId);
    handleRepoMemoryConfirmModalOpenChange(false);
  };

  return {
    handleSetRepoMemoryEnabled,
    handleViewRepoMemory,
    handleClearRepoMemory,
    handleRepoMemoryConfirmModalOpenChange,
    handleConfirmClearRepoMemory,
  };
}

export function useCanvasMemoryActions(
  options: UseCanvasMemoryActionsOptions,
): CanvasMemoryActions {
  const podMemoryConfirmModal = ref<PodMemoryConfirmModalState>({
    visible: false,
    podId: "",
    podName: "",
  });
  const repoMemoryConfirmModal = ref<RepoMemoryConfirmModalState>({
    visible: false,
    repositoryId: "",
    repositoryName: "",
  });
  const memoryViewerModal = ref<MemoryViewerModalState>({
    visible: false,
    title: "",
    summary: null,
    summaryUpdatedAt: null,
    emptyMessage: "",
  });
  const handleMemoryViewerModalOpenChange = (open: boolean): void => {
    memoryViewerModal.value = open
      ? { ...memoryViewerModal.value, visible: true }
      : {
          visible: false,
          title: "",
          summary: null,
          summaryUpdatedAt: null,
          emptyMessage: "",
        };
  };

  return {
    podMemoryConfirmModal,
    repoMemoryConfirmModal,
    memoryViewerModal,
    handleMemoryViewerModalOpenChange,
    ...createPodMemoryActions(
      options,
      podMemoryConfirmModal,
      memoryViewerModal,
    ),
    ...createRepositoryMemoryActions(
      options,
      useRepositoryMemoryCoordinator(),
      repoMemoryConfirmModal,
      memoryViewerModal,
    ),
  };
}
