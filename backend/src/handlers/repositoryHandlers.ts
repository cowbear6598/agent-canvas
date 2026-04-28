import { WebSocketResponseEvents } from "../schemas";
import type { RepositoryCreatedPayload } from "../types";
import type { Pod } from "../types/index.js";
import type {
  RepositoryCreatePayload,
  PodBindRepositoryPayload,
  PodUnbindRepositoryPayload,
  RepositoryDeletePayload,
} from "../schemas";
import { repositoryService } from "../services/repositoryService.js";
import { podManifestService } from "../services/podManifestService.js";
import { repositoryNoteStore } from "../services/noteStores.js";
import { podStore } from "../services/podStore.js";
import { socketService } from "../services/socketService.js";
import { gitService } from "../services/workspace/gitService.js";
import { repositorySyncService } from "../services/repositorySyncService.js";
import { commandService } from "../services/commandService.js";
import { emitError } from "../utils/websocketResponse.js";
import { createI18nError } from "../utils/i18nError.js";
import { logger } from "../utils/logger.js";
import { createNoteHandlers } from "./factories/createNoteHandlers.js";
import { createListHandler } from "./factories/createResourceHandlers.js";
import {
  validatePod,
  handleResourceDelete,
  withCanvasId,
  emitPodUpdated,
  handleResultError,
  getPodDisplayName,
  assertCapability,
} from "../utils/handlerHelpers.js";
import { validateRepositoryExists } from "../utils/validators.js";

/**
 * 清理 git 錯誤訊息中的絕對路徑，避免內部路徑洩漏到 log 輸出。
 * 把符合絕對路徑格式的字段（以 / 開頭的多層路徑）替換為 <path>。
 */
function sanitizeGitErrorMessage(msg: string): string {
  // 替換以 / 開頭的絕對路徑（至少兩層），保留其他文字
  return msg.replace(/\/[^\s'",:]+(?:\/[^\s'",:]+)+/g, "<path>");
}

export const repositoryNoteHandlers = createNoteHandlers({
  noteStore: repositoryNoteStore,
  events: {
    created: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
    listResult: WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT,
    updated: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
    deleted: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
  },
  foreignKeyField: "repositoryId",
  entityName: "Repository",
  validateBeforeCreate: (repositoryId) =>
    repositoryService.exists(repositoryId),
});

export const handleRepositoryList = createListHandler({
  service: repositoryService,
  event: WebSocketResponseEvents.REPOSITORY_LIST_RESULT,
  responseKey: "repositories",
});

export async function handleRepositoryCreate(
  connectionId: string,
  payload: RepositoryCreatePayload,
  requestId: string,
): Promise<void> {
  const { name } = payload;

  const exists = await repositoryService.exists(name);
  if (exists) {
    // TODO（安全性 trade-off）：回傳明確的 "ALREADY_EXISTS" code 可讓前端顯示「此名稱已存在」
    // 的精確訊息（useGitCloneProgress 等已依賴此 code），但同時提供存在性 oracle，
    // 攻擊者可藉此枚舉已有的 repository 名稱。
    // 目前評估 UX 價值 > 枚舉風險（repository 名稱非高敏感資料），故保留現狀。
    // 若未來需提升安全性，可改為通用 "INVALID_NAME" 並統一顯示「名稱不可用」。
    emitError(
      connectionId,
      WebSocketResponseEvents.REPOSITORY_CREATED,
      createI18nError("errors.repoExists", { name }),
      null,
      requestId,
      undefined,
      "ALREADY_EXISTS",
    );
    return;
  }

  const repository = await repositoryService.create(name);

  const response: RepositoryCreatedPayload = {
    requestId,
    success: true,
    repository,
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.REPOSITORY_CREATED,
    response,
  );

  logger.log("Repository", "Create", `已建立 Repository「${repository.name}」`);
}

async function cleanupPodWorkspaceResources(
  podWorkspacePath: string,
  podId: string,
): Promise<void> {
  try {
    await commandService.deleteCommandFromPath(podWorkspacePath);
  } catch (err) {
    logger.error(
      "Repository",
      "Bind",
      `刪除 Pod ${podId} workspace 的 commands 失敗`,
      err,
    );
  }
}

export const handlePodBindRepository = withCanvasId<PodBindRepositoryPayload>(
  WebSocketResponseEvents.POD_REPOSITORY_BOUND,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodBindRepositoryPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, repositoryId } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_REPOSITORY_BOUND,
      requestId,
    );
    if (!pod) {
      return;
    }

    if (
      !assertCapability(
        connectionId,
        pod,
        "repository",
        WebSocketResponseEvents.POD_REPOSITORY_BOUND,
        requestId,
        canvasId,
      )
    )
      return;

    const validateResult = await validateRepositoryExists(repositoryId);
    if (
      handleResultError(
        validateResult,
        connectionId,
        WebSocketResponseEvents.POD_REPOSITORY_BOUND,
        requestId,
        createI18nError("errors.repoNotFound"),
        canvasId,
        "NOT_FOUND",
      )
    )
      return;

    const oldRepositoryId = pod.repositoryId;

    // 若已綁定相同 repository，無需重複執行同步與廣播，直接回傳成功
    if (oldRepositoryId === repositoryId) {
      emitPodUpdated(
        canvasId,
        podId,
        requestId,
        WebSocketResponseEvents.POD_REPOSITORY_BOUND,
      );
      return;
    }

    podStore.setRepositoryId(canvasId, podId, repositoryId);

    await repositorySyncService.syncRepositoryResources(repositoryId);

    if (oldRepositoryId && oldRepositoryId !== repositoryId) {
      await podManifestService.deleteManagedFiles(oldRepositoryId, podId);
      await repositorySyncService.syncRepositoryResources(oldRepositoryId);
    }

    if (!oldRepositoryId) {
      await cleanupPodWorkspaceResources(pod.workspacePath, podId);
    }

    emitPodUpdated(
      canvasId,
      podId,
      requestId,
      WebSocketResponseEvents.POD_REPOSITORY_BOUND,
    );

    logger.log(
      "Repository",
      "Bind",
      `已將 Repository「${repositoryId}」綁定至 Pod「${getPodDisplayName(canvasId, podId)}」`,
    );
  },
);

/**
 * 解除 Repository 綁定後的資源清理：
 * 1. 刪除該 Pod 在舊 repository 的 managed files
 * 2. 重新同步舊 repository 的資源
 */
async function unbindRepositoryCleanup(
  pod: Pod,
  oldRepositoryId: string | null,
): Promise<void> {
  if (oldRepositoryId) {
    await podManifestService.deleteManagedFiles(oldRepositoryId, pod.id);
    await repositorySyncService.syncRepositoryResources(oldRepositoryId);
  }
}

export const handlePodUnbindRepository =
  withCanvasId<PodUnbindRepositoryPayload>(
    WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
    async (
      connectionId: string,
      canvasId: string,
      payload: PodUnbindRepositoryPayload,
      requestId: string,
    ): Promise<void> => {
      const { podId } = payload;

      const pod = validatePod(
        connectionId,
        podId,
        WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
        requestId,
      );
      if (!pod) {
        return;
      }

      const oldRepositoryId = pod.repositoryId;

      podStore.setRepositoryId(canvasId, podId, null);

      await unbindRepositoryCleanup(pod, oldRepositoryId);

      emitPodUpdated(
        canvasId,
        podId,
        requestId,
        WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
      );

      logger.log(
        "Repository",
        "Unbind",
        `已解除 Pod「${getPodDisplayName(canvasId, podId)}」的 Repository 綁定`,
      );
    },
  );

async function cleanupWorktreeResources(
  metadata: { parentRepoId: string; branchName?: string },
  repositoryId: string,
): Promise<void> {
  const parentExists = await repositoryService.exists(metadata.parentRepoId);

  if (!parentExists) {
    logger.log(
      "Repository",
      "Delete",
      `Parent repository ${metadata.parentRepoId} 不存在，跳過 worktree 清理`,
    );
    return;
  }

  const parentRepoPath = repositoryService.getRepositoryPath(
    metadata.parentRepoId,
  );
  const worktreePath = repositoryService.getRepositoryPath(repositoryId);

  const removeResult = await gitService.removeWorktree(
    parentRepoPath,
    worktreePath,
  );
  if (!removeResult.success) {
    logger.log(
      "Repository",
      "Delete",
      `警告：移除 worktree 註冊失敗: ${sanitizeGitErrorMessage(String(removeResult.error ?? ""))}`,
    );
  }

  if (!metadata.branchName) return;

  const deleteResult = await gitService.deleteBranch(
    parentRepoPath,
    metadata.branchName,
  );
  if (!deleteResult.success) {
    logger.log(
      "Repository",
      "Delete",
      `警告：刪除分支失敗: ${sanitizeGitErrorMessage(String(deleteResult.error ?? ""))}`,
    );
  }
}

export async function handleRepositoryDelete(
  connectionId: string,
  payload: RepositoryDeletePayload,
  requestId: string,
): Promise<void> {
  const { repositoryId } = payload;

  const metadata = repositoryService.getMetadata(repositoryId);

  await handleResourceDelete({
    connectionId,
    requestId,
    resourceId: repositoryId,
    resourceName: "Repository",
    responseEvent: WebSocketResponseEvents.REPOSITORY_DELETED,
    existsCheck: () => repositoryService.exists(repositoryId),
    findPodsUsing: (canvasId: string) =>
      podStore.findByRepositoryId(canvasId, repositoryId),
    deleteNotes: (canvasId: string) =>
      repositoryNoteStore.deleteByForeignKey(canvasId, repositoryId),
    deleteResource: async () => {
      if (metadata?.parentRepoId) {
        await cleanupWorktreeResources(
          metadata as { parentRepoId: string; branchName?: string },
          repositoryId,
        );
      }

      await repositoryService.delete(repositoryId);
    },
  });
}
