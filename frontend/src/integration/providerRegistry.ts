import type { IntegrationProviderConfig } from "@/types/integration";
import { slackProviderConfig } from "./providers/slackProvider";
import { discordProviderConfig } from "./providers/discordProvider";
import { telegramProviderConfig } from "./providers/telegramProvider";
import { jiraProviderConfig } from "./providers/jiraProvider";
import { sentryProviderConfig } from "./providers/sentryProvider";
import { webhookProviderConfig } from "./providers/webhookProvider";
import { t } from "@/i18n";

const registry = new Map<string, IntegrationProviderConfig>();

function registerProvider(config: IntegrationProviderConfig): void {
  registry.set(config.name, config);
}

export function getProvider(name: string): IntegrationProviderConfig {
  const config = registry.get(name);
  if (!config) {
    throw new Error(t("errors.providerNotFound", { name }));
  }
  return config;
}

export function findProvider(name: string): IntegrationProviderConfig | null {
  return registry.get(name) ?? null;
}

export function getAllProviders(): IntegrationProviderConfig[] {
  return Array.from(registry.values());
}

registerProvider(slackProviderConfig);
registerProvider(discordProviderConfig);
registerProvider(telegramProviderConfig);
registerProvider(jiraProviderConfig);
registerProvider(sentryProviderConfig);
registerProvider(webhookProviderConfig);
