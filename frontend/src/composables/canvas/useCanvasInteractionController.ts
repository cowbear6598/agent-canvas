import { ref } from "vue";
import type { Ref } from "vue";
import { isCtrlOrCmdPressed } from "@/utils/keyboardHelpers";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import {
  POD_MENU_X_OFFSET,
  POD_MENU_Y_OFFSET,
  DEFAULT_POD_ROTATION_RANGE,
} from "@/lib/constants";
import type { Pod, PodTypeConfig, Position } from "@/types";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import type { usePodStore } from "@/stores/pod/podStore";
import type { useViewportStore } from "@/stores/pod/viewportStore";
import type { useSelectionStore } from "@/stores/pod/selectionStore";
import type { useConnectionStore } from "@/stores/connectionStore";

type PodStore = ReturnType<typeof usePodStore>;
type ViewportStore = ReturnType<typeof useViewportStore>;
type SelectionStore = ReturnType<typeof useSelectionStore>;
type ConnectionStore = ReturnType<typeof useConnectionStore>;

interface UseCanvasInteractionControllerOptions {
  podStore: PodStore;
  viewportStore: ViewportStore;
  selectionStore: SelectionStore;
  connectionStore: ConnectionStore;
  handleCreateRepositoryNote: (repositoryId: string) => void;
  handleOpenCreateRepositoryModal: () => void;
  handleOpenCloneRepositoryModal: () => void;
}

export function useCanvasInteractionController(
  options: UseCanvasInteractionControllerOptions,
): {
  handleContextMenu: (event: MouseEvent) => void;
  handleCanvasClick: (event: MouseEvent) => void;
  handleSelectType: (
    config: PodTypeConfig,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ) => Promise<void>;
  handleSelectPod: (podId: string) => void;
  handleUpdatePod: (pod: Pod) => Promise<void>;
  handleDeletePod: (podId: string) => Promise<void>;
  handleDragEnd: (payload: { id: string; x: number; y: number }) => void;
  handlePodDragComplete: (payload: { id: string }) => void;
  handleCreateNote: (payload: { type: string; id: string }) => void;
  handleOpenModal: (payload: { type: string }) => void;
  lastMenuPosition: Ref<Position | null>;
} {
  const lastMenuPosition = ref<Position | null>(null);

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const target = event.target as HTMLElement;

    if (
      target.classList.contains("viewport") ||
      target.classList.contains("canvas-content")
    ) {
      options.podStore.showTypeMenu({ x: event.clientX, y: event.clientY });
    }
  };

  const handleCanvasClick = (event: MouseEvent): void => {
    if (options.selectionStore.boxSelectJustEnded) {
      return;
    }

    const target = event.target as HTMLElement;
    const ignoredSelectors = [
      ".connection-line",
      ".pod-doodle",
      ".repository-note",
    ];

    if (ignoredSelectors.some((selector) => target.closest(selector))) {
      return;
    }

    if (isCtrlOrCmdPressed(event)) {
      return;
    }

    options.selectionStore.clearSelection();
    options.connectionStore.selectConnection(null);
  };

  const handleSelectType = async (
    _config: PodTypeConfig,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ): Promise<void> => {
    if (!options.podStore.typeMenu.position) return;

    const { x: canvasX, y: canvasY } = screenToCanvasPosition(
      options.podStore.typeMenu.position,
      options.viewportStore,
    );

    const rotation =
      Math.random() * DEFAULT_POD_ROTATION_RANGE -
      DEFAULT_POD_ROTATION_RANGE / 2;

    const newPod = {
      name: options.podStore.getNextPodName(),
      x: canvasX - POD_MENU_X_OFFSET,
      y: canvasY - POD_MENU_Y_OFFSET,
      rotation: Math.round(rotation * 10) / 10,
      provider,
      providerConfig,
    };

    options.podStore.hideTypeMenu();
    await options.podStore.createPodWithBackend(newPod);
  };

  const handleSelectPod = (podId: string): void => {
    options.podStore.selectPod(podId);
  };

  const handleUpdatePod = async (pod: Pod): Promise<void> => {
    const oldPod = options.podStore.getPodById(pod.id);
    if (!oldPod) return;

    const oldName = oldPod.name;
    options.podStore.updatePod(pod);

    if (oldName !== pod.name) {
      const success = await options.podStore.renamePodWithBackend(
        pod.id,
        pod.name,
      );
      if (!success) {
        options.podStore.updatePod({ ...pod, name: oldName });
      }
    }
  };

  const handleDeletePod = async (podId: string): Promise<void> => {
    await options.podStore.deletePodWithBackend(podId);
  };

  const handleDragEnd = (payload: {
    id: string;
    x: number;
    y: number;
  }): void => {
    options.podStore.movePod(payload.id, payload.x, payload.y);
  };

  const handlePodDragComplete = (payload: { id: string }): void => {
    options.podStore.syncPodPosition(payload.id);
  };

  const handleCreateNote = (payload: { type: string; id: string }): void => {
    if (payload.type === "repository") {
      options.handleCreateRepositoryNote(payload.id);
    }
  };

  const handleOpenModal = (payload: { type: string }): void => {
    if (payload.type === "createRepository") {
      lastMenuPosition.value = options.podStore.typeMenu.position;
      options.handleOpenCreateRepositoryModal();
      return;
    }

    if (payload.type === "cloneRepository") {
      options.handleOpenCloneRepositoryModal();
    }
  };

  return {
    handleContextMenu,
    handleCanvasClick,
    handleSelectType,
    handleSelectPod,
    handleUpdatePod,
    handleDeletePod,
    handleDragEnd,
    handlePodDragComplete,
    handleCreateNote,
    handleOpenModal,
    lastMenuPosition,
  };
}
