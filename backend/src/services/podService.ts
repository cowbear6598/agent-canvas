import { podStore } from "./podStore.js";
import { workspaceService } from "./workspace/index.js";
import { canvasStore } from "./canvasStore.js";
import { socketService } from "./socketService.js";
import { connectionStore } from "./connectionStore.js";
import { repositoryNoteStore } from "./noteStores.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import type { PodDeletedPayload } from "../types/index.js";
import type { CreatePodRequest } from "../types/api.js";
import type { Result } from "../types/index.js";
import { ok, err } from "../types/index.js";
import type { Pod } from "../types/pod.js";
import { toPodPublicView } from "../types/pod.js";
import { logger } from "../utils/logger.js";
import { createI18nError } from "../utils/i18nError.js";
import { memoryStateService } from "./memoryStateService.js";
import { runStore } from "./runStore.js";
import { deferredPodWorkspaceCleanupService } from "./runtime/deferredPodWorkspaceCleanupService.js";

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

export async function deletePodWithCleanup(
  canvasId: string,
  podId: string,
  requestId: string,
): Promise<Result<void>> {
  const pod = podStore.getById(canvasId, podId);
  if (!pod) {
    return err(createI18nError("errors.podNotFound", { id: podId }));
  }

  // 先保留引用清單；Pod 定義成功刪除後才安排實體目錄清理。
  const runIdsUsingWorkspace = runStore.getRunIdsByWorkspacePath(
    pod.workspacePath,
  );
  const deletedNoteIdsPayload = deleteAllPodNotes(canvasId, podId);
  connectionStore.deleteByPodId(canvasId, podId);
  memoryStateService.clearScopeMaintenanceRecords("pod", podId);
  memoryStateService.deletePodState(podId);

  const deleted = podStore.delete(canvasId, podId);
  if (!deleted) {
    return err(createI18nError("errors.podDeleteFailed"));
  }

  // Canvas 定義已移除；仍被 Run 使用的 Pod 工作目錄延後至最後一個 Run 釋放。
  const isWorkspaceDeletionDeferred =
    deferredPodWorkspaceCleanupService.defer(
      pod.workspacePath,
      runIdsUsingWorkspace,
    );
  if (!isWorkspaceDeletionDeferred) {
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
  }

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
