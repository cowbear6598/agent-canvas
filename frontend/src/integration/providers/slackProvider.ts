import type {
  FormFieldDefinition,
  IntegrationApp,
  IntegrationProviderConfig,
  IntegrationResource,
} from "@/types/integration";
import SlackIcon from "@/components/icons/SlackIcon.vue";
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
  const rawResources =
    (rawApp.resources as Array<{ id: string; name: string }> | undefined) ?? [];
  const resources: IntegrationResource[] = rawResources.map((r) => ({
    id: r.id,
    label: "#" + r.name,
  }));

  return {
    id: String(rawApp.id ?? ""),
    name: String(rawApp.name ?? ""),
    connectionStatus:
      (rawApp.connectionStatus as IntegrationApp["connectionStatus"]) ??
      "disconnected",
    provider: "slack",
    resources,
    raw: rawApp,
  };
}

export const slackProviderConfig: IntegrationProviderConfig = {
  name: "slack",
  label: "Slack",
  icon: SlackIcon,
  description: "integration.slack.description",

  get createFormFields(): FormFieldDefinition[] {
    return [
      {
        key: "name",
        get label(): string {
          return t("integration.slack.field.name.label");
        },
        get placeholder(): string {
          return t("integration.slack.field.name.placeholder");
        },
        type: "text" as const,
        validate: (v: string): string =>
          v === "" ? t("integration.slack.validate.nameRequired") : "",
      },
      {
        key: "botToken",
        get label(): string {
          return t("integration.slack.field.botToken.label");
        },
        get placeholder(): string {
          return t("integration.slack.field.botToken.placeholder");
        },
        type: "password" as const,
        validate: (v: string): string => {
          if (v === "") return t("integration.slack.validate.botTokenRequired");
          if (!v.startsWith("xoxb-"))
            return t("integration.slack.validate.botTokenPrefix");
          return "";
        },
      },
      {
        key: "signingSecret",
        get label(): string {
          return t("integration.slack.field.signingSecret.label");
        },
        get placeholder(): string {
          return t("integration.slack.field.signingSecret.placeholder");
        },
        type: "password" as const,
        validate: (v: string): string =>
          v === "" ? t("integration.slack.validate.signingSecretRequired") : "",
      },
    ];
  },

  get resourceLabel() {
    return t("integration.slack.resourceLabel");
  },
  get emptyResourceHint() {
    return t("integration.slack.emptyResourceHint");
  },
  get emptyAppHint() {
    return t("integration.slack.emptyAppHint");
  },
  bindingExtraFields: undefined,

  connectionStatusConfig: CONNECTION_STATUS_CONFIG,

  transformApp,

  getResources: (app) => app.resources,

  buildCreatePayload: (formValues) => ({
    name: formValues.name,
    config: {
      botToken: formValues.botToken,
      signingSecret: formValues.signingSecret,
    },
  }),

  buildDeletePayload: (appId) => ({ appId }),

  buildBindPayload: (appId, resourceId, _extra) => ({ appId, resourceId }),
};
