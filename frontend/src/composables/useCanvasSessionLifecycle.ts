import { getCurrentInstance, onUnmounted, type Ref, watch } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { logger } from "@/utils/logger";

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

      try {
        await options.loadCanvasData();
      } catch (error) {
        logger.error("[CanvasSession] 載入 Canvas 資料失敗", error);
        options.resetCanvasScopedState();
      }
    },
  );

  if (getCurrentInstance()) {
    onUnmounted(stopCanvasSessionLifecycle);
  }

  return {
    stopCanvasSessionLifecycle,
  };
}
