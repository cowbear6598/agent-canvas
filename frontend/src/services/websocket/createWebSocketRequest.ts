import { generateRequestId } from "@/services/utils";
import { websocketClient } from "./WebSocketClient";
import { t } from "@/i18n";

export interface WebSocketRequestConfig<TPayload, TResult> {
  requestEvent: string;
  responseEvent: string;
  payload: Omit<TPayload, "requestId">;
  timeout?: number;
  matchResponse?: (response: TResult, requestId: string) => boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

interface WebSocketResponse {
  requestId?: string;
  success?: boolean;
  error?: string;
}

export interface PendingRequest<T = unknown> {
  requestId: string;
  resolve: (data: T) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  responseEvent: string;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();

export function tryResolvePendingRequest(
  requestId: string,
  data: unknown,
): boolean {
  const request = pendingRequests.get(requestId);
  if (request) {
    clearTimeout(request.timeoutId);
    pendingRequests.delete(requestId);
    request.resolve(data);
    return true;
  }
  return false;
}

export async function createWebSocketRequest<
  TPayload extends { requestId: string },
  TResult,
>(config: WebSocketRequestConfig<TPayload, TResult>): Promise<TResult> {
  const {
    requestEvent,
    responseEvent,
    payload,
    timeout = DEFAULT_REQUEST_TIMEOUT_MS,
    matchResponse,
  } = config;

  return new Promise<TResult>((resolve, reject) => {
    if (!websocketClient.isConnected.value) {
      reject(new Error(t("websocket.notConnected")));
      return;
    }

    const requestId = generateRequestId();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleResponse = (response: TResult): void => {
      const responseWithBase = response as TResult & WebSocketResponse;

      const shouldMatch = matchResponse
        ? matchResponse(response, requestId)
        : responseWithBase.requestId === requestId;

      if (!shouldMatch) return;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      websocketClient.off(responseEvent, handleResponse);

      if (responseWithBase.success === false) {
        const error = responseWithBase.error ?? t("common.error.unknown");
        reject(new Error(error));
        return;
      }

      resolve(response);
    };

    websocketClient.on(responseEvent, handleResponse);

    websocketClient.emit(requestEvent, {
      ...payload,
      requestId,
    } as TPayload);

    timeoutId = setTimeout(() => {
      websocketClient.off(responseEvent, handleResponse);
      reject(new Error(t("websocket.requestTimeout", { event: requestEvent })));
    }, timeout);
  });
}
