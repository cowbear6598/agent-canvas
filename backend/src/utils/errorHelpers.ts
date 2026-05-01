import { AbortError } from "@anthropic-ai/claude-agent-sdk";

/**
 * 工作目錄路徑非法（路徑穿越或 repositoryId 不合法）時拋出。
 * 由 classifyKnownError 以 instanceof 辨識，對應 INVALID_PATH 錯誤碼。
 */
export class InvalidWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkspaceError";
  }
}

/**
 * Provider 找不到或初始化失敗時拋出。
 * 由 classifyKnownError 以 instanceof 辨識，對應 PROVIDER_NOT_FOUND 錯誤碼。
 */
export class ProviderNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotFoundError";
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "發生未知錯誤";
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof AbortError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * 判斷 error 是否為程式 bug（TypeError、ReferenceError 等），
 * 而非外部 SDK／網路錯誤。
 * 程式 bug 應向上拋出，讓開發者能即時發現問題。
 */
export function isProgrammingError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    error instanceof SyntaxError ||
    error instanceof EvalError ||
    error instanceof URIError
  );
}
