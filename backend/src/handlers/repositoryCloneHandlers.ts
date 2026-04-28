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
// Clone 進度條設計說明：
// START_OFFSET=10：git clone 開始前的前置驗證（URL 合法性、重複偵測、目錄建立）
//   保留 0–10% 給前置階段，clone 實際進度從 10% 起算。
// SCALE_FACTOR=0.8：git fetch/clone 回報的進度（0–100）映射到 10–90% 區間，
//   預留後段給 clone 完成後的後置作業（repository 建立、資源同步等）。
// NEAR_COMPLETE=95：後置作業（建立 repository 記錄、同步資源）完成前的過渡進度，
//   避免長尾作業讓進度卡在 90% 給使用者感覺停頓。
// COMPLETE=100：所有流程結束後發送，代表 clone 完整完成。
const CLONE_PROGRESS_START_OFFSET = 10;
const CLONE_PROGRESS_SCALE_FACTOR = 0.8;
const CLONE_PROGRESS_NEAR_COMPLETE = 95;
const CLONE_PROGRESS_COMPLETE = 100;

function validateRepoUrl(repoUrl: string): Result<void> {
  if (repoUrl.length > MAX_REPO_URL_LENGTH) {
    return errI18n(createI18nError("errors.repoUrlTooLong"));
  }

  // CRLF 注入防護：URL 中包含 \r 或 \n 可能被用於 HTTP header 注入攻擊
  if (/[\r\n]/.test(repoUrl)) {
    return errI18n(createI18nError("errors.repoUrlInvalidFormat"));
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
): Promise<
  | { success: true }
  | {
      success: false;
      error: string | import("../utils/i18nError.js").I18nError;
    }
> {
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
      null,
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

  emitCloneProgress(0, createI18nError("progress.repositoryCloneStart"));

  const exists = await repositoryService.exists(repoName);
  if (exists) {
    emitError(
      connectionId,
      WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
      createI18nError("errors.repoExists", { name: repoName }),
      null,
      requestId,
      undefined,
      "ALREADY_EXISTS",
    );
    return;
  }

  await repositoryService.create(repoName);
  emitCloneProgress(5, createI18nError("progress.repositoryCreated"));

  const cloneResult = await executeAndValidateClone(
    repoUrl,
    repoName,
    branch,
    emitCloneProgress,
  );
  if (!cloneResult.success) {
    logger.error(
      "Repository",
      "Error",
      `複製儲存庫失敗：${getResultErrorString(cloneResult.error)}`,
    );
    emitError(
      connectionId,
      WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
      createI18nError("errors.repoCloneFailed"),
      null,
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
      null,
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
      null,
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
