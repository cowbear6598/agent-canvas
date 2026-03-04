import type {WebSocketResponseEvents} from '../../schemas';
import type {Pod} from '../../types/pod.js';
import {repositorySyncService} from '../../services/repositorySyncService.js';
import {emitSuccess, emitError} from '../../utils/websocketResponse.js';
import {logger, type LogCategory} from '../../utils/logger.js';
import {validatePod, withCanvasId, emitPodUpdated} from '../../utils/handlerHelpers.js';

export interface BindResourceConfig<TService, TIdField extends string = string> {
    resourceName: string;
    idField: TIdField;
    /** true: 陣列模式如 skillIds，false: 單一值模式如 commandId */
    isMultiBind: boolean;
    service: TService;
    podStoreMethod: {
        bind: (canvasId: string, podId: string, resourceId: string) => Promise<void>;
        unbind?: (canvasId: string, podId: string) => Promise<void>;
    };
    getPodResourceIds: (pod: {skillIds: string[]; commandId: string | null; outputStyleId: string | null; subAgentIds: string[]; mcpServerIds: string[]}) => string[] | string | null;
    /** 某些資源綁定後需要複製檔案到 Pod 工作目錄 */
    copyResourceToPod?: (resourceId: string, pod: Pod) => Promise<void>;
    /** 某些資源解綁後需要從 Pod 工作目錄刪除檔案 */
    deleteResourceFromPath?: (workspacePath: string) => Promise<void>;
    skipConflictCheck?: boolean;
    skipRepositorySync?: boolean;
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

    return (boundIds as string | null) !== null;
}

async function validatePodAndResource<TService extends {exists: (id: string) => Promise<boolean>}, TIdField extends string>(
    connectionId: string,
    podId: string,
    resourceId: string,
    config: BindResourceConfig<TService, TIdField>,
    requestId: string
): Promise<Pod | undefined> {
    const pod = validatePod(connectionId, podId, config.events.bound, requestId);
    if (!pod) {
        return undefined;
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
        return undefined;
    }

    return pod;
}

function checkConflict<TService, TIdField extends string>(
    connectionId: string,
    podId: string,
    resourceId: string,
    pod: Pod,
    config: BindResourceConfig<TService, TIdField>,
    requestId: string
): boolean {
    if (config.skipConflictCheck) {
        return false;
    }

    const boundIds = config.getPodResourceIds(pod);
    if (!isResourceAlreadyBound(boundIds, resourceId, config.isMultiBind)) {
        return false;
    }

    const conflictMessage = config.isMultiBind
        ? `${config.resourceName} ${resourceId} 已綁定到 Pod ${podId}`
        : `Pod ${podId} 已有 ${config.resourceName.toLowerCase()} ${boundIds} 綁定，請先解綁`;

    emitError(connectionId, config.events.bound, conflictMessage, requestId, podId, 'CONFLICT');
    return true;
}

async function performBind<TService, TIdField extends string>(
    canvasId: string,
    podId: string,
    resourceId: string,
    pod: Pod,
    config: BindResourceConfig<TService, TIdField>,
    requestId: string
): Promise<void> {
    if (config.copyResourceToPod) {
        await config.copyResourceToPod(resourceId, pod);
    }

    await config.podStoreMethod.bind(canvasId, podId, resourceId);

    if (!config.skipRepositorySync && pod.repositoryId) {
        await repositorySyncService.syncRepositoryResources(pod.repositoryId);
    }

    emitPodUpdated(canvasId, podId, requestId, config.events.bound);

    logger.log(config.resourceName as LogCategory, 'Bind', `已將 ${config.resourceName.toLowerCase()}「${resourceId}」綁定到 Pod「${pod.name}」`);
}

export function createBindHandler<TService extends {exists: (id: string) => Promise<boolean>}, TIdField extends string>(
    config: BindResourceConfig<TService, TIdField>
): ReturnType<typeof withCanvasId<{podId: string} & Record<TIdField, string>>> {
    return withCanvasId<{podId: string} & Record<TIdField, string>>(
        config.events.bound,
        async (connectionId: string, canvasId: string, payload: {podId: string} & Record<TIdField, string>, requestId: string): Promise<void> => {
            const {podId} = payload;
            const resourceId = payload[config.idField];

            const pod = await validatePodAndResource(connectionId, podId, resourceId, config, requestId);
            if (!pod) {
                return;
            }

            const hasConflict = checkConflict(connectionId, podId, resourceId, pod, config, requestId);
            if (hasConflict) {
                return;
            }

            await performBind(canvasId, podId, resourceId, pod, config, requestId);
        }
    );
}

function assertUnbindConfig<TService, TIdField extends string>(
    config: BindResourceConfig<TService, TIdField>
): void {
    if (config.isMultiBind) {
        throw new Error('解綁處理器僅限單一綁定模式使用');
    }

    if (!config.events.unbound) {
        throw new Error('解綁處理器必須提供解綁事件');
    }

    if (!config.podStoreMethod.unbind) {
        throw new Error('解綁處理器必須提供解綁方法');
    }
}

export function createUnbindHandler<TService, TIdField extends string>(
    config: BindResourceConfig<TService, TIdField>
): ReturnType<typeof withCanvasId<{podId: string}>> {
    assertUnbindConfig(config);

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

            await config.podStoreMethod.unbind!(canvasId, podId);

            if (!config.skipRepositorySync && pod.repositoryId) {
                await repositorySyncService.syncRepositoryResources(pod.repositoryId);
            }

            emitPodUpdated(canvasId, podId, requestId, config.events.unbound!);

            logger.log(config.resourceName as LogCategory, 'Unbind', `已從 Pod「${pod.name}」解綁 ${config.resourceName.toLowerCase()}`);
        }
    );
}
