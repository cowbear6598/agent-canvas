import type {
  IntegrationApp,
  IntegrationProviderConfig,
} from "@/types/integration";
import TelegramIcon from "@/components/icons/TelegramIcon.vue";
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
    provider: "telegram",
    resources: [],
    raw: {
      botUsername: rawApp.botUsername,
    },
  };
}

export const telegramProviderConfig: IntegrationProviderConfig = {
  name: "telegram",
  label: "Telegram",
  icon: TelegramIcon,
  description: "integration.telegram.description",

  get createFormFields() {
    return [
      {
        key: "name",
        get label() {
          return t("integration.telegram.field.name.label");
        },
        get placeholder() {
          return t("integration.telegram.field.name.placeholder");
        },
        type: "text" as const,
        validate: (v: string) =>
          v === "" ? t("integration.telegram.validate.nameRequired") : "",
      },
      {
        key: "botToken",
        get label() {
          return t("integration.telegram.field.botToken.label");
        },
        get placeholder() {
          return t("integration.telegram.field.botToken.placeholder");
        },
        type: "password" as const,
        validate: (v: string) =>
          v === "" ? t("integration.telegram.validate.botTokenRequired") : "",
      },
    ];
  },

  get resourceLabel() {
    return t("integration.telegram.resourceLabel");
  },
  get emptyResourceHint() {
    return t("integration.telegram.emptyResourceHint");
  },
  get emptyAppHint() {
    return t("integration.telegram.emptyAppHint");
  },

  bindingExtraFields: [],

  hasManualResourceInput: () => true,

  get manualResourceInputConfig() {
    return {
      get label() {
        return t("integration.telegram.field.userId.label");
      },
      get placeholder() {
        return t("integration.telegram.field.userId.placeholder");
      },
      get hint() {
        return t("integration.telegram.field.userId.hint");
      },
      validate: (v: string) => {
        const n = parseInt(v, 10);
        return !v || isNaN(n) || n <= 0
          ? t("integration.telegram.validate.userIdInvalid")
          : "";
      },
    };
  },

  connectionStatusConfig: CONNECTION_STATUS_CONFIG,

  transformApp,

  getResources: () => [],

  buildCreatePayload: (formValues) => ({
    name: formValues.name,
    config: {
      botToken: formValues.botToken,
    },
  }),

  buildDeletePayload: (appId) => ({ appId }),

  buildBindPayload: (appId, resourceId, _extra) => ({
    appId,
    resourceId,
    extra: { chatType: "private" },
  }),
};
