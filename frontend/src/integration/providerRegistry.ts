import type { IntegrationProviderConfig } from "@/types/integration";
import { slackProviderConfig } from "./providers/slackProvider";
import { telegramProviderConfig } from "./providers/telegramProvider";
import { jiraProviderConfig } from "./providers/jiraProvider";
import { sentryProviderConfig } from "./providers/sentryProvider";

const registry = new Map<string, IntegrationProviderConfig>();

export function registerProvider(config: IntegrationProviderConfig): void {
  registry.set(config.name, config);
}

export function getProvider(name: string): IntegrationProviderConfig {
  const config = registry.get(name);
  if (!config) {
    throw new Error(`找不到 Provider：${name}`);
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
registerProvider(telegramProviderConfig);
registerProvider(jiraProviderConfig);
registerProvider(sentryProviderConfig);
