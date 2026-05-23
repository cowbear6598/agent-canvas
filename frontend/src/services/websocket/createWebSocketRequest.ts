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
  key?: string;
  code?: string;
  message?: string;
  params?: Record<string, unknown>;
}

interface WebSocketResponse {
  requestId?: string;
  success?: boolean;
  error?: string | WebSocketErrorObject;
}

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

const MESSAGE_ALLOWED_ERROR_CODES = new Set([
  "alias_duplicate",
  "alias_in_use",
  "alias_not_found",
  "invalid_ordered_ids",
  "opencode_server_not_ready",
  "opencode_provider_list_failed",
  "opencode_provider_not_found",
  "opencode_model_metadata_missing",
  "opencode_model_not_found",
  "opencode_thinking_presets_unavailable",
  "opencode_restart_failed",
]);

function translateIfKnown(
  key: string,
  params?: Record<string, unknown>,
): string | null {
  const translated = t(key, params ?? {});
  return translated === key ? null : translated;
}

function resolveErrorMessage(rawError: WebSocketResponse["error"]): string {
  if (rawError && typeof rawError === "object") {
    if (
      typeof rawError.code === "string" &&
      MESSAGE_ALLOWED_ERROR_CODES.has(rawError.code) &&
      typeof rawError.message === "string"
    ) {
      return rawError.message;
    }

    if (typeof rawError.code === "string") {
      return (
        translateIfKnown(`websocket.errors.${rawError.code}`, rawError.params) ??
        t("common.error.unknown")
      );
    }

    if (typeof rawError.key === "string") {
      return (
        translateIfKnown(rawError.key, rawError.params) ??
        t("common.error.unknown")
      );
    }
  }

  return t("common.error.unknown");
}

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
  const responseWithBase = response as WebSocketResponse;

  if (responseWithBase.success === false) {
    request.reject(new Error(resolveErrorMessage(responseWithBase.error)));
    return true;
  }

  request.resolve(response);
  return true;
}

function getResponseEventListener(
  responseEvent: string,
): (response: unknown) => void {
  const existing = responseEventListeners.get(responseEvent);
  if (existing) return existing;

  const listener = (response: unknown): void => {
    const responseWithBase = response as WebSocketResponse;
    const directRequestId =
      typeof responseWithBase.requestId === "string"
        ? responseWithBase.requestId
        : null;

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

      const shouldMatch = request.matchResponse
        ? request.matchResponse(response, pendingRequestId)
        : responseWithBase.requestId === pendingRequestId;

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

export function tryResolvePendingRequest(
  requestId: string,
  data: unknown,
): boolean {
  const request = removePendingRequest(requestId);
  if (request) {
    clearTimeout(request.timeoutId);
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

    websocketClient.emit(requestEvent, {
      ...payload,
      requestId,
    } as TPayload);
  });
}
