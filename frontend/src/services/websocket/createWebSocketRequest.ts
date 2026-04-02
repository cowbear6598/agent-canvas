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

interface WebSocketErrorObject {
  key: string;
  params?: Record<string, unknown>;
}

interface WebSocketResponse {
  requestId?: string;
  success?: boolean;
  error?: string | WebSocketErrorObject;
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
        const rawError = responseWithBase.error;
        let errorMessage: string;

        if (rawError && typeof rawError === "object" && "key" in rawError) {
          // 後端回傳 i18n key 格式的錯誤物件，翻譯後顯示
          const translated = t(rawError.key, rawError.params ?? {});
          // 若翻譯結果與 key 相同，代表找不到對應翻譯，退回通用錯誤訊息
          errorMessage =
            translated === rawError.key
              ? t("common.error.unknown")
              : translated;
        } else if (typeof rawError === "string") {
          errorMessage = rawError;
        } else {
          errorMessage = t("common.error.unknown");
        }

        reject(new Error(errorMessage));
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
