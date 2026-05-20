import { createWebSocketRequest } from "@/services/websocket";
import { useWebSocketErrorHandler } from "./useWebSocketErrorHandler";

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
  ) => Promise<TResponse | null>;
} {
  const { wrapWebSocketRequest } = useWebSocketErrorHandler();

  async function deleteItem<TPayload, TResponse extends { success: boolean }>(
    options: DeleteItemOptions<TPayload, TResponse>,
  ): Promise<TResponse | null> {
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
    } catch {
      return null;
    }

    if (!response || !response.success) return null;

    if (options.onSuccess) {
      options.onSuccess(response);
    }

    return response;
  }

  return { deleteItem };
}
