import type {
  FormFieldDefinition,
  IntegrationApp,
  IntegrationProviderConfig,
  IntegrationResource,
} from "@/types/integration";
import DiscordIcon from "@/components/icons/DiscordIcon.vue";
import { t } from "@/i18n";

type DiscordRawResource = {
  id?: unknown;
  name?: unknown;
  guildName?: unknown;
  channelName?: unknown;
};

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

function formatChannelLabel(resource: DiscordRawResource): string {
  const rawChannelName =
    typeof resource.channelName === "string" && resource.channelName.trim() !== ""
      ? resource.channelName.trim()
      : typeof resource.name === "string" && resource.name.trim() !== ""
        ? resource.name.trim()
        : String(resource.id ?? "");
  const normalizedChannelName = rawChannelName.startsWith("#")
    ? rawChannelName
    : `#${rawChannelName}`;
  const guildName =
    typeof resource.guildName === "string" && resource.guildName.trim() !== ""
      ? resource.guildName.trim()
      : "";

  return guildName !== ""
    ? `${guildName} / ${normalizedChannelName}`
    : normalizedChannelName;
}

function transformApp(rawApp: Record<string, unknown>): IntegrationApp {
  const rawResources =
    (rawApp.resources as DiscordRawResource[] | undefined) ?? [];
  const resources: IntegrationResource[] = rawResources.map((resource) => ({
    id: String(resource.id ?? ""),
    label: formatChannelLabel(resource),
  }));

  return {
    id: String(rawApp.id ?? ""),
    name: String(rawApp.name ?? ""),
    connectionStatus:
      (rawApp.connectionStatus as IntegrationApp["connectionStatus"]) ??
      "disconnected",
    provider: "discord",
    resources,
    raw: rawApp,
  };
}

export const discordProviderConfig: IntegrationProviderConfig = {
  name: "discord",
  get label(): string {
    return t("integration.discord.label");
  },
  icon: DiscordIcon,
  description: "integration.discord.description",

  get createFormFields(): FormFieldDefinition[] {
    return [
      {
        key: "name",
        get label(): string {
          return t("integration.discord.field.name.label");
        },
        get placeholder(): string {
          return t("integration.discord.field.name.placeholder");
        },
        type: "text" as const,
        validate: (value: string): string =>
          value === "" ? t("integration.discord.validate.nameRequired") : "",
      },
      {
        key: "botToken",
        get label(): string {
          return t("integration.discord.field.botToken.label");
        },
        get placeholder(): string {
          return t("integration.discord.field.botToken.placeholder");
        },
        type: "password" as const,
        validate: (value: string): string =>
          value === ""
            ? t("integration.discord.validate.botTokenRequired")
            : "",
      },
    ];
  },

  get resourceLabel() {
    return t("integration.discord.resourceLabel");
  },
  get emptyResourceHint() {
    return t("integration.discord.emptyResourceHint");
  },
  get emptyAppHint() {
    return t("integration.discord.emptyAppHint");
  },

  connectionStatusConfig: CONNECTION_STATUS_CONFIG,

  transformApp,

  getResources: (app) =>
    app.resources.filter((resource) => String(resource.id).trim() !== ""),

  buildCreatePayload: (formValues) => ({
    name: formValues.name,
    config: {
      botToken: formValues.botToken,
    },
  }),

  buildDeletePayload: (appId) => ({ appId }),

  buildBindPayload: (appId, resourceId, _extra) => ({
    appId,
    resourceId: String(resourceId),
  }),
};
