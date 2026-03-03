import { WebSocketResponseEvents } from '../schemas';
import type {
  RepositoryGitCloneResultPayload,
  RepositoryCheckGitResultPayload,
  RepositoryWorktreeCreatedPayload,
  RepositoryLocalBranchesResultPayload,
  RepositoryDirtyCheckResultPayload,
  RepositoryCheckoutBranchProgressPayload,
  RepositoryBranchCheckedOutPayload,
  RepositoryBranchDeletedPayload,
  RepositoryPullLatestResultPayload,
  BroadcastRepositoryBranchChangedPayload,
} from '../types';
import type {
  RepositoryGitClonePayload,
  RepositoryCheckGitPayload,
  RepositoryWorktreeCreatePayload,
  RepositoryGetLocalBranchesPayload,
  RepositoryCheckDirtyPayload,
  RepositoryCheckoutBranchPayload,
  RepositoryDeleteBranchPayload,
  RepositoryPullLatestPayload,
} from '../schemas';
import { repositoryService } from '../services/repositoryService.js';
import { socketService } from '../services/socketService.js';
import { gitService } from '../services/workspace/gitService.js';
import { emitSuccess, emitError } from '../utils/websocketResponse.js';
import { logger } from '../utils/logger.js';
import type { Result } from '../types';
import { ok } from '../types';
import { validateRepositoryExists, getValidatedGitRepository } from '../utils/validators.js';
import { handleResultError } from '../utils/handlerHelpers.js';
import { getGitStageMessage } from '../utils/operationHelpers.js';
import { throttle } from '../utils/throttle.js';
import { directoryExists } from '../services/shared/fileResourceHelpers.js';
import { isPathWithinDirectory } from '../utils/pathValidator.js';
import { config } from '../config';
import path from 'path';

const pullingRepositories = new Set<string>();

const MAX_REPO_URL_LENGTH = 500;

async function validateRepositoryIsGit(
  connectionId: string,
  repositoryId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string
): Promise<string | null> {
  const result = await getValidatedGitRepository(repositoryId);

  if (!result.success) {
    const errorCode = result.error.includes('找不到') ? 'NOT_FOUND' : 'INVALID_STATE';
    emitError(connectionId, responseEvent, result.error, requestId, undefined, errorCode);
    return null;
  }

  return result.data.repositoryPath;
}

function withValidatedGitRepository<T extends { repositoryId: string }>(
  responseEvent: WebSocketResponseEvents,
  handler: (connectionId: string, payload: T, requestId: string, repositoryPath: string) => Promise<void>
) {
  return async (connectionId: string, payload: T, requestId: string): Promise<void> => {
    const repositoryPath = await validateRepositoryIsGit(connectionId, payload.repositoryId, responseEvent, requestId);
    if (!repositoryPath) return;
    await handler(connectionId, payload, requestId, repositoryPath);
  };
}

function validateRepoUrl(repoUrl: string): Result<void> {
  if (repoUrl.length > MAX_REPO_URL_LENGTH) {
    return { success: false, error: 'Repository URL 長度超過限制' };
  }

  const isHttpsUrl = /^https:\/\/[^\s]+$/.test(repoUrl);
  const isSshUrl = /^git@[^\s:]+:[^\s]+$/.test(repoUrl);

  if (!isHttpsUrl && !isSshUrl) {
    return { success: false, error: 'Repository URL 格式不正確' };
  }

  return ok();
}


function createProgressEmitter(
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

type ThrottledProgressEmitter = ((progress: number, message: string) => void) & {
  cancel: () => void;
  flush: () => void;
};

function createThrottledProgressEmitter(
  connectionId: string,
  requestId: string,
  eventType: WebSocketResponseEvents
): ThrottledProgressEmitter {
  const emitProgress = createProgressEmitter(connectionId, requestId, eventType);
  return throttle(emitProgress, 500) as ThrottledProgressEmitter;
}

function validateNotWorktree(
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

function normalizeRepoName(rawName: string): string {
  const withoutGit = rawName.replace(/\.git$/, '');
  if (!withoutGit.match(/^[a-zA-Z0-9_-]+$/)) {
    return withoutGit.replace(/[^a-zA-Z0-9_-]/g, '-');
  }
  return withoutGit;
}

function parseSshRepoName(url: string): string {
  const pathPart = url.split(':')[1] || '';
  return normalizeRepoName(pathPart);
}

function parseHttpsRepoName(url: string): string {
  const withoutProtocol = url.replace(/^https?:\/\//, '').replace(/^git:\/\//, '');
  const parts = withoutProtocol.split('/');
  const lastPart = parts[parts.length - 1] || '';
  return normalizeRepoName(lastPart);
}

function parseRepoName(repoUrl: string): string {
  if (repoUrl.startsWith('git@')) {
    return parseSshRepoName(repoUrl);
  }
  return parseHttpsRepoName(repoUrl);
}

async function executeAndValidateClone(
  repoUrl: string,
  repoName: string,
  branch: string | undefined,
  emitProgress: (progress: number, message: string) => void
): Promise<{ success: true } | { success: false; error: string }> {
  const targetPath = repositoryService.getRepositoryPath(repoName);
  const throttledEmit = throttle(emitProgress, 500);

  const cloneResult = await gitService.clone(repoUrl, targetPath, {
    branch,
    onProgress: (progressData) => {
      const mappedProgress = Math.floor(10 + (progressData.progress * 0.8));
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
      currentBranch: currentBranchResult.data
    });
  }
}

export async function handleRepositoryGitClone(
  connectionId: string,
  payload: RepositoryGitClonePayload,
  requestId: string
): Promise<void> {
  const { repoUrl, branch } = payload;

  const validation = validateRepoUrl(repoUrl);
  if (handleResultError(validation, connectionId, WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT, requestId, 'Repository URL 驗證失敗', 'INVALID_INPUT')) return;

  const repoName = parseRepoName(repoUrl);

  const emitCloneProgress = createProgressEmitter(
    connectionId,
    requestId,
    WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS
  );

  emitCloneProgress(0, '開始 Git clone...');

  const exists = await repositoryService.exists(repoName);
  if (exists) {
    emitError(
      connectionId,
      WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
      `Repository 已存在: ${repoName}`,
      requestId,
      undefined,
      'ALREADY_EXISTS'
    );
    return;
  }

  await repositoryService.create(repoName);
  emitCloneProgress(5, 'Repository 已建立，開始 clone...');

  const cloneResult = await executeAndValidateClone(repoUrl, repoName, branch, emitCloneProgress);
  if (!cloneResult.success) {
    emitError(connectionId, WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT, cloneResult.error, requestId, undefined, 'INTERNAL_ERROR');
    return;
  }

  emitCloneProgress(95, '完成中...');
  await registerCloneMetadata(repoName);
  emitCloneProgress(100, 'Clone 完成!');

  const response: RepositoryGitCloneResultPayload = {
    requestId,
    success: true,
    repository: { id: repoName, name: repoName },
  };

  emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT, response);

  logger.log('Repository', 'Create', `成功 clone Repository「${repoName}」${branch ? `（分支：${branch}）` : ''}`);
}

export async function handleRepositoryCheckGit(
  connectionId: string,
  payload: RepositoryCheckGitPayload,
  requestId: string
): Promise<void> {
  const { repositoryId } = payload;

  const validateResult = await validateRepositoryExists(repositoryId);
  if (handleResultError(validateResult, connectionId, WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT, requestId, '找不到 Repository', 'NOT_FOUND')) return;

  const repositoryPath = validateResult.data;
  const result = await gitService.isGitRepository(repositoryPath);

  if (handleResultError(result, connectionId, WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT, requestId, '檢查 Git Repository 失敗')) return;

  const response: RepositoryCheckGitResultPayload = {
    requestId,
    success: true,
    isGit: result.data,
  };

  logger.log('Repository', 'Check', `Repository「${repositoryId}」是否為 Git Repo：${result.data}`);

  emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT, response);
}

type WorktreeValidationError = { error: string; errorCode: string } | null;

async function checkHasCommits(repositoryPath: string): Promise<WorktreeValidationError> {
  const hasCommitsResult = await gitService.hasCommits(repositoryPath);
  if (!hasCommitsResult.success || !hasCommitsResult.data) {
    return { error: 'Repository 沒有任何 commit，無法建立 Worktree', errorCode: 'INVALID_STATE' };
  }
  return null;
}

async function checkTargetPathSafety(repositoryId: string, worktreeName: string): Promise<WorktreeValidationError> {
  const parentDirectory = repositoryService.getParentDirectory();
  const newRepositoryId = `${repositoryId}-${worktreeName}`;
  const targetPath = path.join(parentDirectory, newRepositoryId);

  if (!isPathWithinDirectory(targetPath, config.repositoriesRoot)) {
    return { error: '無效的 worktree 路徑', errorCode: 'INVALID_PATH' };
  }

  const targetExists = await directoryExists(targetPath);
  if (targetExists) {
    return { error: `資料夾已存在: ${newRepositoryId}`, errorCode: 'ALREADY_EXISTS' };
  }

  return null;
}

async function checkBranchAvailability(repositoryPath: string, worktreeName: string): Promise<WorktreeValidationError> {
  const branchExistsResult = await gitService.branchExists(repositoryPath, worktreeName);
  if (!branchExistsResult.success) {
    return { error: branchExistsResult.error, errorCode: 'INTERNAL_ERROR' };
  }

  if (branchExistsResult.data) {
    return { error: `分支已存在: ${worktreeName}`, errorCode: 'ALREADY_EXISTS' };
  }

  return null;
}

async function validateWorktreePrerequisites(
  repositoryPath: string,
  repositoryId: string,
  worktreeName: string
): Promise<WorktreeValidationError> {
  return (
    (await checkHasCommits(repositoryPath)) ??
    (await checkTargetPathSafety(repositoryId, worktreeName)) ??
    (await checkBranchAvailability(repositoryPath, worktreeName))
  );
}

export async function handleRepositoryWorktreeCreate(
  connectionId: string,
  payload: RepositoryWorktreeCreatePayload,
  requestId: string
): Promise<void> {
  const { repositoryId, worktreeName } = payload;
  const responseEvent = WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED;

  const validateResult = await getValidatedGitRepository(repositoryId);
  if (!validateResult.success) {
    const errorCode = validateResult.error.includes('找不到') ? 'NOT_FOUND' : 'INVALID_STATE';
    emitError(connectionId, responseEvent, validateResult.error, requestId, undefined, errorCode);
    return;
  }

  const repositoryPath = validateResult.data.repositoryPath;

  const prerequisiteError = await validateWorktreePrerequisites(repositoryPath, repositoryId, worktreeName);
  if (prerequisiteError) {
    emitError(connectionId, responseEvent, prerequisiteError.error, requestId, undefined, prerequisiteError.errorCode);
    return;
  }

  const parentDirectory = repositoryService.getParentDirectory();
  const newRepositoryId = `${repositoryId}-${worktreeName}`;
  const targetPath = path.join(parentDirectory, newRepositoryId);

  const createResult = await gitService.createWorktree(repositoryPath, targetPath, worktreeName);
  if (!createResult.success) {
    emitError(connectionId, responseEvent, `建立 Worktree 失敗: ${createResult.error}`, requestId, undefined, 'INTERNAL_ERROR');
    return;
  }

  await repositoryService.registerMetadata(newRepositoryId, {
    parentRepoId: repositoryId,
    branchName: worktreeName
  });

  const repository = {
    id: newRepositoryId,
    name: newRepositoryId,
    parentRepoId: repositoryId,
    branchName: worktreeName
  };

  const response: RepositoryWorktreeCreatedPayload = {
    requestId,
    canvasId: payload.canvasId,
    success: true,
    repository,
  };

  socketService.emitToCanvas(payload.canvasId, responseEvent, response);

  logger.log('Repository', 'Create', `已從「${repositoryId}」建立 Worktree「${newRepositoryId}」`);
}

export const handleRepositoryGetLocalBranches = withValidatedGitRepository<RepositoryGetLocalBranchesPayload>(
  WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId } = payload;

    const branchesResult = await gitService.getLocalBranches(repositoryPath);
    if (handleResultError(branchesResult, connectionId, WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT, requestId, '取得本地分支失敗')) return;

    const response: RepositoryLocalBranchesResultPayload = {
      requestId,
      success: true,
      branches: branchesResult.data.branches,
      currentBranch: branchesResult.data.current,
      worktreeBranches: branchesResult.data.worktreeBranches,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT, response);
    logger.log('Repository', 'List', `已取得「${repositoryId}」的本地分支清單`);
  }
);

export const handleRepositoryCheckDirty = withValidatedGitRepository<RepositoryCheckDirtyPayload>(
  WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId } = payload;

    const dirtyResult = await gitService.hasUncommittedChanges(repositoryPath);
    if (handleResultError(dirtyResult, connectionId, WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT, requestId, '檢查未提交變更失敗')) return;

    const response: RepositoryDirtyCheckResultPayload = {
      requestId,
      success: true,
      isDirty: dirtyResult.data,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT, response);
    logger.log('Repository', 'Check', `已檢查「${repositoryId}」的未提交狀態：${dirtyResult.data}`);
  }
);

export const handleRepositoryCheckoutBranch = withValidatedGitRepository<RepositoryCheckoutBranchPayload>(
  WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId, branchName, force } = payload;

    const isValid = validateNotWorktree(
      connectionId,
      repositoryId,
      WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
      requestId,
      'Worktree 無法切換分支'
    );
    if (!isValid) return;

    const throttledEmit = createThrottledProgressEmitter(
      connectionId,
      requestId,
      WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS
    );

    const emitCheckoutProgress = (progress: number, message: string): void => {
      const progressPayload: RepositoryCheckoutBranchProgressPayload = {
        requestId,
        progress,
        message,
        branchName,
      };
      socketService.emitToConnection(connectionId, WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS, progressPayload);
    };

    emitCheckoutProgress(0, '準備切換分支...');

    const checkoutResult = await gitService.smartCheckoutBranch(repositoryPath, branchName, {
      force,
      onProgress: (progress, message) => throttledEmit(progress, message),
    });

    if (!checkoutResult.success) {
      throttledEmit.cancel();
      if (handleResultError(checkoutResult, connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, requestId, '切換分支失敗')) return;
    }

    throttledEmit.flush();

    const action = checkoutResult.data;
    const completionMessage = action === 'created' ? '分支建立完成' : '切換完成';
    emitCheckoutProgress(100, completionMessage);

    const metadata = repositoryService.getMetadata(repositoryId);
    await repositoryService.registerMetadata(repositoryId, {
      ...metadata,
      currentBranch: branchName
    });

    const response: RepositoryBranchCheckedOutPayload = {
      requestId,
      success: true,
      repositoryId,
      branchName,
      action,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, response);

    const broadcastPayload: BroadcastRepositoryBranchChangedPayload = {
      repositoryId,
      branchName,
    };
    socketService.emitToAllExcept(connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_CHANGED, broadcastPayload);

    logger.log('Repository', 'Update', `已切換「${repositoryId}」的分支至「${branchName}」（${action}）`);
  }
);

export const handleRepositoryDeleteBranch = withValidatedGitRepository<RepositoryDeleteBranchPayload>(
  WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId, branchName, force } = payload;

    const deleteResult = await gitService.deleteBranch(repositoryPath, branchName, force);
    if (handleResultError(deleteResult, connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED, requestId, '刪除分支失敗')) return;

    const response: RepositoryBranchDeletedPayload = {
      requestId,
      success: true,
      branchName,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED, response);

    logger.log('Repository', 'Update', `已從「${repositoryId}」刪除分支「${branchName}」`);
  }
);

export const handleRepositoryPullLatest = withValidatedGitRepository<RepositoryPullLatestPayload>(
  WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId } = payload;

    const isValid = validateNotWorktree(
      connectionId,
      repositoryId,
      WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
      requestId,
      'Worktree 無法執行 Pull'
    );
    if (!isValid) return;

    if (pullingRepositories.has(repositoryId)) {
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

    pullingRepositories.add(repositoryId);

    const emitPullProgress = createProgressEmitter(
      connectionId,
      requestId,
      WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS
    );

    const throttledEmit = createThrottledProgressEmitter(
      connectionId,
      requestId,
      WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS
    );

    emitPullProgress(0, '準備 Pull...');

    const pullResult = await gitService.pullLatest(repositoryPath, (progress, message) => throttledEmit(progress, message)).finally(() => {
      pullingRepositories.delete(repositoryId);
    });

    if (!pullResult.success) {
      throttledEmit.cancel();
      handleResultError(pullResult, connectionId, WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, requestId, 'Pull 失敗');
      return;
    }

    throttledEmit.flush();
    emitPullProgress(100, 'Pull 完成');

    const response: RepositoryPullLatestResultPayload = {
      requestId,
      success: true,
      repositoryId,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT, response);

    logger.log('Repository', 'Update', `已 Pull「${repositoryId}」的最新版本`);
  }
);
