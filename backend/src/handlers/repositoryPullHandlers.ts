import { WebSocketResponseEvents } from '../schemas';
import type { RepositoryPullLatestResultPayload } from '../types';
import type { RepositoryPullLatestPayload } from '../schemas';
import { gitService } from '../services/workspace/gitService.js';
import { emitSuccess, emitError } from '../utils/websocketResponse.js';
import { logger } from '../utils/logger.js';
import { handleResultError } from '../utils/handlerHelpers.js';
import {
  withValidatedGitRepository,
  createProgressEmitter,
  createThrottledProgressEmitter,
  type ThrottledProgressEmitter,
} from './repositoryGitHelpers.js';

const pullingRepositories = new Set<string>();

async function withPullLock<T>(repositoryId: string, operation: () => Promise<T>): Promise<{ locked: true } | { locked: false; result: T }> {
  if (pullingRepositories.has(repositoryId)) {
    return { locked: true };
  }
  pullingRepositories.add(repositoryId);
  try {
    const result = await operation();
    return { locked: false, result };
  } finally {
    pullingRepositories.delete(repositoryId);
  }
}

async function executePullWithProgress(
  connectionId: string,
  requestId: string,
  repositoryPath: string
): Promise<{ gitPullResult: Awaited<ReturnType<typeof gitService.pullLatest>>; throttledEmit: ThrottledProgressEmitter; emitProgress: (progress: number, message: string) => void }> {
  const emitProgress = createProgressEmitter(connectionId, requestId, WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS);
  const throttledEmit = createThrottledProgressEmitter(
    connectionId,
    requestId,
    WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS
  );

  emitProgress(0, '準備 Pull...');

  const gitPullResult = await gitService.pullLatest(repositoryPath, (progress, message) => throttledEmit(progress, message));
  return { gitPullResult, throttledEmit, emitProgress };
}

export const handleRepositoryPullLatest = withValidatedGitRepository<RepositoryPullLatestPayload>(
  WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId } = payload;

    const lockResult = await withPullLock(repositoryId, () => executePullWithProgress(connectionId, requestId, repositoryPath));

    if (lockResult.locked) {
      emitError(
        connectionId,
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        '此 Repository 已有 Pull 操作進行中',
        requestId,
        undefined,
        'CONFLICT'
      );
      return;
    }

    const { gitPullResult: pullResult, throttledEmit, emitProgress } = lockResult.result;

    if (!pullResult.success) {
      throttledEmit.cancel();
      handleResultError(pullResult, connectionId, WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, requestId, 'Pull 失敗');
      return;
    }

    throttledEmit.flush();
    emitProgress(100, 'Pull 完成');

    const response: RepositoryPullLatestResultPayload = {
      requestId,
      success: true,
      repositoryId,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, response);

    logger.log('Repository', 'Update', `已 Pull「${repositoryId}」的最新版本`);
  },
  { rejectWorktree: { errorMessage: 'Worktree 無法執行 Pull' } }
);
