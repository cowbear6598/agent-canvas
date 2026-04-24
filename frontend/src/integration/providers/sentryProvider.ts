import type {
  FormFieldDefinition,
  IntegrationApp,
  IntegrationProviderConfig,
} from "@/types/integration";
import SentryIcon from "@/components/icons/SentryIcon.vue";
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
  description: "integration.sentry.description",

  get createFormFields(): FormFieldDefinition[] {
    return [
      {
        key: "name",
        get label(): string {
          return t("integration.sentry.field.name.label");
        },
        get placeholder(): string {
          return t("integration.sentry.field.name.placeholder");
        },
        type: "text" as const,
        validate: (v: string): string => {
          if (v === "") return t("integration.sentry.validate.nameRequired");
          if (v.length > 50)
            return t("integration.sentry.validate.nameTooLong");
          if (!/^[a-zA-Z0-9_-]+$/.test(v))
            return t("integration.sentry.validate.nameInvalid");
          return "";
        },
      },
      {
        key: "clientSecret",
        get label(): string {
          return t("integration.sentry.field.clientSecret.label");
        },
        get placeholder(): string {
          return t("integration.sentry.field.clientSecret.placeholder");
        },
        type: "password" as const,
        validate: (v: string): string => {
          if (v === "")
            return t("integration.sentry.validate.clientSecretRequired");
          if (v.length < 32)
            return t("integration.sentry.validate.clientSecretLength");
          return "";
        },
      },
    ];
  },

  get resourceLabel() {
    return t("integration.sentry.resourceLabel");
  },
  get emptyResourceHint() {
    return t("integration.sentry.emptyResourceHint");
  },
  get emptyAppHint() {
    return t("integration.sentry.emptyAppHint");
  },

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

  buildBindPayload: (appId, _resourceId, _extra) => ({
    appId,
    resourceId: "*",
  }),

  getWebhookUrl: (app) => `/sentry/events/${app.name}`,
};
