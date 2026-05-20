import { WebSocketResponseEvents } from "../schemas";
import type { RepositoryCreatedPayload } from "../types";
import type {
  RepositoryCreatePayload,
  PodBindRepositoryPayload,
  PodUnbindRepositoryPayload,
  RepositoryDeletePayload,
} from "../schemas";
import { repositoryService } from "../services/repositoryService.js";
import { repositoryNoteStore } from "../services/noteStores.js";
import { podStore } from "../services/podStore.js";
import { socketService } from "../services/socketService.js";
import { emitError } from "../utils/websocketResponse.js";
import { createI18nError } from "../utils/i18nError.js";
import { createNoteHandlers } from "./factories/createNoteHandlers.js";
import { createListHandler } from "./factories/createResourceHandlers.js";
import {
  validatePod,
  handleResourceDelete,
  withCanvasId,
  emitPodUpdated,
  handleResultError,
} from "../utils/handlerHelpers.js";
import { validateRepositoryExists } from "../utils/validators.js";

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

    emitPodUpdated(
      canvasId,
      podId,
      requestId,
      WebSocketResponseEvents.POD_REPOSITORY_BOUND,
    );
  },
);

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
      podStore.setRepositoryId(canvasId, podId, null);

      emitPodUpdated(
        canvasId,
        podId,
        requestId,
        WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
      );
    },
  );

export async function handleRepositoryDelete(
  connectionId: string,
  payload: RepositoryDeletePayload,
  requestId: string,
): Promise<void> {
  const { repositoryId } = payload;

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
      await repositoryService.delete(repositoryId);
    },
  });
}
