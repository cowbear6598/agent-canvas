import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import { useCanvasSessionLifecycle } from "@/composables/useCanvasSessionLifecycle";

describe("useCanvasSessionLifecycle", () => {
  it("初始化後切換 canvas 時應重置 canvas 範圍狀態並載入新 session", async () => {
    const canvasStore = reactive({
      activeCanvasId: "canvas-1" as string | null,
    });
    const resetCanvasScopedState = vi.fn();
    const loadCanvasData = vi.fn(async () => undefined);
    const lifecycle = useCanvasSessionLifecycle({
      canvasStore,
      isInitialized: ref(true),
      resetCanvasScopedState,
      loadCanvasData,
    });

    canvasStore.activeCanvasId = "canvas-2";
    await nextTick();

    expect(resetCanvasScopedState).toHaveBeenCalledOnce();
    expect(loadCanvasData).toHaveBeenCalledOnce();

    lifecycle.stopCanvasSessionLifecycle();
  });

  it("尚未初始化時切換 canvas 不應載入 session", async () => {
    const canvasStore = reactive({
      activeCanvasId: "canvas-1" as string | null,
    });
    const resetCanvasScopedState = vi.fn();
    const loadCanvasData = vi.fn(async () => undefined);
    const lifecycle = useCanvasSessionLifecycle({
      canvasStore,
      isInitialized: ref(false),
      resetCanvasScopedState,
      loadCanvasData,
    });

    canvasStore.activeCanvasId = "canvas-2";
    await nextTick();

    expect(resetCanvasScopedState).not.toHaveBeenCalled();
    expect(loadCanvasData).not.toHaveBeenCalled();

    lifecycle.stopCanvasSessionLifecycle();
  });
});
