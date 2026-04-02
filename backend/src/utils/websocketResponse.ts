import type { WebSocketResponseEvents } from "../schemas";
import { socketService } from "../services/socketService.js";
import { createI18nError, type I18nError } from "./i18nError.js";

export function emitSuccess<T>(
  connectionId: string,
  event: WebSocketResponseEvents,
  data: T,
): void {
  socketService.emitToConnection(connectionId, event, data);
}

export function emitError(
  connectionId: string,
  event: WebSocketResponseEvents,
  error: string | Error | I18nError,
  requestId?: string,
  podId?: string,
  code: string = "INTERNAL_ERROR",
): void {
  let errorPayload: string | I18nError;

  if (error instanceof Error) {
    errorPayload = error.message;
  } else {
    errorPayload = error;
  }

  socketService.emitToConnection(connectionId, event, {
    requestId,
    podId,
    success: false,
    error: errorPayload,
    code,
  });
}

export function emitNotFound(
  connectionId: string,
  responseEvent: WebSocketResponseEvents,
  entityName: string,
  resourceId: string,
  requestId: string,
): void {
  emitError(
    connectionId,
    responseEvent,
    createI18nError("errors.notFound", { entity: entityName, id: resourceId }),
    requestId,
    undefined,
    "NOT_FOUND",
  );
}

export { getErrorMessage } from "./errorHelpers.js";
