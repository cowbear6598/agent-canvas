import { ref, type Ref } from "vue";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import type { Position } from "@/types";
import type { useViewportStore } from "@/stores/pod/viewportStore";
import type { useRepositoryStore } from "@/stores/note/repositoryStore";

type ViewportStore = ReturnType<typeof useViewportStore>;
type RepositoryStore = ReturnType<typeof useRepositoryStore>;

interface UseCanvasRepositoryActionsOptions {
  viewportStore: ViewportStore;
  repositoryStore: RepositoryStore;
  lastMenuPosition: Ref<Position | null>;
}

export interface CanvasRepositoryActions {
  showCreateRepositoryModal: Ref<boolean>;
  showCloneRepositoryModal: Ref<boolean>;
  handleOpenCreateRepositoryModal: () => void;
  handleOpenCloneRepositoryModal: () => void;
  handleRepositoryCreated: (repository: { id: string; name: string }) => void;
}

export function useCanvasRepositoryActions(
  options: UseCanvasRepositoryActionsOptions,
): CanvasRepositoryActions {
  const showCreateRepositoryModal = ref(false);
  const showCloneRepositoryModal = ref(false);

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

  return {
    showCreateRepositoryModal,
    showCloneRepositoryModal,
    handleOpenCreateRepositoryModal,
    handleOpenCloneRepositoryModal,
    handleRepositoryCreated,
  };
}
