import { WebSocketResponseEvents } from "../schemas";
import type { RepositoryPullLatestResultPayload } from "../types";
import type { RepositoryPullLatestPayload } from "../schemas";
import { gitService } from "../services/workspace/gitService.js";
import { emitSuccess, emitError } from "../utils/websocketResponse.js";
import { logger } from "../utils/logger.js";
import { handleResultError } from "../utils/handlerHelpers.js";
import { createI18nError } from "../utils/i18nError.js";
import type { I18nError } from "../utils/i18nError.js";
import {
  withValidatedGitRepository,
  createProgressEmitter,
  createThrottledProgressEmitter,
  type ThrottledProgressEmitter,
} from "./repositoryGitHelpers.js";

/**
 * 模組單例，存活週期 = process lifetime。
 * 用途：in-memory 並發鎖，防止同一 repository 同時執行多個 pull 操作。
 * 測試時需注意隔離（每個測試前應確保此 Set 為空，或透過 module reset）。
 */
const pullingRepositories = new Set<string>();

/** executePullWithProgress 的回傳型別 */
interface PullProgressResult {
  gitPullResult: Awaited<ReturnType<typeof gitService.pullLatest>>;
  throttledEmit: ThrottledProgressEmitter;
  emitProgress: (progress: number, message: string | I18nError) => void;
}

async function withPullLock<T>(
  repositoryId: string,
  operation: () => Promise<T>,
): Promise<{ locked: true } | { locked: false; result: T }> {
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
  repositoryPath: string,
): Promise<PullProgressResult> {
  const emitProgress = createProgressEmitter(
    connectionId,
    requestId,
    WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS,
  );
  const throttledEmit = createThrottledProgressEmitter(
    connectionId,
    requestId,
    WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS,
  );

  emitProgress(0, createI18nError("progress.preparingPull"));

  const gitPullResult = await gitService.pullLatest(
    repositoryPath,
    (progress, message) => throttledEmit(progress, message),
  );
  return { gitPullResult, throttledEmit, emitProgress };
}

export const handleRepositoryPullLatest =
  withValidatedGitRepository<RepositoryPullLatestPayload>(
    WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
    async (connectionId, payload, requestId, repositoryPath) => {
      const { repositoryId } = payload;

      const lockResult = await withPullLock(repositoryId, () =>
        executePullWithProgress(connectionId, requestId, repositoryPath),
      );

      if (lockResult.locked) {
        emitError(
          connectionId,
          WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
          createI18nError("errors.repoPullInProgress"),
          null,
          requestId,
          undefined,
          "CONFLICT",
        );
        return;
      }

      const {
        gitPullResult: pullResult,
        throttledEmit,
        emitProgress,
      } = lockResult.result;

      if (!pullResult.success) {
        throttledEmit.cancel();
        handleResultError(
          pullResult,
          connectionId,
          WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
          requestId,
          createI18nError("errors.pullFailed"),
          null,
        );
        return;
      }

      throttledEmit.flush();
      emitProgress(100, createI18nError("progress.pullComplete"));

      const response: RepositoryPullLatestResultPayload = {
        requestId,
        success: true,
        repositoryId,
      };

      emitSuccess(
        connectionId,
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        response,
      );

      logger.log(
        "Repository",
        "Update",
        `已 Pull「${repositoryId}」的最新版本`,
      );
    },
    {
      rejectWorktree: {
        errorMessage: createI18nError("errors.worktreePullNotAllowed"),
      },
    },
  );
