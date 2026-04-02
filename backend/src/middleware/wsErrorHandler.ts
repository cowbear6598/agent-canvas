import { socketService } from "../services/socketService.js";
import { logger } from "../utils/logger.js";
import { createI18nError, type I18nError } from "../utils/i18nError.js";

export class WebSocketError extends Error {
  code: string;
  requestId?: string;
  podId?: string;
  i18nError?: I18nError;

  constructor(
    code: string,
    message: string | I18nError,
    requestId?: string,
    podId?: string,
  ) {
    const messageStr = typeof message === "string" ? message : message.key;
    super(messageStr);
    this.name = "WebSocketError";
    this.code = code;
    this.requestId = requestId;
    this.podId = podId;
    if (typeof message !== "string") {
      this.i18nError = message;
    }
  }
}

export interface WebSocketErrorContext {
  connectionId: string;
  responseEvent: string;
  error: unknown;
  requestId?: string;
  podId?: string;
}

export function handleWebSocketError(context: WebSocketErrorContext): void {
  let errorPayloadError: string | I18nError;
  let errorCode: string;
  let { requestId, podId } = context;
  const { connectionId, responseEvent, error } = context;

  if (error instanceof WebSocketError) {
    errorPayloadError = error.i18nError ?? error.message;
    errorCode = error.code;
    requestId = requestId || error.requestId;
    podId = podId || error.podId;
  } else if (error instanceof Error) {
    logger.error("WebSocket", "Error", `內部錯誤詳細訊息: ${error.message}`);
    errorPayloadError = createI18nError("errors.internalError");
    errorCode = "INTERNAL_ERROR";
  } else {
    errorPayloadError = createI18nError("errors.unknownError");
    errorCode = "UNKNOWN_ERROR";
  }

  const errorPayload: {
    requestId: string | undefined;
    success: false;
    error: string | I18nError;
    code: string;
    podId?: string;
  } = {
    requestId,
    success: false,
    error: errorPayloadError,
    code: errorCode,
  };

  if (podId) {
    errorPayload.podId = podId;
  }

  socketService.emitToConnection(connectionId, responseEvent, errorPayload);

  const logMessage =
    typeof errorPayloadError === "string"
      ? errorPayloadError
      : errorPayloadError.key;
  logger.error(
    "WebSocket",
    "Error",
    `事件: ${responseEvent}, 錯誤碼: ${errorCode}, 訊息: ${logMessage}`,
  );
}
