import { podStore } from "./podStore.js";
import { workspaceService } from "./workspace/index.js";
import { canvasStore } from "./canvasStore.js";
import { socketService } from "./socketService.js";
import { workflowStateService } from "./workflow/index.js";
import { connectionStore } from "./connectionStore.js";
import { repositorySyncService } from "./repositorySyncService.js";
import { podManifestService } from "./podManifestService.js";
import { repositoryNoteStore, commandNoteStore } from "./noteStores.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import type { PodDeletedPayload } from "../types/index.js";
import type { CreatePodRequest } from "../types/api.js";
import type { Result } from "../types/index.js";
import { ok, err } from "../types/index.js";
import type { Pod } from "../types/pod.js";
import { isPodBusy, toPodPublicView } from "../types/pod.js";
import { logger } from "../utils/logger.js";
import { createI18nError } from "../utils/i18nError.js";
import { abortRegistry } from "./provider/abortRegistry.js";
import { runExecutionService } from "./workflow/runExecutionService.js";

interface CreatePodResult {
  pod: Pod;
}

export function deleteAllPodNotes(
  canvasId: string,
  podId: string,
): PodDeletedPayload["deletedNoteIds"] {
  const noteStoreConfigs: Array<{
    store: {
      deleteByBoundPodId: (canvasId: string, podId: string) => string[];
    };
    key: keyof NonNullable<PodDeletedPayload["deletedNoteIds"]>;
  }> = [
    { store: repositoryNoteStore, key: "repositoryNote" },
    { store: commandNoteStore, key: "commandNote" },
  ];

  const result: PodDeletedPayload["deletedNoteIds"] = {};

  for (const { store, key } of noteStoreConfigs) {
    const ids = store.deleteByBoundPodId(canvasId, podId);
    if (ids.length > 0) {
      result[key] = ids;
    }
  }

  return result;
}

async function cleanupRepositoryResources(
  repositoryId: string | null | undefined,
  podId: string,
): Promise<void> {
  if (!repositoryId) {
    return;
  }
  await podManifestService.deleteManagedFiles(repositoryId, podId);
}

async function syncRepositoryAfterDelete(
  repositoryId: string | null | undefined,
): Promise<void> {
  if (!repositoryId) {
    return;
  }
  await repositorySyncService.syncRepositoryResources(repositoryId);
}

export async function deletePodWithCleanup(
  canvasId: string,
  podId: string,
  requestId: string,
): Promise<Result<void>> {
  const pod = podStore.getById(canvasId, podId);
  if (!pod) {
    return err(createI18nError("errors.podNotFound", { id: podId }));
  }

  // 若 Pod 正在執行查詢，先中止以避免記憶體洩漏
  if (isPodBusy(pod.status)) {
    // abort 只回傳 boolean，不會拋例外，直接呼叫即可
    abortRegistry.abort(podId);

    // 中止 Run 模式的查詢（key 格式為 ${runId}:${podId}）
    const activeRunIds = runExecutionService.getActiveRunIdsForPod(podId);
    for (const runId of activeRunIds) {
      abortRegistry.abort(`${runId}:${podId}`);
    }
  }

  workflowStateService.handleSourceDeletion(canvasId, podId);

  const deleteResult = await workspaceService.deleteWorkspace(
    pod.workspacePath,
  );
  if (!deleteResult.success) {
    logger.error(
      "Pod",
      "Delete",
      `無法刪除 Pod ${podId} 的工作區`,
      deleteResult.error,
    );
  }

  const deletedNoteIdsPayload = deleteAllPodNotes(canvasId, podId);
  connectionStore.deleteByPodId(canvasId, podId);

  await cleanupRepositoryResources(pod.repositoryId, podId);

  const deleted = podStore.delete(canvasId, podId);
  if (!deleted) {
    return err(createI18nError("errors.podDeleteFailed"));
  }

  await syncRepositoryAfterDelete(pod.repositoryId);

  const hasDeletedNotes =
    deletedNoteIdsPayload !== undefined &&
    Object.keys(deletedNoteIdsPayload).length > 0;
  const response: PodDeletedPayload = {
    requestId,
    canvasId,
    success: true,
    podId,
    ...(hasDeletedNotes && { deletedNoteIds: deletedNoteIdsPayload }),
  };

  socketService.emitToCanvas(
    canvasId,
    WebSocketResponseEvents.POD_DELETED,
    response,
  );

  logger.log("Pod", "Delete", `已刪除 Pod「${pod.name}」`);

  return ok();
}

export async function createPodWithWorkspace(
  canvasId: string,
  data: CreatePodRequest,
  requestId: string,
): Promise<Result<CreatePodResult>> {
  const trimmedName = data.name.trim();

  if (podStore.hasName(canvasId, trimmedName)) {
    return err(createI18nError("errors.podNameDuplicate"));
  }

  const { pod } = podStore.create(canvasId, { ...data, name: trimmedName });

  const canvasDir = canvasStore.getCanvasDir(canvasId);
  if (canvasDir) {
    const wsResult = await workspaceService.createWorkspace(pod.workspacePath);
    if (!wsResult.success) {
      podStore.delete(canvasId, pod.id);
      return err(createI18nError("errors.workspaceCreateFailed"));
    }
  }

  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CREATED, {
    requestId,
    canvasId,
    success: true,
    pod: toPodPublicView(pod),
  });

  return { success: true, data: { pod } };
}
