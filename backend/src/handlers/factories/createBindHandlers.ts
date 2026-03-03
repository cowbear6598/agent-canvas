import type {WebSocketResponseEvents} from '../../schemas';
import type {Pod} from '../../types/pod.js';
import {repositorySyncService} from '../../services/repositorySyncService.js';
import {emitSuccess, emitError} from '../../utils/websocketResponse.js';
import {logger, type LogCategory} from '../../utils/logger.js';
import {validatePod, withCanvasId, emitPodUpdated} from '../../utils/handlerHelpers.js';

/**
 * 資源綁定處理器的配置介面
 */
export interface BindResourceConfig<TService, TIdField extends string = string> {
    /** 資源名稱（用於日誌和錯誤訊息） */
    resourceName: string;
    /** 資源 ID 欄位名稱 */
    idField: TIdField;
    /** 是否為多重綁定（true: 陣列模式如 skillIds, false: 單一值模式如 commandId） */
    isMultiBind: boolean;
    /** 資源服務實例 */
    service: TService;
    /** Pod Store 的更新方法 */
    podStoreMethod: {
        bind: (canvasId: string, podId: string, resourceId: string) => void;
        unbind?: (canvasId: string, podId: string) => void;
    };
    /** 獲取 Pod 已綁定的資源 IDs */
    getPodResourceIds: (pod: {skillIds: string[]; commandId: string | null; outputStyleId: string | null; subAgentIds: string[]; mcpServerIds: string[]}) => string[] | string | null;
    /** 複製資源到 Pod 的方法（optional，不提供時跳過複製） */
    copyResourceToPod?: (resourceId: string, pod: Pod) => Promise<void>;
    /** 從路徑刪除資源的方法（用於 unbind，optional，不提供時跳過刪除） */
    deleteResourceFromPath?: (workspacePath: string) => Promise<void>;
    /** 跳過衝突檢查（用於允許直接覆蓋的情境，如 OutputStyle） */
    skipConflictCheck?: boolean;
    /** 跳過 repository sync（用於不需要同步的情境，如 OutputStyle） */
    skipRepositorySync?: boolean;
    /** WebSocket 事件名稱 */
    events: {
        bound: WebSocketResponseEvents;
        unbound?: WebSocketResponseEvents;
    };
}

function isResourceAlreadyBound(
    boundIds: string[] | string | null,
    resourceId: string,
    isMultiBind: boolean
): boolean {
    if (isMultiBind) {
        return Array.isArray(boundIds) && boundIds.includes(resourceId);
    }

    const currentBoundId = boundIds as string | null;
    const isAlreadyBoundToSameResource = currentBoundId === resourceId;
    const isAlreadyBoundToDifferentResource = currentBoundId !== null;
    return isAlreadyBoundToSameResource || isAlreadyBoundToDifferentResource;
}

/**
 * 建立資源綁定處理器
 */
export function createBindHandler<TService extends {exists: (id: string) => Promise<boolean>}, TIdField extends string>(
    config: BindResourceConfig<TService, TIdField>
): ReturnType<typeof withCanvasId<{podId: string} & Record<TIdField, string>>> {
    return withCanvasId<{podId: string} & Record<TIdField, string>>(
        config.events.bound,
        async (connectionId: string, canvasId: string, payload: {podId: string} & Record<TIdField, string>, requestId: string): Promise<void> => {
            const {podId} = payload;
            const resourceId = payload[config.idField];

            const pod = validatePod(connectionId, podId, config.events.bound, requestId);
            if (!pod) {
                return;
            }

            const resourceExists = await config.service.exists(resourceId);
            if (!resourceExists) {
                emitError(
                    connectionId,
                    config.events.bound,
                    `${config.resourceName} 找不到: ${resourceId}`,
                    requestId,
                    podId,
                    'NOT_FOUND'
                );
                return;
            }

            if (!config.skipConflictCheck) {
                const boundIds = config.getPodResourceIds(pod);
                if (isResourceAlreadyBound(boundIds, resourceId, config.isMultiBind)) {
                    const conflictMessage = config.isMultiBind
                        ? `${config.resourceName} ${resourceId} 已綁定到 Pod ${podId}`
                        : `Pod ${podId} 已有 ${config.resourceName.toLowerCase()} ${boundIds} 綁定，請先解綁`;

                    emitError(
                        connectionId,
                        config.events.bound,
                        conflictMessage,
                        requestId,
                        podId,
                        'CONFLICT'
                    );
                    return;
                }
            }

            if (config.copyResourceToPod) {
                await config.copyResourceToPod(resourceId, pod);
            }

            config.podStoreMethod.bind(canvasId, podId, resourceId);

            if (!config.skipRepositorySync && pod.repositoryId) {
                await repositorySyncService.syncRepositoryResources(pod.repositoryId);
            }

            emitPodUpdated(canvasId, podId, requestId, config.events.bound);

            logger.log(config.resourceName as LogCategory, 'Bind', `已將 ${config.resourceName.toLowerCase()}「${resourceId}」綁定到 Pod「${pod.name}」`);
        }
    );
}

/**
 * 建立資源解綁處理器（僅用於單一綁定模式，如 Command）
 */
export function createUnbindHandler<TService, TIdField extends string>(
    config: BindResourceConfig<TService, TIdField>
): ReturnType<typeof withCanvasId<{podId: string}>> {
    if (config.isMultiBind) {
        throw new Error('解綁處理器僅限單一綁定模式使用');
    }

    if (!config.events.unbound) {
        throw new Error('解綁處理器必須提供解綁事件');
    }

    if (!config.podStoreMethod.unbind) {
        throw new Error('解綁處理器必須提供解綁方法');
    }

    return withCanvasId<{podId: string}>(
        config.events.unbound!,
        async (connectionId: string, canvasId: string, payload: {podId: string}, requestId: string): Promise<void> => {
            const {podId} = payload;

            const pod = validatePod(connectionId, podId, config.events.unbound!, requestId);
            if (!pod) {
                return;
            }

            const boundId = config.getPodResourceIds(pod);
            if (!boundId) {
                const response = {
                    requestId,
                    success: true,
                    pod,
                };
                emitSuccess(connectionId, config.events.unbound!, response);
                return;
            }

            if (config.deleteResourceFromPath) {
                await config.deleteResourceFromPath(pod.workspacePath);
            }

            config.podStoreMethod.unbind!(canvasId, podId);

            if (!config.skipRepositorySync && pod.repositoryId) {
                await repositorySyncService.syncRepositoryResources(pod.repositoryId);
            }

            emitPodUpdated(canvasId, podId, requestId, config.events.unbound!);

            logger.log(config.resourceName as LogCategory, 'Unbind', `已從 Pod「${pod.name}」解綁 ${config.resourceName.toLowerCase()}`);
        }
    );
}
