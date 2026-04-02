import { useCanvasStore } from "@/stores/canvasStore";
import { t } from "@/i18n";

export function requireActiveCanvas(): string {
  const canvasStore = useCanvasStore();

  if (!canvasStore.activeCanvasId) {
    throw new Error(t("canvas.noActiveCanvas"));
  }

  return canvasStore.activeCanvasId;
}

export function getActiveCanvasIdOrWarn(context: string): string | null {
  const canvasStore = useCanvasStore();

  if (!canvasStore.activeCanvasId) {
    console.warn(`[${context}] ${t("canvas.noActiveCanvas")}`);
    return null;
  }

  return canvasStore.activeCanvasId;
}
