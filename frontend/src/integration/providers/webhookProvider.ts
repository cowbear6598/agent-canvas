import type {
  IntegrationApp,
  IntegrationProviderConfig,
} from "@/types/integration";
import { Webhook } from "lucide-vue-next";
import { t } from "@/i18n";

const CONNECTION_STATUS_CONFIG: IntegrationProviderConfig["connectionStatusConfig"] =
  {
    connected: { dotClass: "bg-green-500", bg: "bg-white", label: "connected" },
    disconnected: {
      dotClass: "bg-red-500",
      bg: "bg-red-100",
      label: "disconnected",
    },
    error: { dotClass: "bg-red-500", bg: "bg-red-100", label: "error" },
  };

function transformApp(rawApp: Record<string, unknown>): IntegrationApp {
  return {
    id: String(rawApp.id ?? ""),
    name: String(rawApp.name ?? ""),
    connectionStatus:
      (rawApp.connectionStatus as IntegrationApp["connectionStatus"]) ??
      "connected",
    provider: "webhook",
    resources: [],
    raw: rawApp,
  };
}

export const webhookProviderConfig: IntegrationProviderConfig = {
  name: "webhook",
  label: "Webhook",
  icon: Webhook,
  description: "integration.webhook.description",

  get createFormFields() {
    return [
      {
        key: "name",
        get label() {
          return t("integration.webhook.field.name.label");
        },
        get placeholder() {
          return t("integration.webhook.field.name.placeholder");
        },
        type: "text" as const,
        validate: (v: string): string => {
          if (v === "") return t("integration.webhook.validate.nameRequired");
          if (v.length > 50)
            return t("integration.webhook.validate.nameTooLong");
          if (!/^[a-zA-Z0-9_-]+$/.test(v))
            return t("integration.webhook.validate.nameInvalid");
          return "";
        },
      },
    ];
  },

  get resourceLabel() {
    return "";
  },
  get emptyResourceHint() {
    return "";
  },
  get emptyAppHint() {
    return t("integration.webhook.emptyAppHint");
  },

  connectionStatusConfig: CONNECTION_STATUS_CONFIG,

  hasNoResource: true,

  transformApp,

  getResources: () => [],

  buildCreatePayload: (formValues) => ({
    name: formValues.name,
    config: {},
  }),

  buildDeletePayload: (appId) => ({ appId }),

  buildBindPayload: (appId, _resourceId, _extra) => ({
    appId,
    resourceId: "*",
  }),

  getWebhookUrl: (app) => `/webhook/${app.name}`,

  getTokenValue: (app) => (app.raw as any).config?.token ?? null,

  tokenLabel: "integration.webhook.token.label",
};
