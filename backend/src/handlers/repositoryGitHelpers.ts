import { WebSocketResponseEvents } from "../schemas";
import { repositoryService } from "../services/repositoryService.js";
import { socketService } from "../services/socketService.js";
import { getValidatedGitRepository } from "../utils/validators.js";
import { emitError } from "../utils/websocketResponse.js";
import { throttle, type ThrottledFunction } from "../utils/throttle.js";
import type { I18nError } from "../utils/i18nError.js";

export type ThrottledProgressEmitter = ThrottledFunction<
  [number, string | I18nError]
>;

/**
 * 純函式：根據 error 內容判斷應回傳的 error code。
 * 優先檢查 i18n error 物件的 key（新格式），再退回字串比對（向後相容）。
 */
function resolveErrorCode(
  error: string | I18nError,
): "NOT_FOUND" | "VALIDATION_ERROR" {
  const isNotFound =
    (typeof error === "object" &&
      error !== null &&
      "key" in error &&
      /notFound|NotFound/.test(error.key)) ||
    (typeof error === "string" && error.includes("找不到"));
  return isNotFound ? "NOT_FOUND" : "VALIDATION_ERROR";
}

export function emitGitValidationError(
  connectionId: string,
  responseEvent: WebSocketResponseEvents,
  error: string | I18nError,
  requestId: string,
): void {
  const errorCode = resolveErrorCode(error);
  emitError(
    connectionId,
    responseEvent,
    error,
    null,
    requestId,
    undefined,
    errorCode,
  );
}

export async function validateRepositoryIsGit(
  connectionId: string,
  repositoryId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string,
): Promise<string | null> {
  const result = await getValidatedGitRepository(repositoryId);

  if (!result.success) {
    emitGitValidationError(
      connectionId,
      responseEvent,
      result.error,
      requestId,
    );
    return null;
  }

  return result.data.repositoryPath;
}

export interface WithValidatedGitRepositoryOptions {
  rejectWorktree?: { errorMessage: string | I18nError };
}

export function withValidatedGitRepository<T extends { repositoryId: string }>(
  responseEvent: WebSocketResponseEvents,
  handler: (
    connectionId: string,
    payload: T,
    requestId: string,
    repositoryPath: string,
  ) => Promise<void>,
  options?: WithValidatedGitRepositoryOptions,
) {
  return async (
    connectionId: string,
    payload: T,
    requestId: string,
  ): Promise<void> => {
    const repositoryPath = await validateRepositoryIsGit(
      connectionId,
      payload.repositoryId,
      responseEvent,
      requestId,
    );
    if (!repositoryPath) return;

    if (options?.rejectWorktree) {
      const isValid = validateNotWorktree(
        connectionId,
        payload.repositoryId,
        responseEvent,
        requestId,
        options.rejectWorktree.errorMessage,
      );
      if (!isValid) return;
    }

    await handler(connectionId, payload, requestId, repositoryPath);
  };
}

export function validateNotWorktree(
  connectionId: string,
  repositoryId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string,
  errorMessage: string | I18nError,
): boolean {
  const metadata = repositoryService.getMetadata(repositoryId);
  if (metadata?.parentRepoId) {
    emitError(
      connectionId,
      responseEvent,
      errorMessage,
      null,
      requestId,
      undefined,
      "INVALID_STATE",
    );
    return false;
  }
  return true;
}

export function createProgressEmitter(
  connectionId: string,
  requestId: string,
  eventType: WebSocketResponseEvents,
): (progress: number, message: string | I18nError) => void {
  return (progress: number, message: string | I18nError): void => {
    socketService.emitToConnection(connectionId, eventType, {
      requestId,
      progress,
      message,
    });
  };
}

export function createThrottledProgressEmitter(
  connectionId: string,
  requestId: string,
  eventType: WebSocketResponseEvents,
): ThrottledProgressEmitter {
  const emitProgress = createProgressEmitter(
    connectionId,
    requestId,
    eventType,
  );
  return throttle(emitProgress, 500);
}

function sanitizeRepoNameChars(raw: string): string {
  const withoutGitSuffix = raw.replace(/\.git$/, "").replace(/[^\w.-]/g, "-");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(withoutGitSuffix)) {
    return withoutGitSuffix.replace(/^[^a-zA-Z0-9]+/, "");
  }
  return withoutGitSuffix;
}

function ensureNonEmptyRepoName(name: string): string {
  return name.length > 0 ? name : "unnamed-repo";
}

function normalizeRepoName(rawName: string): string {
  return ensureNonEmptyRepoName(sanitizeRepoNameChars(rawName));
}

function parseSshRepoName(url: string): string {
  const pathPart = url.split(":")[1] ?? "";
  return normalizeRepoName(pathPart);
}

export function parseUrlRepoName(url: string): string {
  const withoutProtocol = url
    .replace(/^https?:\/\//, "")
    .replace(/^git:\/\//, "");
  const parts = withoutProtocol.split("/");
  const lastPart = parts[parts.length - 1] ?? "";
  return normalizeRepoName(lastPart);
}

export function parseRepoName(repoUrl: string): string {
  if (repoUrl.startsWith("git@")) {
    return parseSshRepoName(repoUrl);
  }
  return parseUrlRepoName(repoUrl);
}
