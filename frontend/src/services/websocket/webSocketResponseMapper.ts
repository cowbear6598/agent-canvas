import { t } from "@/i18n";

interface WebSocketErrorObject {
  key?: string;
  code?: string;
  message?: string;
  params?: Record<string, unknown>;
}

export interface WebSocketBaseResponse {
  requestId?: unknown;
  success?: unknown;
  error?: string | WebSocketErrorObject;
}

export type WebSocketMappedResponse<TResponse> =
  | {
      ok: true;
      requestId: string | null;
      data: TResponse;
    }
  | {
      ok: false;
      requestId: string | null;
      error: string;
    };

export type WebSocketActionResult<TResponse> =
  | { success: true; data: TResponse }
  | { success: false; error: string };

const MESSAGE_ALLOWED_ERROR_CODES = new Set([
  "alias_duplicate",
  "alias_model_duplicate",
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

function asBaseResponse(response: unknown): WebSocketBaseResponse {
  return response && typeof response === "object"
    ? (response as WebSocketBaseResponse)
    : {};
}

function translateIfKnown(
  key: string,
  params?: Record<string, unknown>,
): string | null {
  const translated = t(key, params ?? {});
  return translated === key ? null : translated;
}

function resolveWebSocketErrorMessage(
  rawError: WebSocketBaseResponse["error"],
): string {
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

export function getWebSocketResponseRequestId(response: unknown): string | null {
  const requestId = asBaseResponse(response).requestId;
  return typeof requestId === "string" ? requestId : null;
}

export function mapWebSocketResponse<TResponse>(
  response: TResponse,
): WebSocketMappedResponse<TResponse> {
  const baseResponse = asBaseResponse(response);
  const requestId = getWebSocketResponseRequestId(response);

  if (baseResponse.success === false) {
    return {
      ok: false,
      requestId,
      error: resolveWebSocketErrorMessage(baseResponse.error),
    };
  }

  return {
    ok: true,
    requestId,
    data: response,
  };
}

export function responseMatchesRequest<TResponse>(
  response: TResponse,
  requestId: string,
  matchResponse?: (response: TResponse, requestId: string) => boolean,
): boolean {
  if (matchResponse) {
    return matchResponse(response, requestId);
  }

  return getWebSocketResponseRequestId(response) === requestId;
}

export function createWebSocketActionSuccess<TResponse>(
  data: TResponse,
): WebSocketActionResult<TResponse> {
  return { success: true, data };
}

export function createWebSocketActionFailure<TResponse = never>(
  error: string,
): WebSocketActionResult<TResponse> {
  return { success: false, error };
}

export function createCanvasScopedPayload<
  TPayload extends { requestId: string; canvasId: string },
>(
  payload: Omit<TPayload, "requestId" | "canvasId">,
  canvasId: string,
): Omit<TPayload, "requestId"> {
  return { ...payload, canvasId } as Omit<TPayload, "requestId">;
}
