import { generateRequestId } from "@/services/utils";
import { websocketClient } from "./WebSocketClient";
import { t } from "@/i18n";
import {
  getWebSocketResponseRequestId,
  mapWebSocketResponse,
  responseMatchesRequest,
} from "./webSocketResponseMapper";

export interface WebSocketRequestConfig<TPayload, TResult> {
  requestEvent: string;
  responseEvent: string;
  payload: Omit<TPayload, "requestId">;
  timeout?: number;
  matchResponse?: (response: TResult, requestId: string) => boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

interface PendingRequest<T = unknown> {
  requestId: string;
  resolve: (data: T) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  responseEvent: string;
  timestamp: number;
  matchResponse?: (response: T, requestId: string) => boolean;
}

const pendingRequests = new Map<string, PendingRequest>();
const pendingRequestIdsByEvent = new Map<string, Set<string>>();
const responseEventListeners = new Map<string, (response: unknown) => void>();

function removePendingRequest(requestId: string): PendingRequest | null {
  const request = pendingRequests.get(requestId);
  if (!request) return null;

  pendingRequests.delete(requestId);
  const eventRequestIds = pendingRequestIdsByEvent.get(request.responseEvent);
  eventRequestIds?.delete(requestId);

  if (eventRequestIds?.size === 0) {
    pendingRequestIdsByEvent.delete(request.responseEvent);
    const listener = responseEventListeners.get(request.responseEvent);
    if (listener) {
      websocketClient.off(request.responseEvent, listener);
      responseEventListeners.delete(request.responseEvent);
    }
  }

  return request;
}

function settlePendingRequest(requestId: string, response: unknown): boolean {
  const request = removePendingRequest(requestId);
  if (!request) return false;

  clearTimeout(request.timeoutId);
  const mappedResponse = mapWebSocketResponse(response);

  if (!mappedResponse.ok) {
    request.reject(new Error(mappedResponse.error));
    return true;
  }

  request.resolve(mappedResponse.data);
  return true;
}

function rejectPendingRequest(requestId: string, error: Error): boolean {
  const request = removePendingRequest(requestId);
  if (!request) return false;

  clearTimeout(request.timeoutId);
  request.reject(error);
  return true;
}

function rejectAllPendingRequests(error: Error): void {
  for (const requestId of Array.from(pendingRequests.keys())) {
    rejectPendingRequest(requestId, error);
  }
}

function getResponseEventListener(
  responseEvent: string,
): (response: unknown) => void {
  const existing = responseEventListeners.get(responseEvent);
  if (existing) return existing;

  const listener = (response: unknown): void => {
    const directRequestId = getWebSocketResponseRequestId(response);

    if (directRequestId) {
      const directRequest = pendingRequests.get(directRequestId);
      if (directRequest?.responseEvent === responseEvent) {
        settlePendingRequest(directRequestId, response);
        return;
      }
    }

    const eventRequestIds = pendingRequestIdsByEvent.get(responseEvent);
    if (!eventRequestIds) return;

    for (const pendingRequestId of Array.from(eventRequestIds)) {
      const request = pendingRequests.get(pendingRequestId);
      if (!request) continue;

      const shouldMatch = responseMatchesRequest(
        response,
        pendingRequestId,
        request.matchResponse,
      );

      if (shouldMatch) {
        settlePendingRequest(pendingRequestId, response);
        return;
      }
    }
  };

  responseEventListeners.set(responseEvent, listener);
  websocketClient.on(responseEvent, listener);
  return listener;
}

function registerPendingRequest(request: PendingRequest): void {
  pendingRequests.set(request.requestId, request);

  const eventRequestIds =
    pendingRequestIdsByEvent.get(request.responseEvent) ?? new Set<string>();
  eventRequestIds.add(request.requestId);
  pendingRequestIdsByEvent.set(request.responseEvent, eventRequestIds);

  getResponseEventListener(request.responseEvent);
}

websocketClient.onDisconnect(() => {
  rejectAllPendingRequests(new Error(t("websocket.notConnected")));
});

export function tryResolvePendingRequest(
  requestId: string,
  data: unknown,
): boolean {
  return settlePendingRequest(requestId, data);
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
    const timeoutId = setTimeout(() => {
      removePendingRequest(requestId);
      reject(new Error(t("websocket.requestTimeout", { event: requestEvent })));
    }, timeout);

    registerPendingRequest({
      requestId,
      resolve: resolve as (data: unknown) => void,
      reject,
      timeoutId,
      responseEvent,
      timestamp: Date.now(),
      matchResponse: matchResponse as
        | ((response: unknown, requestId: string) => boolean)
        | undefined,
    });

    const emitResult = websocketClient.emit(requestEvent, {
      ...payload,
      requestId,
    } as TPayload);

    if (!emitResult.ok) {
      rejectPendingRequest(requestId, emitResult.error);
    }
  });
}
