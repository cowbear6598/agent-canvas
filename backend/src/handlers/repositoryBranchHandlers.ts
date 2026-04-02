import { WebSocketResponseEvents } from '../schemas';
import type {
  RepositoryLocalBranchesResultPayload,
  RepositoryDirtyCheckResultPayload,
  RepositoryBranchCheckedOutPayload,
  RepositoryBranchDeletedPayload,
  BroadcastRepositoryBranchChangedPayload,
} from '../types';
import type {
  RepositoryGetLocalBranchesPayload,
  RepositoryCheckDirtyPayload,
  RepositoryCheckoutBranchPayload,
  RepositoryDeleteBranchPayload,
} from '../schemas';
import { repositoryService } from '../services/repositoryService.js';
import { socketService } from '../services/socketService.js';
import { gitService } from '../services/workspace/gitService.js';
import { emitSuccess, emitError } from '../utils/websocketResponse.js';
import { logger } from '../utils/logger.js';
import { handleResultError } from '../utils/handlerHelpers.js';
import { createI18nError } from '../utils/i18nError.js';
import {
  withValidatedGitRepository,
  createThrottledProgressEmitter,
} from './repositoryGitHelpers.js';

type CheckoutAction = 'switched' | 'fetched' | 'created';

interface CheckoutProgressParams {
  connectionId: string;
  requestId: string;
  repositoryPath: string;
  branchName: string;
  force?: boolean;
}

async function performCheckoutWithProgress(
  params: CheckoutProgressParams
): Promise<{ success: false } | { success: true; action: CheckoutAction }> {
  const { connectionId, requestId, repositoryPath, branchName, force } = params;

  const throttledEmit = createThrottledProgressEmitter(
    connectionId,
    requestId,
    WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS
  );

  throttledEmit(0, createI18nError('progress.preparingCheckout'));

  const checkoutResult = await gitService.smartCheckoutBranch(repositoryPath, branchName, {
    force,
    onProgress: (progress, message) => throttledEmit(progress, message),
  });

  if (!checkoutResult.success) {
    throttledEmit.cancel();
    return { success: false };
  }

  throttledEmit.flush();

  const action = checkoutResult.data;
  const completionMessage = action === 'created' ? createI18nError('progress.branchCreated') : createI18nError('progress.checkoutComplete');
  throttledEmit(100, completionMessage);

  return { success: true, action: action as CheckoutAction };
}

async function broadcastBranchChange(
  connectionId: string,
  requestId: string,
  repositoryId: string,
  branchName: string,
  action: CheckoutAction
): Promise<void> {
  const metadata = repositoryService.getMetadata(repositoryId);
  await repositoryService.registerMetadata(repositoryId, {
    ...metadata,
    currentBranch: branchName,
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
}

export const handleRepositoryGetLocalBranches = withValidatedGitRepository<RepositoryGetLocalBranchesPayload>(
  WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId } = payload;

    const branchesResult = await gitService.getLocalBranches(repositoryPath);
    if (handleResultError(branchesResult, connectionId, WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT, requestId, createI18nError('errors.getBranchesFailed'))) return;

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
    if (handleResultError(dirtyResult, connectionId, WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT, requestId, createI18nError('errors.checkDirtyFailed'))) return;

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

    const checkoutResult = await performCheckoutWithProgress({
      connectionId,
      requestId,
      repositoryPath,
      branchName,
      force,
    });

    if (!checkoutResult.success) {
      emitError(connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT, createI18nError('errors.checkoutFailed'), requestId, undefined, 'INTERNAL_ERROR');
      return;
    }

    await broadcastBranchChange(connectionId, requestId, repositoryId, branchName, checkoutResult.action);

    logger.log('Repository', 'Update', `已切換「${repositoryId}」的分支至「${branchName}」（${checkoutResult.action}）`);
  },
  { rejectWorktree: { errorMessage: createI18nError('errors.worktreeCheckoutNotAllowed') } }
);

export const handleRepositoryDeleteBranch = withValidatedGitRepository<RepositoryDeleteBranchPayload>(
  WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED,
  async (connectionId, payload, requestId, repositoryPath) => {
    const { repositoryId, branchName, force } = payload;

    const deleteResult = await gitService.deleteBranch(repositoryPath, branchName, force);
    if (handleResultError(deleteResult, connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED, requestId, createI18nError('errors.deleteBranchFailed'))) return;

    const response: RepositoryBranchDeletedPayload = {
      requestId,
      success: true,
      branchName,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED, response);

    logger.log('Repository', 'Update', `已從「${repositoryId}」刪除分支「${branchName}」`);
  }
);
