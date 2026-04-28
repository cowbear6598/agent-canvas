import { useCanvasStore } from "@/stores/canvasStore";
import { tryResolvePendingRequest } from "@/services/websocket/createWebSocketRequest";
import { useToast } from "@/composables/useToast";
import { logger } from "@/utils/logger";

export interface BasePayload {
  requestId?: string;
  canvasId?: string | null;
}

export interface UnifiedHandlerOptions {
  toastMessage?: string | (() => string);
  /**
   * 跳過 canvasId 比對的兩種機制，語意不同：
   *
   * - `payload.canvasId === null`：後端 emit 此事件時沒有 canvas 範疇（全域事件），
   *   前端永遠處理，不需額外設定此選項。
   *
   * - `skipCanvasCheck: true`：此 handler 本身不需要 canvas 比對
   *   （例如管理全域狀態的 handler），明確告知 createUnifiedHandler 略過比對邏輯。
   *
   * 注意：未設定 skipCanvasCheck 且 payload.canvasId 為 undefined 時，
   * 會以 warn log 略過並視為配置錯誤。
   */
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
      if (payload.canvasId === undefined) {
        logger.warn(
          "[createUnifiedHandler] 收到事件但 payload 缺少 canvasId，已略過（若此事件不需 canvasId 過濾，請傳入 skipCanvasCheck: true）",
        );
        return;
      }
      if (payload.canvasId !== null && !isCurrentCanvas(payload.canvasId)) {
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
