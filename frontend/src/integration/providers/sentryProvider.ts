import type {
  IntegrationApp,
  IntegrationProviderConfig,
} from "@/types/integration";
import SentryIcon from "@/components/icons/SentryIcon.vue";

const CONNECTION_STATUS_CONFIG: IntegrationProviderConfig["connectionStatusConfig"] =
  {
    connected: { dotClass: "bg-green-500", bg: "bg-white", label: "已連接" },
    disconnected: { dotClass: "bg-red-500", bg: "bg-red-100", label: "已斷線" },
    error: { dotClass: "bg-red-500", bg: "bg-red-100", label: "錯誤" },
  };

function transformApp(rawApp: Record<string, unknown>): IntegrationApp {
  return {
    id: String(rawApp.id ?? ""),
    name: String(rawApp.name ?? ""),
    connectionStatus:
      (rawApp.connectionStatus as IntegrationApp["connectionStatus"]) ??
      "disconnected",
    provider: "sentry",
    resources: [],
    raw: rawApp,
  };
}

export const sentryProviderConfig: IntegrationProviderConfig = {
  name: "sentry",
  label: "Sentry",
  icon: SentryIcon,
  description: "管理 Sentry App 連線與設定",

  createFormFields: [
    {
      key: "name",
      label: "名稱",
      placeholder: "例如：my-sentry-app",
      type: "text",
      validate: (v): string => {
        if (v === "") return "名稱不可為空";
        if (v.length > 50) return "名稱最多 50 個字元";
        if (!/^[a-zA-Z0-9_-]+$/.test(v))
          return "名稱只允許英文字母、數字、底線與連字號";
        return "";
      },
    },
    {
      key: "clientSecret",
      label: "Client Secret",
      placeholder: "Sentry Internal Integration 的 Client Secret",
      type: "password",
      validate: (v): string => {
        if (v === "") return "Client Secret 不可為空";
        if (v.length < 32) return "Client Secret 至少需要 32 個字元";
        return "";
      },
    },
  ],

  resourceLabel: "",
  emptyResourceHint: "",
  emptyAppHint: "尚未註冊任何 Sentry App",

  connectionStatusConfig: CONNECTION_STATUS_CONFIG,

  hasNoResource: true,

  transformApp,

  getResources: () => [],

  buildCreatePayload: (formValues) => ({
    name: formValues.name,
    config: {
      clientSecret: formValues.clientSecret,
    },
  }),

  buildDeletePayload: (appId) => ({ appId }),

  buildBindPayload: (appId, _resourceId) => ({
    appId,
    resourceId: "*",
  }),

  getWebhookUrl: (app) => `/sentry/events/${app.name}`,
};
