import type {
  BindingExtraFieldDefinition,
  FormFieldDefinition,
  IntegrationApp,
  IntegrationProviderConfig,
} from "@/types/integration";
import JiraIcon from "@/components/icons/JiraIcon.vue";
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
    provider: "jira",
    resources: [],
    raw: rawApp,
  };
}

export const jiraProviderConfig: IntegrationProviderConfig = {
  name: "jira",
  label: "Jira",
  icon: JiraIcon,
  description: "integration.jira.description",

  get createFormFields(): FormFieldDefinition[] {
    return [
      {
        key: "name",
        get label(): string {
          return t("integration.jira.field.name.label");
        },
        get placeholder(): string {
          return t("integration.jira.field.name.placeholder");
        },
        type: "text" as const,
        validate: (v: string): string => {
          if (v === "") return t("integration.jira.validate.nameRequired");
          if (!/^[a-zA-Z0-9_-]+$/.test(v))
            return t("integration.jira.validate.nameInvalid");
          return "";
        },
      },
      {
        key: "siteUrl",
        get label(): string {
          return t("integration.jira.field.siteUrl.label");
        },
        get placeholder(): string {
          return t("integration.jira.field.siteUrl.placeholder");
        },
        type: "text" as const,
        validate: (v: string): string => {
          if (v === "") return t("integration.jira.validate.siteUrlRequired");
          if (!v.startsWith("https://"))
            return t("integration.jira.validate.siteUrlPrefix");
          return "";
        },
      },
      {
        key: "webhookSecret",
        get label(): string {
          return t("integration.jira.field.webhookSecret.label");
        },
        get placeholder(): string {
          return t("integration.jira.field.webhookSecret.placeholder");
        },
        type: "password" as const,
        validate: (v: string): string => {
          if (v === "")
            return t("integration.jira.validate.webhookSecretRequired");
          if (v.length < 16)
            return t("integration.jira.validate.webhookSecretLength");
          return "";
        },
      },
    ];
  },

  get resourceLabel() {
    return t("integration.jira.resourceLabel");
  },
  get emptyResourceHint() {
    return t("integration.jira.emptyResourceHint");
  },
  get emptyAppHint() {
    return t("integration.jira.emptyAppHint");
  },

  get bindingExtraFields(): BindingExtraFieldDefinition[] {
    return [
      {
        key: "eventFilter",
        get label(): string {
          return t("integration.jira.eventFilter.label");
        },
        type: "radio" as const,
        get options(): Array<{ value: string; label: string }> {
          return [
            {
              value: "all",
              get label(): string {
                return t("integration.jira.eventFilter.all");
              },
            },
            {
              value: "status_changed",
              get label(): string {
                return t("integration.jira.eventFilter.statusChanged");
              },
            },
          ];
        },
        defaultValue: "all",
      },
    ];
  },

  connectionStatusConfig: CONNECTION_STATUS_CONFIG,

  hasNoResource: true,

  transformApp,

  getResources: () => [],

  buildCreatePayload: (formValues) => ({
    name: formValues.name,
    config: {
      siteUrl: formValues.siteUrl,
      webhookSecret: formValues.webhookSecret,
    },
  }),

  buildDeletePayload: (appId) => ({ appId }),

  buildBindPayload: (appId, _resourceId, extra) => ({
    appId,
    resourceId: "*",
    extra: { eventFilter: extra.eventFilter },
  }),
};
