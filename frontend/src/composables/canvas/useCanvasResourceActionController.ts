import type { Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { Position } from "@/types";
import type { usePodStore } from "@/stores/pod/podStore";
import type { useViewportStore } from "@/stores/pod/viewportStore";
import type { useConnectionStore } from "@/stores/connectionStore";
import type { useRepositoryStore } from "@/stores/note/repositoryStore";
import {
  useCanvasBranchActions,
  type CanvasBranchActions,
  type ConnectionContextMenuRef,
} from "./useCanvasBranchActions";
import {
  useCanvasMemoryActions,
  type CanvasMemoryActions,
} from "./useCanvasMemoryActions";
import {
  useCanvasPodActions,
  type CanvasPodActions,
} from "./useCanvasPodActions";
import {
  useCanvasRepositoryActions,
  type CanvasRepositoryActions,
} from "./useCanvasRepositoryActions";

type PodStore = ReturnType<typeof usePodStore>;
type ViewportStore = ReturnType<typeof useViewportStore>;
type ConnectionStore = ReturnType<typeof useConnectionStore>;
type RepositoryStore = ReturnType<typeof useRepositoryStore>;

export type { BranchEditModalState } from "./useCanvasBranchActions";

interface UseCanvasResourceActionControllerOptions {
  podStore: PodStore;
  viewportStore: ViewportStore;
  repositoryStore: RepositoryStore;
  connectionStore: ConnectionStore;
  connectionContextMenu: ConnectionContextMenuRef;
  t: Composer["t"];
  lastMenuPosition: Ref<Position | null>;
}

type CanvasResourceActionController = CanvasMemoryActions &
  CanvasPodActions &
  CanvasRepositoryActions &
  CanvasBranchActions;

export function useCanvasResourceActionController(
  options: UseCanvasResourceActionControllerOptions,
): CanvasResourceActionController {
  return {
    ...useCanvasMemoryActions(options),
    ...useCanvasPodActions(options.podStore),
    ...useCanvasRepositoryActions(options),
    ...useCanvasBranchActions(
      options.connectionStore,
      options.connectionContextMenu,
    ),
  };
}
