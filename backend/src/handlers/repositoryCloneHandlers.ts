import { WebSocketResponseEvents } from "../schemas";
import type {
  RepositoryGitCloneResultPayload,
  RepositoryCheckGitResultPayload,
} from "../types";
import type {
  RepositoryGitClonePayload,
  RepositoryCheckGitPayload,
} from "../schemas";
import { repositoryService } from "../services/repositoryService.js";
import { gitService } from "../services/workspace/gitService.js";
import { emitSuccess, emitError } from "../utils/websocketResponse.js";
import { logger } from "../utils/logger.js";
import type { Result } from "../types";
import { ok } from "../types";
import { validateRepositoryExists } from "../utils/validators.js";
import { handleResultError } from "../utils/handlerHelpers.js";
import { createI18nError } from "../utils/i18nError.js";
import { errI18n, getResultErrorString } from "../types/result.js";
import { getGitStageMessage } from "../utils/operationHelpers.js";
import { throttle } from "../utils/throttle.js";
import {
  createProgressEmitter,
  parseRepoName,
} from "./repositoryGitHelpers.js";

const MAX_REPO_URL_LENGTH = 500;
const CLONE_PROGRESS_START_OFFSET = 10;
const CLONE_PROGRESS_SCALE_FACTOR = 0.8;
const CLONE_PROGRESS_NEAR_COMPLETE = 95;
const CLONE_PROGRESS_COMPLETE = 100;

function validateRepoUrl(repoUrl: string): Result<void> {
  if (repoUrl.length > MAX_REPO_URL_LENGTH) {
    return errI18n(createI18nError("errors.repoUrlTooLong"));
  }

  const isHttpsUrl = /^https:\/\/[^\s]+$/.test(repoUrl);
  const isSshUrl = /^git@[^\s:]+:[^\s]+$/.test(repoUrl);

  if (!isHttpsUrl && !isSshUrl) {
    return errI18n(createI18nError("errors.repoUrlInvalidFormat"));
  }

  if (isHttpsUrl && repoUrl.includes("@")) {
    return errI18n(createI18nError("errors.httpsUrlAuthNotAllowed"));
  }

  return ok();
}

async function executeAndValidateClone(
  repoUrl: string,
  repoName: string,
  branch: string | undefined,
  emitProgress: (progress: number, message: string) => void,
): Promise<{ success: true } | { success: false; error: string | import("../utils/i18nError.js").I18nError }> {
  const targetPath = repositoryService.getRepositoryPath(repoName);
  const throttledEmit = throttle(emitProgress, 500);

  const cloneResult = await gitService.clone(repoUrl, targetPath, {
    branch,
    onProgress: (progressData) => {
      const mappedProgress = Math.floor(
        CLONE_PROGRESS_START_OFFSET +
          progressData.progress * CLONE_PROGRESS_SCALE_FACTOR,
      );
      const stageMessage = getGitStageMessage(progressData.stage);
      throttledEmit(mappedProgress, stageMessage);
    },
  });

  if (!cloneResult.success) {
    throttledEmit.cancel();
    await repositoryService.delete(repoName);
    return { success: false, error: cloneResult.error };
  }

  throttledEmit.flush();
  return { success: true };
}

async function registerCloneMetadata(repoName: string): Promise<void> {
  const targetPath = repositoryService.getRepositoryPath(repoName);
  const currentBranchResult = await gitService.getCurrentBranch(targetPath);
  if (currentBranchResult.success) {
    await repositoryService.registerMetadata(repoName, {
      currentBranch: currentBranchResult.data,
    });
  }
}

export async function handleRepositoryGitClone(
  connectionId: string,
  payload: RepositoryGitClonePayload,
  requestId: string,
): Promise<void> {
  const { repoUrl, branch } = payload;

  const validation = validateRepoUrl(repoUrl);
  if (
    handleResultError(
      validation,
      connectionId,
      WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
      requestId,
      createI18nError("errors.repoUrlValidationFailed"),
      "INVALID_INPUT",
    )
  )
    return;

  const repoName = parseRepoName(repoUrl);

  const emitCloneProgress = createProgressEmitter(
    connectionId,
    requestId,
    WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
  );

  emitCloneProgress(0, "開始 Git clone...");

  const exists = await repositoryService.exists(repoName);
  if (exists) {
    emitError(
      connectionId,
      WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
      createI18nError("errors.repoExists", { name: repoName }),
      requestId,
      undefined,
      "ALREADY_EXISTS",
    );
    return;
  }

  await repositoryService.create(repoName);
  emitCloneProgress(5, "Repository 已建立，開始 clone...");

  const cloneResult = await executeAndValidateClone(
    repoUrl,
    repoName,
    branch,
    emitCloneProgress,
  );
  if (!cloneResult.success) {
    logger.error('Repository', 'Error', `複製儲存庫失敗：${getResultErrorString(cloneResult.error)}`);
    emitError(
      connectionId,
      WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
      createI18nError("errors.repoCloneFailed"),
      requestId,
      undefined,
      "INTERNAL_ERROR",
    );
    return;
  }

  emitCloneProgress(CLONE_PROGRESS_NEAR_COMPLETE, "完成中...");
  await registerCloneMetadata(repoName);
  emitCloneProgress(CLONE_PROGRESS_COMPLETE, "Clone 完成!");

  const response: RepositoryGitCloneResultPayload = {
    requestId,
    success: true,
    repository: { id: repoName, name: repoName },
  };

  emitSuccess(
    connectionId,
    WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
    response,
  );

  logger.log(
    "Repository",
    "Create",
    `成功 clone Repository「${repoName}」${branch ? `（分支：${branch}）` : ""}`,
  );
}

export async function handleRepositoryCheckGit(
  connectionId: string,
  payload: RepositoryCheckGitPayload,
  requestId: string,
): Promise<void> {
  const { repositoryId } = payload;

  const validateResult = await validateRepositoryExists(repositoryId);
  if (
    handleResultError(
      validateResult,
      connectionId,
      WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
      requestId,
      createI18nError("errors.repoNotFound"),
      "NOT_FOUND",
    )
  )
    return;

  const repositoryPath = validateResult.data;
  const result = await gitService.isGitRepository(repositoryPath);

  if (
    handleResultError(
      result,
      connectionId,
      WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
      requestId,
      createI18nError("errors.gitCheckFailed"),
    )
  )
    return;

  const response: RepositoryCheckGitResultPayload = {
    requestId,
    success: true,
    isGit: result.data,
  };

  logger.log(
    "Repository",
    "Check",
    `Repository「${repositoryId}」是否為 Git Repo：${result.data}`,
  );

  emitSuccess(
    connectionId,
    WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
    response,
  );
}
