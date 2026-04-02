import { defineStore } from "pinia";
import type {
  IntegrationApp,
  IntegrationBinding,
  IntegrationConnectionStatus,
} from "@/types/integration";
import {
  createWebSocketRequest,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { getProvider } from "@/integration/providerRegistry";
import { useToast } from "@/composables/useToast";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { useCanvasStore } from "@/stores/canvasStore";
import { t } from "@/i18n";

interface IntegrationStoreState {
  apps: Record<string, IntegrationApp[]>;
}

interface IntegrationAppListResultPayload {
  requestId?: string;
  success?: boolean;
  error?: string;
  provider: string;
  apps: Record<string, unknown>[];
}

interface IntegrationAppCreatedPayload {
  requestId?: string;
  success?: boolean;
  error?: string;
  provider: string;
  app: Record<string, unknown>;
}

interface IntegrationAppDeletedPayload {
  requestId?: string;
  success?: boolean;
  error?: string;
  provider: string;
  appId: string;
}

interface IntegrationAppResourcesRefreshedPayload {
  requestId: string;
  success?: boolean;
  appId: string;
  resources?: Array<{ id: string; name: string }>;
}

interface PodIntegrationBoundPayload {
  requestId?: string;
  success?: boolean;
  error?: string;
  provider: string;
}

interface PodIntegrationUnboundPayload {
  requestId?: string;
  success?: boolean;
  error?: string;
  provider: string;
}

interface IntegrationBasePayload {
  requestId: string;
  [key: string]: unknown;
}

export const useIntegrationStore = defineStore("integration", {
  state: (): IntegrationStoreState => ({
    apps: {},
  }),

  getters: {
    getAppsByProvider:
      (state) =>
      (provider: string): IntegrationApp[] => {
        return state.apps[provider] ?? [];
      },

    getAppById:
      (state) =>
      (provider: string, id: string): IntegrationApp | undefined => {
        return (state.apps[provider] ?? []).find((app) => app.id === id);
      },

    connectedAppsByProvider:
      (state) =>
      (provider: string): IntegrationApp[] => {
        return (state.apps[provider] ?? []).filter(
          (app) => app.connectionStatus === "connected",
        );
      },

    getAppForPodBinding:
      (state) =>
      (binding: IntegrationBinding): IntegrationApp | undefined => {
        return (state.apps[binding.provider] ?? []).find(
          (app) => app.id === binding.appId,
        );
      },
  },

  actions: {
    async loadApps(provider: string): Promise<void> {
      const config = getProvider(provider);

      const response = await createWebSocketRequest<
        IntegrationBasePayload,
        IntegrationAppListResultPayload
      >({
        requestEvent: WebSocketRequestEvents.INTEGRATION_APP_LIST,
        responseEvent: WebSocketResponseEvents.INTEGRATION_APP_LIST_RESULT,
        payload: { provider },
        matchResponse: (res, requestId) =>
          res.requestId === requestId && res.provider === provider,
      });

      if (!response.apps) return;

      this.apps[provider] = response.apps.map((rawApp) =>
        config.transformApp(rawApp),
      );
    },

    async createApp(
      provider: string,
      formValues: Record<string, string>,
    ): Promise<IntegrationApp | null> {
      const config = getProvider(provider);
      const { showSuccessToast } = useToast();
      const { withErrorToast } = useWebSocketErrorHandler();

      const buildPayload = config.buildCreatePayload(formValues);

      const response = await withErrorToast(
        createWebSocketRequest<
          IntegrationBasePayload,
          IntegrationAppCreatedPayload
        >({
          requestEvent: WebSocketRequestEvents.INTEGRATION_APP_CREATE,
          responseEvent: WebSocketResponseEvents.INTEGRATION_APP_CREATED,
          payload: { ...buildPayload, provider },
          matchResponse: (res, requestId) =>
            res.requestId === requestId && res.provider === provider,
        }),
        "Integration",
        t("common.error.create"),
      );

      if (!response?.app) return null;

      const app = config.transformApp(response.app);
      showSuccessToast("Integration", t("common.success.create"), app.name);
      return app;
    },

    async deleteApp(provider: string, appId: string): Promise<void> {
      const config = getProvider(provider);
      const { showSuccessToast } = useToast();
      const { withErrorToast } = useWebSocketErrorHandler();

      const buildPayload = config.buildDeletePayload(appId);

      const response = await withErrorToast(
        createWebSocketRequest<
          IntegrationBasePayload,
          IntegrationAppDeletedPayload
        >({
          requestEvent: WebSocketRequestEvents.INTEGRATION_APP_DELETE,
          responseEvent: WebSocketResponseEvents.INTEGRATION_APP_DELETED,
          payload: { ...buildPayload, provider },
          matchResponse: (res, requestId) =>
            res.requestId === requestId && res.provider === provider,
        }),
        "Integration",
        t("common.error.delete"),
      );

      if (!response) return;

      showSuccessToast("Integration", t("common.success.delete"));
    },

    async bindToPod(
      provider: string,
      podId: string,
      appId: string,
      resourceId: string,
      extra?: Record<string, unknown>,
    ): Promise<void> {
      const config = getProvider(provider);
      const { showErrorToast } = useToast();
      const { withErrorToast } = useWebSocketErrorHandler();
      const canvasStore = useCanvasStore();
      const canvasId = canvasStore.activeCanvasId;

      if (!canvasId) {
        showErrorToast(
          "Integration",
          t("integration.toast.bindFailed"),
          t("integration.toast.noCanvas"),
        );
        return;
      }

      const buildPayload = config.buildBindPayload(
        appId,
        resourceId,
        extra ?? {},
      );

      await withErrorToast(
        createWebSocketRequest<
          IntegrationBasePayload,
          PodIntegrationBoundPayload
        >({
          requestEvent: WebSocketRequestEvents.POD_BIND_INTEGRATION,
          responseEvent: WebSocketResponseEvents.POD_INTEGRATION_BOUND,
          payload: { ...buildPayload, canvasId, podId, provider },
        }),
        "Integration",
        t("integration.toast.bindFailed"),
      );
    },

    async unbindFromPod(provider: string, podId: string): Promise<void> {
      const { showErrorToast } = useToast();
      const { withErrorToast } = useWebSocketErrorHandler();
      const canvasStore = useCanvasStore();
      const canvasId = canvasStore.activeCanvasId;

      if (!canvasId) {
        showErrorToast("Integration", t("integration.toast.unbindFailed"), t("integration.toast.noCanvas"));
        return;
      }

      await withErrorToast(
        createWebSocketRequest<
          IntegrationBasePayload,
          PodIntegrationUnboundPayload
        >({
          requestEvent: WebSocketRequestEvents.POD_UNBIND_INTEGRATION,
          responseEvent: WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
          payload: { canvasId, podId, provider },
        }),
        "Integration",
        t("integration.toast.unbindFailed"),
      );
    },

    async refreshAppResources(provider: string, appId: string): Promise<void> {
      const response = await createWebSocketRequest<
        IntegrationBasePayload,
        IntegrationAppResourcesRefreshedPayload
      >({
        requestEvent: WebSocketRequestEvents.INTEGRATION_APP_RESOURCES_REFRESH,
        responseEvent:
          WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_REFRESHED,
        payload: { appId },
        matchResponse: (res, requestId) => res.requestId === requestId,
      });

      if (!response?.resources) return;

      const config = getProvider(provider);
      const app = (this.apps[provider] ?? []).find((a) => a.id === appId);
      if (!app) return;

      const transformed = config.transformApp({
        ...app.raw,
        resources: response.resources,
      });
      app.resources = transformed.resources;
    },

    addAppFromEvent(provider: string, rawApp: Record<string, unknown>): void {
      const config = getProvider(provider);
      const app = config.transformApp(rawApp);
      if (!this.apps[provider]) {
        this.apps[provider] = [];
      }
      this.apps[provider].push(app);
    },

    removeAppFromEvent(provider: string, appId: string): void {
      if (!this.apps[provider]) return;
      this.apps[provider] = this.apps[provider].filter(
        (app) => app.id !== appId,
      );
    },

    updateAppStatus(
      provider: string,
      appId: string,
      connectionStatus: IntegrationConnectionStatus,
      rawResources?: Array<{ id: string; name: string }>,
    ): void {
      const apps = this.apps[provider] ?? [];
      const app = apps.find((a) => a.id === appId);
      if (!app) return;

      app.connectionStatus = connectionStatus;
      if (rawResources !== undefined) {
        const config = getProvider(provider);
        // 用 transformApp 重新轉換以套用 provider 的 resource 格式化邏輯（如 Slack 的 # 前綴）
        const transformed = config.transformApp({
          ...app.raw,
          resources: rawResources,
          connectionStatus,
        });
        app.resources = transformed.resources;
      }
    },
  },
});
