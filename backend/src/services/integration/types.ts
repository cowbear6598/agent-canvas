import type { z } from 'zod';
import type { Result } from '../../types/index.js';
import type { IntegrationConnectionStatus } from '../../types/integration.js';

export type { IntegrationConnectionStatus };

export interface IntegrationResource {
  id: string;
  name: string;
  [key: string]: unknown;
}

export type IntegrationAppConfig = {
  [key: string]: unknown;
};

export interface IntegrationApp {
  id: string;
  name: string;
  provider: string;
  config: IntegrationAppConfig;
  connectionStatus: IntegrationConnectionStatus;
  resources: IntegrationResource[];
}

export type SanitizedIntegrationApp = Omit<IntegrationApp, 'config'> & {
  config: Record<string, unknown>;
};

export interface NormalizedEvent {
  provider: string;
  appId: string;
  resourceId: string;
  userName: string;
  text: string;
  rawEvent: unknown;
  senderId?: string;
  messageTs?: string;
  threadTs?: string;
  messageId?: number;
}

export interface IntegrationProvider {
  name: string;
  displayName: string;
  createAppSchema: z.ZodType;
  bindSchema: z.ZodType;

  validateCreate(config: IntegrationAppConfig): Result<void>;
  sanitizeConfig(config: IntegrationAppConfig): Record<string, unknown>;
  getExtraDbFields?(config: IntegrationAppConfig): Record<string, unknown>;

  initialize(app: IntegrationApp): Promise<void>;
  destroy(appId: string): void;
  destroyAll(): void;
  refreshResources(appId: string): Promise<IntegrationResource[]>;
  sendMessage?(appId: string, resourceId: string, text: string, extra?: Record<string, unknown>): Promise<Result<void>>;
  buildAckExtra?(event: NormalizedEvent): Record<string, unknown>;

  formatEventMessage(event: unknown, app: IntegrationApp): NormalizedEvent | null;

  // 允許手動輸入 Resource ID（跳過 resources 列表驗證）
  allowManualResourceId?: boolean;

  webhookPath?: string;
  webhookPathMatchMode?: 'exact' | 'prefix';
  handleWebhookRequest?(req: Request, subPath?: string): Promise<Response>;
  startPolling?(appId: string, config: IntegrationAppConfig): void;
  stopPolling?(appId: string): void;
}
