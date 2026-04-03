import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { createWebSocketRequest } from "@/services/websocket";
import type { WebSocketRequestConfig } from "@/services/websocket/createWebSocketRequest";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { useToast } from "@/composables/useToast";
import type { ToastCategory } from "@/composables/useToast";
import { t } from "@/i18n";

export type WebSocketActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface CanvasWebSocketActionOptions {
  errorCategory: ToastCategory;
  errorAction: string;
  errorMessage: string;
  suppressErrorToast?: boolean;
}

type CanvasPayload = { requestId: string; canvasId: string };

export function useCanvasWebSocketAction(): {
  executeAction: <TPayload extends CanvasPayload, TResponse>(
    config: Omit<WebSocketRequestConfig<TPayload, TResponse>, "payload"> & {
      payload: Omit<TPayload, "requestId" | "canvasId">;
    },
    options: CanvasWebSocketActionOptions,
  ) => Promise<WebSocketActionResult<TResponse>>;
} {
  const { wrapWebSocketRequest } = useWebSocketErrorHandler();
  const { showErrorToast } = useToast();

  const executeAction = async <TPayload extends CanvasPayload, TResponse>(
    config: Omit<WebSocketRequestConfig<TPayload, TResponse>, "payload"> & {
      payload: Omit<TPayload, "requestId" | "canvasId">;
    },
    options: CanvasWebSocketActionOptions,
  ): Promise<WebSocketActionResult<TResponse>> => {
    const canvasId = getActiveCanvasIdOrWarn("useCanvasWebSocketAction");
    if (!canvasId) {
      return { success: false, error: t("composable.canvas.noActiveCanvas") };
    }

    const fullPayload = { ...config.payload, canvasId } as Omit<
      TPayload,
      "requestId"
    >;

    const response = await wrapWebSocketRequest(
      createWebSocketRequest<TPayload, TResponse>({
        requestEvent: config.requestEvent,
        responseEvent: config.responseEvent,
        timeout: config.timeout,
        matchResponse: config.matchResponse,
        payload: fullPayload,
      }),
    );

    if (!response) {
      if (!options.suppressErrorToast) {
        showErrorToast(options.errorCategory, options.errorAction);
      }
      return { success: false, error: options.errorMessage };
    }

    return { success: true, data: response };
  };

  return { executeAction };
}
