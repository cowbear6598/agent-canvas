import { WebSocketResponseEvents } from "../schemas";
import type {
  IntegrationAppListPayload,
  IntegrationAppCreatePayload,
  IntegrationAppDeletePayload,
  IntegrationAppGetPayload,
  IntegrationAppResourcesPayload,
  IntegrationAppResourcesRefreshPayload,
  PodBindIntegrationPayload,
  PodUnbindIntegrationPayload,
} from "../schemas";
import type {
  SanitizedIntegrationApp,
  IntegrationProvider,
} from "../services/integration/types.js";
import type { IntegrationApp } from "../services/integration/types.js";
import { integrationRegistry } from "../services/integration/integrationRegistry.js";
import { integrationAppStore } from "../services/integration/integrationAppStore.js";
import { podStore } from "../services/podStore.js";
import { socketService } from "../services/socketService.js";
import {
  emitError,
  emitNotFound,
  emitSuccess,
} from "../utils/websocketResponse.js";
import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errorHelpers.js";
import { createI18nError } from "../utils/i18nError.js";
import {
  emitPodUpdated,
  handleResultError,
  getPodDisplayName,
  validatePod,
  withCanvasId,
} from "../utils/handlerHelpers.js";

/**
 * 為任意 Promise 加上逾時機制。
 * 內部正確使用 clearTimeout，確保 promise resolve/reject 後計時器立即被清除，
 * 不會造成計時器累積。
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMsg: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

function sanitizeApp(app: IntegrationApp): SanitizedIntegrationApp {
  const provider = integrationRegistry.get(app.provider);
  const sanitizedConfig = provider ? provider.sanitizeConfig(app.config) : {};
  return {
    id: app.id,
    name: app.name,
    provider: app.provider,
    config: sanitizedConfig,
    connectionStatus: app.connectionStatus,
    resources: app.resources,
  };
}

function getProviderOrEmitError(
  connectionId: string,
  providerName: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string,
  canvasId: string | null,
): IntegrationProvider | null {
  try {
    return integrationRegistry.getOrThrow(providerName);
  } catch {
    emitError(
      connectionId,
      responseEvent,
      createI18nError("errors.providerNotFound", { name: providerName }),
      canvasId,
      requestId,
      undefined,
      "PROVIDER_NOT_FOUND",
    );
    return null;
  }
}

function getAppOrEmitError(
  connectionId: string,
  appId: string,
  responseEvent: WebSocketResponseEvents,
  requestId: string,
): IntegrationApp | null {
  const app = integrationAppStore.getById(appId);
  if (!app) {
    emitNotFound(
      connectionId,
      responseEvent,
      "Integration App",
      appId,
      requestId,
      null,
    );
    return null;
  }
  return app;
}

export async function handleIntegrationAppCreate(
  connectionId: string,
  payload: IntegrationAppCreatePayload,
  requestId: string,
): Promise<void> {
  const { provider: providerName, name, config } = payload;

  const provider = getProviderOrEmitError(
    connectionId,
    providerName,
    WebSocketResponseEvents.INTEGRATION_APP_CREATED,
    requestId,
    null,
  );
  if (!provider) return;

  const schemaResult = provider.createAppSchema.safeParse(config);
  if (!schemaResult.success) {
    const message = schemaResult.error.issues
      .map((issue) => issue.message)
      .join("；");
    emitError(
      connectionId,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      createI18nError("errors.configValidationFailed", { message }),
      null,
      requestId,
      undefined,
      "VALIDATION_ERROR",
    );
    return;
  }

  // 呼叫 provider 的 getExtraDbFields（若有定義），將額外欄位合併到 config 後再存入資料庫
  const extraFields = provider.getExtraDbFields?.(config) ?? {};
  const finalConfig = { ...config, ...extraFields };

  const result = integrationAppStore.create(providerName, name, finalConfig);
  if (
    handleResultError(
      result,
      connectionId,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      requestId,
      createI18nError("errors.integrationAppCreateFailed"),
      null,
    )
  )
    return;

  const app = result.data;

  logger.log(
    "Integration",
    "Create",
    `建立 Integration App「${app.name}」（${provider.displayName}）`,
  );

  // 先回應建立成功（app 已寫入 DB），不等待初始化
  socketService.emitToAll(WebSocketResponseEvents.INTEGRATION_APP_CREATED, {
    requestId,
    success: true,
    provider: providerName,
    app: sanitizeApp(integrationAppStore.getById(app.id) ?? app),
  });

  // 背景執行初始化，狀態變更透過 broadcastConnectionStatus 通知前端。
  // 30 秒逾時：對應 Slack OAuth handshake、外部 API 首次連線等最慢情境的合理上限。
  const INIT_TIMEOUT_MS = 30_000;
  withTimeout(provider.initialize(app), INIT_TIMEOUT_MS, "初始化逾時").catch(
    (error) => {
      logger.error(
        "Integration",
        "Error",
        `Integration App「${app.name}」初始化失敗或逾時：${getErrorMessage(error)}`,
      );
    },
  );
}

export async function handleIntegrationAppDelete(
  connectionId: string,
  payload: IntegrationAppDeletePayload,
  requestId: string,
): Promise<void> {
  const { appId } = payload;

  const app = getAppOrEmitError(
    connectionId,
    appId,
    WebSocketResponseEvents.INTEGRATION_APP_DELETED,
    requestId,
  );
  if (!app) return;

  const provider = getProviderOrEmitError(
    connectionId,
    app.provider,
    WebSocketResponseEvents.INTEGRATION_APP_DELETED,
    requestId,
    null,
  );
  if (!provider) return;

  provider.destroy(appId);

  const boundPods = podStore.findByIntegrationApp(appId);
  for (const { canvasId, pod } of boundPods) {
    podStore.removeIntegrationBinding(canvasId, pod.id, app.provider);
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
      {
        canvasId,
        podId: pod.id,
        provider: app.provider,
      },
    );
    logger.log(
      "Integration",
      "Delete",
      `清除 Pod「${pod.name}」的 ${provider.displayName} 綁定`,
    );
  }

  integrationAppStore.delete(appId);

  logger.log(
    "Integration",
    "Delete",
    `已刪除 Integration App「${app.name}」（${provider.displayName}）`,
  );

  socketService.emitToAll(WebSocketResponseEvents.INTEGRATION_APP_DELETED, {
    requestId,
    success: true,
    appId,
    provider: app.provider,
  });
}

export async function handleIntegrationAppList(
  connectionId: string,
  payload: IntegrationAppListPayload,
  requestId: string,
): Promise<void> {
  const { provider } = payload;
  const apps = integrationAppStore.list(provider);
  emitSuccess(
    connectionId,
    WebSocketResponseEvents.INTEGRATION_APP_LIST_RESULT,
    {
      requestId,
      success: true,
      provider,
      apps: apps.map(sanitizeApp),
    },
  );
}

export async function handleIntegrationAppGet(
  connectionId: string,
  payload: IntegrationAppGetPayload,
  requestId: string,
): Promise<void> {
  const { appId } = payload;

  const app = getAppOrEmitError(
    connectionId,
    appId,
    WebSocketResponseEvents.INTEGRATION_APP_GET_RESULT,
    requestId,
  );
  if (!app) return;

  emitSuccess(
    connectionId,
    WebSocketResponseEvents.INTEGRATION_APP_GET_RESULT,
    {
      requestId,
      success: true,
      app: sanitizeApp(app),
    },
  );
}

export async function handleIntegrationAppResources(
  connectionId: string,
  payload: IntegrationAppResourcesPayload,
  requestId: string,
): Promise<void> {
  const { appId } = payload;

  const app = getAppOrEmitError(
    connectionId,
    appId,
    WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_RESULT,
    requestId,
  );
  if (!app) return;

  emitSuccess(
    connectionId,
    WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_RESULT,
    {
      requestId,
      success: true,
      appId,
      resources: app.resources,
    },
  );
}

export async function handleIntegrationAppResourcesRefresh(
  connectionId: string,
  payload: IntegrationAppResourcesRefreshPayload,
  requestId: string,
): Promise<void> {
  const { appId } = payload;

  const app = getAppOrEmitError(
    connectionId,
    appId,
    WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_REFRESHED,
    requestId,
  );
  if (!app) return;

  const provider = getProviderOrEmitError(
    connectionId,
    app.provider,
    WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_REFRESHED,
    requestId,
    null,
  );
  if (!provider) return;

  let resources;
  try {
    resources = await provider.refreshResources(appId);
  } catch (error) {
    emitError(
      connectionId,
      WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_REFRESHED,
      createI18nError("errors.refreshResourcesFailed", {
        message: getErrorMessage(error),
      }),
      null,
      requestId,
    );
    return;
  }

  logger.log(
    "Integration",
    "Complete",
    `Integration App「${app.name}」Resources 已重新整理`,
  );

  emitSuccess(
    connectionId,
    WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_REFRESHED,
    {
      requestId,
      success: true,
      appId,
      resources,
    },
  );
}

export const handlePodBindIntegration = withCanvasId<PodBindIntegrationPayload>(
  WebSocketResponseEvents.POD_INTEGRATION_BOUND,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodBindIntegrationPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, appId, resourceId, provider: providerName, extra } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      requestId,
    );
    if (!pod) return;

    const app = integrationAppStore.getById(appId);
    if (!app) {
      emitNotFound(
        connectionId,
        WebSocketResponseEvents.POD_INTEGRATION_BOUND,
        "Integration App",
        appId,
        requestId,
        canvasId,
      );
      return;
    }

    if (app.connectionStatus !== "connected") {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_INTEGRATION_BOUND,
        createI18nError("errors.integrationAppNotConnected", {
          name: app.name,
        }),
        canvasId,
        requestId,
        undefined,
        "NOT_CONNECTED",
      );
      return;
    }

    const provider = getProviderOrEmitError(
      connectionId,
      providerName,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      requestId,
      canvasId,
    );
    if (!provider) return;

    const resource = app.resources.find((r) => r.id === resourceId);
    if (!resource && provider.strictResourceValidation) {
      emitNotFound(
        connectionId,
        WebSocketResponseEvents.POD_INTEGRATION_BOUND,
        "Resource",
        resourceId,
        requestId,
        canvasId,
      );
      return;
    }

    podStore.addIntegrationBinding(canvasId, podId, {
      provider: providerName,
      appId,
      resourceId,
      ...(extra ? { extra } : {}),
    });

    const resourceName = resource?.name ?? resourceId;
    logger.log(
      "Integration",
      "Create",
      `Pod「${pod.name}」已綁定 ${provider.displayName} App「${app.name}」Resource「${resourceName}」`,
    );

    emitPodUpdated(
      canvasId,
      podId,
      requestId,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
    );
  },
);

export const handlePodUnbindIntegration =
  withCanvasId<PodUnbindIntegrationPayload>(
    WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
    async (
      connectionId: string,
      canvasId: string,
      payload: PodUnbindIntegrationPayload,
      requestId: string,
    ): Promise<void> => {
      const { podId, provider: providerName } = payload;

      const pod = validatePod(
        connectionId,
        podId,
        WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
        requestId,
      );
      if (!pod) return;

      const hasBinding = pod.integrationBindings?.some(
        (binding) => binding.provider === providerName,
      );
      if (!hasBinding) {
        emitError(
          connectionId,
          WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
          createI18nError("errors.podProviderNotBound", {
            podName: getPodDisplayName(canvasId, podId),
            provider: providerName,
          }),
          canvasId,
          requestId,
          undefined,
          "NOT_BOUND",
        );
        return;
      }

      podStore.removeIntegrationBinding(canvasId, podId, providerName);

      logger.log(
        "Integration",
        "Delete",
        `Pod「${getPodDisplayName(canvasId, podId)}」已解除 ${providerName} 綁定`,
      );

      emitPodUpdated(
        canvasId,
        podId,
        requestId,
        WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
      );
    },
  );
