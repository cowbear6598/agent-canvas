import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { createWebSocketRequest } from "@/services/websocket";
import type { WebSocketRequestConfig } from "@/services/websocket/createWebSocketRequest";
import type { WebSocketActionResult } from "@/services/websocket/webSocketResponseMapper";
import {
  createCanvasScopedPayload,
  createWebSocketActionFailure,
  createWebSocketActionSuccess,
} from "@/services/websocket/webSocketResponseMapper";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { useToast } from "@/composables/useToast";
import type { ToastCategory } from "@/composables/useToast";
import { t } from "@/i18n";

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
      return createWebSocketActionFailure(t("composable.canvas.noActiveCanvas"));
    }

    const fullPayload = createCanvasScopedPayload<TPayload>(
      config.payload,
      canvasId,
    );

    let response: TResponse;
    try {
      response = await wrapWebSocketRequest(
        createWebSocketRequest<TPayload, TResponse>({
          requestEvent: config.requestEvent,
          responseEvent: config.responseEvent,
          timeout: config.timeout,
          matchResponse: config.matchResponse,
          payload: fullPayload,
        }),
      );
    } catch {
      if (!options.suppressErrorToast) {
        showErrorToast(options.errorCategory, options.errorAction);
      }
      return createWebSocketActionFailure(options.errorMessage);
    }

    return createWebSocketActionSuccess(response);
  };

  return { executeAction };
}
