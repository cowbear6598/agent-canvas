import { useCanvasStore } from "@/stores/canvasStore";
import { tryResolvePendingRequest } from "@/services/websocket/createWebSocketRequest";
import { useToast } from "@/composables/useToast";
import { logger } from "@/utils/logger";

export interface BasePayload {
  requestId?: string;
  canvasId?: string;
}

export interface UnifiedHandlerOptions {
  toastMessage?: string | (() => string);
  skipCanvasCheck?: boolean;
}

export const isCurrentCanvas = (canvasId: string): boolean => {
  const canvasStore = useCanvasStore();
  return canvasStore.activeCanvasId === canvasId;
};

export function createUnifiedHandler<T extends BasePayload>(
  handler: (payload: T, isOwnOperation: boolean) => void,
  options?: UnifiedHandlerOptions,
): (payload: T) => void {
  return (payload: T): void => {
    if (!options?.skipCanvasCheck) {
      if (!payload.canvasId) {
        logger.warn(
          "[createUnifiedHandler] 收到事件但 payload 缺少 canvasId，已略過（若此事件不需 canvasId 過濾，請傳入 skipCanvasCheck: true）",
        );
        return;
      }
      if (!isCurrentCanvas(payload.canvasId)) {
        return;
      }
    }

    const isOwnOperation = payload.requestId
      ? tryResolvePendingRequest(payload.requestId, payload)
      : false;

    if (isOwnOperation && options?.toastMessage) {
      const { toast } = useToast();
      const title =
        typeof options.toastMessage === "function"
          ? options.toastMessage()
          : options.toastMessage;
      toast({ title });
    }

    handler(payload, isOwnOperation);
  };
}
