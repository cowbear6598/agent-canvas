import { useCanvasStore } from "@/stores/canvasStore";
import { tryResolvePendingRequest } from "@/services/websocket/createWebSocketRequest";
import { useToast } from "@/composables/useToast";

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
    if (!options?.skipCanvasCheck && payload.canvasId) {
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
