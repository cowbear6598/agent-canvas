
import { WebSocketResponseEvents } from '../schemas';
import type {
  RepositoryCreatedPayload,
} from '../types';
import type {
  RepositoryCreatePayload,
  PodBindRepositoryPayload,
  PodUnbindRepositoryPayload,
  RepositoryDeletePayload,
} from '../schemas';
import { repositoryService } from '../services/repositoryService.js';
import { podManifestService } from '../services/podManifestService.js';
import { repositoryNoteStore } from '../services/noteStores.js';
import { podStore } from '../services/podStore.js';
import { socketService } from '../services/socketService.js';
import { gitService } from '../services/workspace/gitService.js';
import { repositorySyncService } from '../services/repositorySyncService.js';
import { skillService } from '../services/skillService.js';
import { subAgentService } from '../services/subAgentService.js';
import { commandService } from '../services/commandService.js';
import { emitError } from '../utils/websocketResponse.js';
import { clearPodMessages } from './repository/repositoryBindHelpers.js';
import { logger, type LogCategory, type LogAction } from '../utils/logger.js';
import { createNoteHandlers } from './factories/createNoteHandlers.js';
import { createListHandler } from './factories/createResourceHandlers.js';
import { validatePod, handleResourceDelete, withCanvasId, emitPodUpdated, handleResultError, getPodDisplayName } from '../utils/handlerHelpers.js';
import { validateRepositoryExists } from '../utils/validators.js';

export const repositoryNoteHandlers = createNoteHandlers({
  noteStore: repositoryNoteStore,
  events: {
    created: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
    listResult: WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT,
    updated: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
    deleted: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
  },
  foreignKeyField: 'repositoryId',
  entityName: 'Repository',
  validateBeforeCreate: (repositoryId) => repositoryService.exists(repositoryId),
});

export const handleRepositoryList = createListHandler({
  service: repositoryService,
  event: WebSocketResponseEvents.REPOSITORY_LIST_RESULT,
  responseKey: 'repositories',
});

export async function handleRepositoryCreate(
  connectionId: string,
  payload: RepositoryCreatePayload,
  requestId: string
): Promise<void> {
  const { name } = payload;

  const exists = await repositoryService.exists(name);
  if (exists) {
    emitError(
      connectionId,
      WebSocketResponseEvents.REPOSITORY_CREATED,
      `Repository 已存在: ${name}`,
      requestId,
      undefined,
      'ALREADY_EXISTS'
    );
    return;
  }

  const repository = await repositoryService.create(name);

  const response: RepositoryCreatedPayload = {
    requestId,
    success: true,
    repository,
  };

  socketService.emitToConnection(connectionId, WebSocketResponseEvents.REPOSITORY_CREATED, response);

  logger.log('Repository', 'Create', `已建立 Repository「${repository.name}」`);
}

async function cleanupOldWorkspaceResources(podWorkspacePath: string, podId: string): Promise<void> {
  const deleteOperations = [
    commandService.deleteCommandFromPath(podWorkspacePath),
    skillService.deleteSkillsFromPath(podWorkspacePath),
    subAgentService.deleteSubAgentsFromPath(podWorkspacePath),
  ];

  const results = await Promise.allSettled(deleteOperations);
  const operationNames = ['commands', 'skills', 'subagents'];

  logRejectedResults(results, operationNames, `Pod ${podId} workspace`, 'Repository', 'Bind');
}

function logRejectedResults(
  results: PromiseSettledResult<unknown>[],
  operationNames: string[],
  context: string,
  category: LogCategory,
  action: LogAction
): void {
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(category, action, `刪除 ${context} 的 ${operationNames[index]} 失敗`, result.reason);
    }
  });
}

export const handlePodBindRepository = withCanvasId<PodBindRepositoryPayload>(
  WebSocketResponseEvents.POD_REPOSITORY_BOUND,
  async (connectionId: string, canvasId: string, payload: PodBindRepositoryPayload, requestId: string): Promise<void> => {
    const { podId, repositoryId } = payload;

    const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_REPOSITORY_BOUND, requestId);
    if (!pod) {
      return;
    }

    const validateResult = await validateRepositoryExists(repositoryId);
    if (handleResultError(validateResult, connectionId, WebSocketResponseEvents.POD_REPOSITORY_BOUND, requestId, '找不到 Repository', 'NOT_FOUND')) return;

    const oldRepositoryId = pod.repositoryId;

    podStore.setRepositoryId(canvasId, podId, repositoryId);
    podStore.resetClaudeSession(canvasId, podId);

    await repositorySyncService.syncRepositoryResources(repositoryId);

    if (oldRepositoryId && oldRepositoryId !== repositoryId) {
      const oldRepositoryPath = repositoryService.getRepositoryPath(oldRepositoryId);
      await podManifestService.deleteManagedFiles(oldRepositoryPath, podId);
      await repositorySyncService.syncRepositoryResources(oldRepositoryId);
    }

    if (!oldRepositoryId) {
      await cleanupOldWorkspaceResources(pod.workspacePath, podId);
    }

    await clearPodMessages(connectionId, podId);

    emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_REPOSITORY_BOUND);

    logger.log('Repository', 'Bind', `已將 Repository「${repositoryId}」綁定至 Pod「${getPodDisplayName(canvasId, podId)}」`);
  }
);

import type { Pod } from '../types/index.js';

function buildCopyOperations(pod: Pod): Promise<unknown>[] {
  return [
    ...pod.skillIds.map(id => skillService.copySkillToPod(id, pod.id, pod.workspacePath)),
    ...pod.subAgentIds.map(id => subAgentService.copySubAgentToPod(id, pod.id, pod.workspacePath)),
    ...(pod.commandId ? [commandService.copyCommandToPod(pod.commandId, pod.id, pod.workspacePath)] : []),
  ];
}

export const handlePodUnbindRepository = withCanvasId<PodUnbindRepositoryPayload>(
  WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
  async (connectionId: string, canvasId: string, payload: PodUnbindRepositoryPayload, requestId: string): Promise<void> => {
    const { podId } = payload;

    const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_REPOSITORY_UNBOUND, requestId);
    if (!pod) {
      return;
    }

    const oldRepositoryId = pod.repositoryId;

    podStore.setRepositoryId(canvasId, podId, null);
    podStore.resetClaudeSession(canvasId, podId);

    if (oldRepositoryId) {
      const repositoryPath = repositoryService.getRepositoryPath(oldRepositoryId);
      await podManifestService.deleteManagedFiles(repositoryPath, podId);
      await repositorySyncService.syncRepositoryResources(oldRepositoryId);
    }

    const results = await Promise.allSettled(buildCopyOperations(pod));

    results.forEach((result) => {
      if (result.status === 'rejected') {
        logger.error('Repository', 'Unbind', `複製資源至 Pod「${getPodDisplayName(canvasId, podId)}」失敗`, result.reason);
      }
    });

    await clearPodMessages(connectionId, podId);

    emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_REPOSITORY_UNBOUND);

    logger.log('Repository', 'Unbind', `已解除 Pod「${getPodDisplayName(canvasId, podId)}」的 Repository 綁定`);
  }
);

async function cleanupWorktreeResources(
  metadata: { parentRepoId: string; branchName?: string },
  repositoryId: string
): Promise<void> {
  const parentExists = await repositoryService.exists(metadata.parentRepoId);

  if (!parentExists) {
    logger.log('Repository', 'Delete', `Parent repository ${metadata.parentRepoId} 不存在，跳過 worktree 清理`);
    return;
  }

  const parentRepoPath = repositoryService.getRepositoryPath(metadata.parentRepoId);
  const worktreePath = repositoryService.getRepositoryPath(repositoryId);

  const removeResult = await gitService.removeWorktree(parentRepoPath, worktreePath);
  if (!removeResult.success) {
    logger.log('Repository', 'Delete', `警告：移除 worktree 註冊失敗: ${removeResult.error}`);
  }

  if (!metadata.branchName) return;

  const deleteResult = await gitService.deleteBranch(parentRepoPath, metadata.branchName);
  if (!deleteResult.success) {
    logger.log('Repository', 'Delete', `警告：刪除分支失敗: ${deleteResult.error}`);
  }
}

export async function handleRepositoryDelete(
  connectionId: string,
  payload: RepositoryDeletePayload,
  requestId: string
): Promise<void> {
  const { repositoryId } = payload;

  const metadata = repositoryService.getMetadata(repositoryId);

  await handleResourceDelete({
    connectionId,
    requestId,
    resourceId: repositoryId,
    resourceName: 'Repository',
    responseEvent: WebSocketResponseEvents.REPOSITORY_DELETED,
    existsCheck: () => repositoryService.exists(repositoryId),
    findPodsUsing: (canvasId: string) => podStore.findByRepositoryId(canvasId, repositoryId),
    deleteNotes: (canvasId: string) => repositoryNoteStore.deleteByForeignKey(canvasId, repositoryId),
    deleteResource: async () => {
      if (metadata?.parentRepoId) {
        await cleanupWorktreeResources(metadata as { parentRepoId: string; branchName?: string }, repositoryId);
      }

      await repositoryService.delete(repositoryId);
    },
  });
}
