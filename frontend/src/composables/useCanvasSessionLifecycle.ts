import { getCurrentInstance, onUnmounted, type Ref, watch } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";

interface CanvasSessionLifecycleCanvasStore {
  activeCanvasId: string | null;
}

interface UseCanvasSessionLifecycleOptions {
  canvasStore?: CanvasSessionLifecycleCanvasStore;
  isInitialized: Ref<boolean>;
  resetCanvasScopedState: () => void;
  loadCanvasData: () => Promise<void>;
}

interface UseCanvasSessionLifecycleReturn {
  stopCanvasSessionLifecycle: () => void;
}

export function useCanvasSessionLifecycle(
  options: UseCanvasSessionLifecycleOptions,
): UseCanvasSessionLifecycleReturn {
  const canvasStore = options.canvasStore ?? useCanvasContext().canvasStore;

  const stopCanvasSessionLifecycle = watch(
    () => canvasStore.activeCanvasId,
    async (newCanvasId, oldCanvasId) => {
      if (newCanvasId === oldCanvasId || !options.isInitialized.value) {
        return;
      }

      options.resetCanvasScopedState();

      if (!newCanvasId) {
        return;
      }

      await options.loadCanvasData();
    },
  );

  if (getCurrentInstance()) {
    onUnmounted(stopCanvasSessionLifecycle);
  }

  return {
    stopCanvasSessionLifecycle,
  };
}
