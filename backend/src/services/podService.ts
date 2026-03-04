import { podStore } from './podStore.js';
import { workspaceService } from './workspace/index.js';
import { canvasStore } from './canvasStore.js';
import { socketService } from './socketService.js';
import { workflowStateService } from './workflow/index.js';
import { connectionStore } from './connectionStore.js';
import { repositoryService } from './repositoryService.js';
import { repositorySyncService } from './repositorySyncService.js';
import { podManifestService } from './podManifestService.js';
import { noteStore, skillNoteStore, repositoryNoteStore, commandNoteStore, subAgentNoteStore, mcpServerNoteStore } from './noteStores.js';
import { WebSocketResponseEvents } from '../schemas/index.js';
import type { PodDeletedPayload } from '../types/index.js';
import type { CreatePodRequest } from '../types/api.js';
import type { Result } from '../types/index.js';
import { ok } from '../types/index.js';
import type { Pod } from '../types/pod.js';
import { logger } from '../utils/logger.js';

interface CreatePodResult {
    pod: Pod;
}

export function deleteAllPodNotes(canvasId: string, podId: string): PodDeletedPayload['deletedNoteIds'] {
    const noteStoreConfigs: Array<{ store: { deleteByBoundPodId: (canvasId: string, podId: string) => string[] }; key: keyof NonNullable<PodDeletedPayload['deletedNoteIds']> }> = [
        { store: noteStore, key: 'note' },
        { store: skillNoteStore, key: 'skillNote' },
        { store: repositoryNoteStore, key: 'repositoryNote' },
        { store: commandNoteStore, key: 'commandNote' },
        { store: subAgentNoteStore, key: 'subAgentNote' },
        { store: mcpServerNoteStore, key: 'mcpServerNote' },
    ];

    const result: PodDeletedPayload['deletedNoteIds'] = {};

    for (const { store, key } of noteStoreConfigs) {
        const ids = store.deleteByBoundPodId(canvasId, podId);
        if (ids.length > 0) {
            result[key] = ids;
        }
    }

    return result;
}

async function cleanupRepositoryResources(repositoryId: string | null | undefined, podId: string): Promise<void> {
    if (!repositoryId) {
        return;
    }
    const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
    await podManifestService.deleteManagedFiles(repositoryPath, podId);
}

async function syncRepositoryAfterDelete(repositoryId: string | null | undefined): Promise<void> {
    if (!repositoryId) {
        return;
    }
    await repositorySyncService.syncRepositoryResources(repositoryId);
}

export async function deletePodWithCleanup(canvasId: string, podId: string, requestId: string): Promise<Result<void>> {
    const pod = podStore.getById(canvasId, podId);
    if (!pod) {
        return { success: false, error: '找不到 Pod' };
    }

    workflowStateService.handleSourceDeletion(canvasId, podId);

    const deleteResult = await workspaceService.deleteWorkspace(pod.workspacePath);
    if (!deleteResult.success) {
        logger.error('Pod', 'Delete', `無法刪除 Pod ${podId} 的工作區`, deleteResult.error);
    }

    const deletedNoteIdsPayload = deleteAllPodNotes(canvasId, podId);
    connectionStore.deleteByPodId(canvasId, podId);

    await cleanupRepositoryResources(pod.repositoryId, podId);

    const deleted = podStore.delete(canvasId, podId);
    if (!deleted) {
        return { success: false, error: '刪除 Pod 時發生錯誤' };
    }

    await syncRepositoryAfterDelete(pod.repositoryId);

    const hasDeletedNotes = deletedNoteIdsPayload !== undefined && Object.keys(deletedNoteIdsPayload).length > 0;
    const response: PodDeletedPayload = {
        requestId,
        canvasId,
        success: true,
        podId,
        ...(hasDeletedNotes && { deletedNoteIds: deletedNoteIdsPayload }),
    };

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_DELETED, response);

    logger.log('Pod', 'Delete', `已刪除 Pod「${pod.name}」`);

    return ok();
}

export async function createPodWithWorkspace(
    canvasId: string,
    data: CreatePodRequest,
    requestId: string,
): Promise<Result<CreatePodResult>> {
    const trimmedName = data.name.trim();

    if (podStore.hasName(canvasId, trimmedName)) {
        return { success: false, error: '同一 Canvas 下已存在相同名稱的 Pod' };
    }

    const { pod } = podStore.create(canvasId, { ...data, name: trimmedName });

    const canvasDir = canvasStore.getCanvasDir(canvasId);
    if (canvasDir) {
        const wsResult = await workspaceService.createWorkspace(pod.workspacePath);
        if (!wsResult.success) {
            podStore.delete(canvasId, pod.id);
            return { success: false, error: '建立工作目錄失敗' };
        }
    }

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CREATED, {
        requestId,
        success: true,
        pod,
    });

    return { success: true, data: { pod } };
}
