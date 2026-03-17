import { integrationRegistry } from './integrationRegistry.js';
import type { IntegrationProvider } from './types.js';

let webhookRoutes: Map<string, IntegrationProvider> | null = null;

export function buildWebhookRoutes(): Map<string, IntegrationProvider> {
  if (webhookRoutes) return webhookRoutes;

  webhookRoutes = new Map();
  for (const { path, provider } of integrationRegistry.getWebhookRoutes()) {
    webhookRoutes.set(path, provider);
  }

  return webhookRoutes;
}

export async function handleIntegrationWebhook(req: Request, pathname: string): Promise<Response | null> {
  const routes = buildWebhookRoutes();

  // 精確匹配（prefix 模式的 provider 不參與精確匹配）
  const exactProvider = routes.get(pathname);
  if (exactProvider?.handleWebhookRequest && exactProvider.webhookPathMatchMode !== 'prefix') {
    return exactProvider.handleWebhookRequest(req);
  }

  // 前綴匹配（用於支援 webhookPathMatchMode === 'prefix' 的 provider）
  for (const [path, provider] of routes) {
    if (provider.webhookPathMatchMode !== 'prefix') continue;
    if (!pathname.startsWith(path + '/')) continue;

    const subPath = pathname.slice(path.length + 1);
    if (!subPath) continue;
    if (!provider.handleWebhookRequest) continue;

    return provider.handleWebhookRequest(req, subPath);
  }

  return null;
}
