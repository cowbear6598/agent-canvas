export type {
  IntegrationConnectionStatus,
  IntegrationResource,
  IntegrationAppConfig,
  IntegrationApp,
  SanitizedIntegrationApp,
  NormalizedEvent,
  IntegrationProvider,
} from "./types.js";

export { integrationRegistry } from "./integrationRegistry.js";
export { integrationAppStore } from "./integrationAppStore.js";
// integrationEventPipeline 刻意不從此 barrel 匯出，避免與 workflow/index.ts 形成循環依賴：
// buildClaudeOptions → integration/index → integrationEventPipeline → workflow/index → podStore → provider/index → buildClaudeOptions
// 請直接從 './integrationEventPipeline.js' 匯入
// export { integrationEventPipeline } from './integrationEventPipeline.js';
