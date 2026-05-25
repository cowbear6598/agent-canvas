import { createWebSocketRequest } from "@/services/websocket";
import { useWebSocketErrorHandler } from "./useWebSocketErrorHandler";
import { sanitizeErrorForUser } from "@/utils/errorSanitizer";
import { t } from "@/i18n";

type DeleteItemResult<TResponse> =
  | { success: true; data: TResponse }
  | { success: false; error: string };

interface DeleteItemOptions<TPayload, TResponse> {
  requestEvent: string;
  responseEvent: string;
  payload: TPayload;
  errorMessage?: string;
  onSuccess?: (response: TResponse) => void;
}

export function useDeleteItem(): {
  deleteItem: <TPayload, TResponse extends { success: boolean }>(
    options: DeleteItemOptions<TPayload, TResponse>,
  ) => Promise<DeleteItemResult<TResponse>>;
} {
  const { handleWebSocketError, wrapWebSocketRequest } =
    useWebSocketErrorHandler();

  async function deleteItem<TPayload, TResponse extends { success: boolean }>(
    options: DeleteItemOptions<TPayload, TResponse>,
  ): Promise<DeleteItemResult<TResponse>> {
    let response: TResponse;
    try {
      response = await wrapWebSocketRequest(
        createWebSocketRequest<TPayload & { requestId: string }, TResponse>({
          requestEvent: options.requestEvent,
          responseEvent: options.responseEvent,
          payload: options.payload as Omit<
            TPayload & { requestId: string },
            "requestId"
          >,
        }),
      );
    } catch (error) {
      handleWebSocketError(error, options.errorMessage);
      return { success: false, error: sanitizeErrorForUser(error) };
    }

    if (!response || !response.success) {
      return {
        success: false,
        error: options.errorMessage ?? t("common.error.delete"),
      };
    }

    if (options.onSuccess) {
      options.onSuccess(response);
    }

    return { success: true, data: response };
  }

  return { deleteItem };
}
