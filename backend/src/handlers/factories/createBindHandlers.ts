import type { WebSocketResponseEvents } from "../../schemas";
import type { Pod } from "../../types/pod.js";
import type { ProviderCapabilities } from "../../services/provider/index.js";
import { toPodPublicView } from "../../types/index.js";
import { repositorySyncService } from "../../services/repositorySyncService.js";
import { emitSuccess, emitError } from "../../utils/websocketResponse.js";
import { createI18nError } from "../../utils/i18nError.js";
import { logger, type LogCategory } from "../../utils/logger.js";
import {
  validatePod,
  withCanvasId,
  emitPodUpdated,
  assertCapability,
} from "../../utils/handlerHelpers.js";

export interface BindResourceConfig<
  TService,
  TIdField extends string = string,
> {
  resourceName: string;
  idField: TIdField;
  /** true: 陣列模式如 mcpServerNames，false: 單一值模式如 commandId */
  isMultiBind: boolean;
  service: TService;
  podStoreMethod: {
    bind: (canvasId: string, podId: string, resourceId: string) => void;
    unbind?: (canvasId: string, podId: string) => void;
  };
  getPodResourceIds: (pod: {
    commandId: string | null;
    mcpServerNames: string[];
  }) => string[] | string | null;
  /** 某些資源綁定後需要複製檔案到 Pod 工作目錄 */
  copyResourceToPod?: (resourceId: string, pod: Pod) => Promise<void>;
  /** 某些資源解綁後需要從 Pod 工作目錄刪除檔案 */
  deleteResourceFromPath?: (workspacePath: string) => Promise<void>;
  skipConflictCheck?: boolean;
  skipRepositorySync?: boolean;
  /** 守門：bind 時要求 pod.provider 具備此 capability，不支援的 provider 會收到 CAPABILITY_NOT_SUPPORTED 錯誤 */
  requiredCapability?: keyof ProviderCapabilities;
  events: {
    bound: WebSocketResponseEvents;
    unbound?: WebSocketResponseEvents;
  };
}

function isResourceAlreadyBound(
  boundIds: string[] | string | null,
  resourceId: string,
  isMultiBind: boolean,
): boolean {
  if (isMultiBind) {
    return Array.isArray(boundIds) && boundIds.includes(resourceId);
  }

  return (boundIds as string | null) !== null;
}

async function validatePodAndResource<
  TService extends { exists: (id: string) => Promise<boolean> },
  TIdField extends string,
>(
  connectionId: string,
  canvasId: string,
  podId: string,
  resourceId: string,
  config: BindResourceConfig<TService, TIdField>,
  requestId: string,
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
      createI18nError("errors.resourceNotFound", {
        resource: config.resourceName,
        id: resourceId,
      }),
      canvasId,
      requestId,
      podId,
      "NOT_FOUND",
    );
    return undefined;
  }

  return pod;
}

function checkConflict<TService, TIdField extends string>(
  connectionId: string,
  canvasId: string,
  podId: string,
  resourceId: string,
  pod: Pod,
  config: BindResourceConfig<TService, TIdField>,
  requestId: string,
): boolean {
  if (config.skipConflictCheck) {
    return false;
  }

  const boundIds = config.getPodResourceIds(pod);
  if (!isResourceAlreadyBound(boundIds, resourceId, config.isMultiBind)) {
    return false;
  }

  const conflictMessage = config.isMultiBind
    ? createI18nError("errors.resourceAlreadyBound", {
        resource: config.resourceName,
        resourceId,
        podId,
      })
    : createI18nError("errors.podResourceConflict", {
        podId,
        resource: config.resourceName,
        boundIds: String(boundIds),
      });

  emitError(
    connectionId,
    config.events.bound,
    conflictMessage,
    canvasId,
    requestId,
    podId,
    "CONFLICT",
  );
  return true;
}

async function performBind<TService, TIdField extends string>(
  canvasId: string,
  podId: string,
  resourceId: string,
  pod: Pod,
  config: BindResourceConfig<TService, TIdField>,
  requestId: string,
): Promise<void> {
  if (config.copyResourceToPod) {
    await config.copyResourceToPod(resourceId, pod);
  }

  config.podStoreMethod.bind(canvasId, podId, resourceId);

  if (!config.skipRepositorySync && pod.repositoryId) {
    await repositorySyncService.syncRepositoryResources(pod.repositoryId);
  }

  emitPodUpdated(canvasId, podId, requestId, config.events.bound);

  logger.log(
    config.resourceName as LogCategory,
    "Bind",
    `已將 ${config.resourceName.toLowerCase()}「${resourceId}」綁定到 Pod「${pod.name}」`,
  );
}

export function createBindHandler<
  TService extends { exists: (id: string) => Promise<boolean> },
  TIdField extends string,
>(
  config: BindResourceConfig<TService, TIdField>,
): ReturnType<
  typeof withCanvasId<{ podId: string } & Record<TIdField, string>>
> {
  return withCanvasId<{ podId: string } & Record<TIdField, string>>(
    config.events.bound,
    async (
      connectionId: string,
      canvasId: string,
      payload: { podId: string } & Record<TIdField, string>,
      requestId: string,
    ): Promise<void> => {
      const { podId } = payload;
      const resourceId = payload[config.idField];

      const pod = await validatePodAndResource(
        connectionId,
        canvasId,
        podId,
        resourceId,
        config,
        requestId,
      );
      if (!pod) {
        return;
      }

      if (config.requiredCapability) {
        if (
          !assertCapability(
            connectionId,
            pod,
            config.requiredCapability,
            config.events.bound,
            requestId,
            canvasId,
          )
        )
          return;
      }

      const hasConflict = checkConflict(
        connectionId,
        canvasId,
        podId,
        resourceId,
        pod,
        config,
        requestId,
      );
      if (hasConflict) {
        return;
      }

      await performBind(canvasId, podId, resourceId, pod, config, requestId);
    },
  );
}

function assertUnbindConfig<TService, TIdField extends string>(
  config: BindResourceConfig<TService, TIdField>,
): void {
  if (config.isMultiBind) {
    throw new Error("解綁處理器僅限單一綁定模式使用");
  }

  if (!config.events.unbound) {
    throw new Error("解綁處理器必須提供解綁事件");
  }

  if (!config.podStoreMethod.unbind) {
    throw new Error("解綁處理器必須提供解綁方法");
  }
}

export function createUnbindHandler<TService, TIdField extends string>(
  config: BindResourceConfig<TService, TIdField>,
): ReturnType<typeof withCanvasId<{ podId: string }>> {
  assertUnbindConfig(config);

  return withCanvasId<{ podId: string }>(
    config.events.unbound!,
    async (
      connectionId: string,
      canvasId: string,
      payload: { podId: string },
      requestId: string,
    ): Promise<void> => {
      const { podId } = payload;

      const pod = validatePod(
        connectionId,
        podId,
        config.events.unbound!,
        requestId,
      );
      if (!pod) {
        return;
      }

      const boundId = config.getPodResourceIds(pod);
      if (!boundId) {
        // 已解綁（idempotent 路徑），與 emitPodUpdated 回傳格式一致：pod 包成 PodPublicView
        const response = {
          requestId,
          success: true,
          pod: toPodPublicView(pod),
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

      logger.log(
        config.resourceName as LogCategory,
        "Unbind",
        `已從 Pod「${pod.name}」解綁 ${config.resourceName.toLowerCase()}`,
      );
    },
  );
}
