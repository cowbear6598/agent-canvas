import { WebSocketResponseEvents } from '../schemas';
import { repositoryService } from '../services/repositoryService.js';
import { socketService } from '../services/socketService.js';
import { getValidatedGitRepository } from '../utils/validators.js';
import { emitError } from '../utils/websocketResponse.js';
import { throttle, type ThrottledFunction } from '../utils/throttle.js';

export type ThrottledProgressEmitter = ThrottledFunction<[number, string]>;

export function emitGitValidationError(
  connectionId: string,
  responseEvent: WebSocketResponseEvents,
  error: string,
  requestId: string
): void {
  const errorCode = error.includes('找不到') ? 'NOT_FOUND' : 'INVALID_STATE';
  emitError(connectionId, responseEvent, error, requestId, undefined, errorCode);
}

export async function validateRepositoryIsGit(
  connectionId: string,
  repositoryId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string
): Promise<string | null> {
  const result = await getValidatedGitRepository(repositoryId);

  if (!result.success) {
    emitGitValidationError(connectionId, responseEvent, result.error, requestId);
    return null;
  }

  return result.data.repositoryPath;
}

export interface WithValidatedGitRepositoryOptions {
  rejectWorktree?: { errorMessage: string };
}

export function withValidatedGitRepository<T extends { repositoryId: string }>(
  responseEvent: WebSocketResponseEvents,
  handler: (connectionId: string, payload: T, requestId: string, repositoryPath: string) => Promise<void>,
  options?: WithValidatedGitRepositoryOptions
) {
  return async (connectionId: string, payload: T, requestId: string): Promise<void> => {
    const repositoryPath = await validateRepositoryIsGit(connectionId, payload.repositoryId, responseEvent, requestId);
    if (!repositoryPath) return;

    if (options?.rejectWorktree) {
      const isValid = validateNotWorktree(connectionId, payload.repositoryId, responseEvent, requestId, options.rejectWorktree.errorMessage);
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
  errorMessage: string
): boolean {
  const metadata = repositoryService.getMetadata(repositoryId);
  if (metadata?.parentRepoId) {
    emitError(connectionId, responseEvent, errorMessage, requestId, undefined, 'INVALID_STATE');
    return false;
  }
  return true;
}

export function createProgressEmitter(
  connectionId: string,
  requestId: string,
  eventType: WebSocketResponseEvents
): (progress: number, message: string) => void {
  return (progress: number, message: string): void => {
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
  eventType: WebSocketResponseEvents
): ThrottledProgressEmitter {
  const emitProgress = createProgressEmitter(connectionId, requestId, eventType);
  return throttle(emitProgress, 500);
}



function sanitizeRepoNameChars(raw: string): string {
  const withoutGitSuffix = raw.replace(/\.git$/, '').replace(/[^\w.-]/g, '-');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(withoutGitSuffix)) {
    return withoutGitSuffix.replace(/^[^a-zA-Z0-9]+/, '');
  }
  return withoutGitSuffix;
}

function ensureNonEmptyRepoName(name: string): string {
  return name.length > 0 ? name : 'unnamed-repo';
}

function normalizeRepoName(rawName: string): string {
  return ensureNonEmptyRepoName(sanitizeRepoNameChars(rawName));
}

function parseSshRepoName(url: string): string {
  const pathPart = url.split(':')[1] ?? '';
  return normalizeRepoName(pathPart);
}

export function parseUrlRepoName(url: string): string {
  const withoutProtocol = url.replace(/^https?:\/\//, '').replace(/^git:\/\//, '');
  const parts = withoutProtocol.split('/');
  const lastPart = parts[parts.length - 1] ?? '';
  return normalizeRepoName(lastPart);
}

export function parseRepoName(repoUrl: string): string {
  if (repoUrl.startsWith('git@')) {
    return parseSshRepoName(repoUrl);
  }
  return parseUrlRepoName(repoUrl);
}
