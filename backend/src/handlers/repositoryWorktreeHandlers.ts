import { WebSocketResponseEvents } from "../schemas";
import type { RepositoryWorktreeCreatedPayload } from "../types";
import type { RepositoryWorktreeCreatePayload } from "../schemas";
import { repositoryService } from "../services/repositoryService.js";
import { socketService } from "../services/socketService.js";
import { gitService } from "../services/workspace/gitService.js";
import { emitError } from "../utils/websocketResponse.js";
import { createI18nError, type I18nError } from "../utils/i18nError.js";
import { logger } from "../utils/logger.js";
import { getValidatedGitRepository } from "../utils/validators.js";
import { isPathWithinDirectory } from "../utils/pathValidator.js";
import { directoryExists } from "../services/shared/fileResourceHelpers.js";
import { config } from "../config";
import path from "path";
import { emitGitValidationError } from "./repositoryGitHelpers.js";

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

type WorktreeValidationError = {
  error: string | I18nError;
  errorCode: string;
} | null;

async function checkHasCommits(
  repositoryPath: string,
): Promise<WorktreeValidationError> {
  const hasCommitsResult = await gitService.hasCommits(repositoryPath);
  if (!hasCommitsResult.success || !hasCommitsResult.data) {
    return {
      error: createI18nError("errors.repoNoCommits"),
      errorCode: "INVALID_STATE",
    };
  }
  return null;
}

async function checkTargetPathSafety(
  repositoryId: string,
  worktreeName: string,
): Promise<WorktreeValidationError> {
  if (!SAFE_ID_PATTERN.test(repositoryId)) {
    return {
      error: createI18nError("errors.invalidRepoIdFormat"),
      errorCode: "INVALID_INPUT",
    };
  }

  const parentDirectory = repositoryService.getParentDirectory();
  const newRepositoryId = `${repositoryId}-${worktreeName}`;
  const targetPath = path.join(parentDirectory, newRepositoryId);

  if (!isPathWithinDirectory(targetPath, config.repositoriesRoot)) {
    return {
      error: createI18nError("errors.invalidWorktreePath"),
      errorCode: "INVALID_PATH",
    };
  }

  const targetExists = await directoryExists(targetPath);
  if (targetExists) {
    return {
      error: createI18nError("errors.directoryExists", {
        name: newRepositoryId,
      }),
      errorCode: "ALREADY_EXISTS",
    };
  }

  return null;
}

async function checkBranchAvailability(
  repositoryPath: string,
  worktreeName: string,
): Promise<WorktreeValidationError> {
  const branchExistsResult = await gitService.branchExists(
    repositoryPath,
    worktreeName,
  );
  if (!branchExistsResult.success) {
    return { error: branchExistsResult.error, errorCode: "INTERNAL_ERROR" };
  }

  if (branchExistsResult.data) {
    return {
      error: createI18nError("errors.branchExists", { name: worktreeName }),
      errorCode: "ALREADY_EXISTS",
    };
  }

  return null;
}

async function validateWorktreePrerequisites(
  repositoryPath: string,
  repositoryId: string,
  worktreeName: string,
): Promise<WorktreeValidationError> {
  const commitsError = await checkHasCommits(repositoryPath);
  if (commitsError) return commitsError;
  const pathSafetyError = await checkTargetPathSafety(
    repositoryId,
    worktreeName,
  );
  if (pathSafetyError) return pathSafetyError;
  const branchError = await checkBranchAvailability(
    repositoryPath,
    worktreeName,
  );
  if (branchError) return branchError;
  return null;
}

export async function handleRepositoryWorktreeCreate(
  connectionId: string,
  payload: RepositoryWorktreeCreatePayload,
  requestId: string,
): Promise<void> {
  const { repositoryId, worktreeName } = payload;
  const responseEvent = WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED;

  const validateResult = await getValidatedGitRepository(repositoryId);
  if (!validateResult.success) {
    emitGitValidationError(
      connectionId,
      responseEvent,
      validateResult.error,
      requestId,
    );
    return;
  }

  const repositoryPath = validateResult.data.repositoryPath;

  const prerequisiteError = await validateWorktreePrerequisites(
    repositoryPath,
    repositoryId,
    worktreeName,
  );
  if (prerequisiteError) {
    emitError(
      connectionId,
      responseEvent,
      prerequisiteError.error,
      null,
      requestId,
      undefined,
      prerequisiteError.errorCode,
    );
    return;
  }

  const parentDirectory = repositoryService.getParentDirectory();
  const newRepositoryId = `${repositoryId}-${worktreeName}`;
  const targetPath = path.join(parentDirectory, newRepositoryId);

  const createResult = await gitService.createWorktree(
    repositoryPath,
    targetPath,
    worktreeName,
  );
  if (!createResult.success) {
    logger.error(
      "Repository",
      "Error",
      `建立 Worktree 失敗：${createResult.error}`,
    );
    emitError(
      connectionId,
      responseEvent,
      createI18nError("errors.worktreeCreateFailed"),
      null,
      requestId,
      undefined,
      "INTERNAL_ERROR",
    );
    return;
  }

  await repositoryService.registerMetadata(newRepositoryId, {
    parentRepoId: repositoryId,
    branchName: worktreeName,
  });

  const repository = {
    id: newRepositoryId,
    name: newRepositoryId,
    parentRepoId: repositoryId,
    branchName: worktreeName,
  };

  const response: RepositoryWorktreeCreatedPayload = {
    requestId,
    canvasId: payload.canvasId,
    success: true,
    repository,
  };

  socketService.emitToCanvas(payload.canvasId, responseEvent, response);

  logger.log(
    "Repository",
    "Create",
    `已從「${repositoryId}」建立 Worktree「${newRepositoryId}」`,
  );
}
