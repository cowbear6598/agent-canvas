import type { AgentProvider } from "./types.js";
import { claudeProvider } from "./claudeProvider.js";
import { codexProvider } from "./codexProvider.js";

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Provider 登記表（registry）。
 *
 * 以 `as const` 讓 TypeScript 推導 key 字面型別，`ProviderName` 型別由此衍生。
 * 未來新增第三個 provider 時，只需在此加一個 key，ProviderName 自動擴展，
 * 不需要動 executor / chatHandlers 等呼叫端。
 */
export const providerRegistry = {
  claude: claudeProvider,
  codex: codexProvider,
} as const;

/**
 * 所有支援的 Provider 名稱型別，由 providerRegistry 的 key 自動推導。
 * 不再需要手動維護 "claude" | "codex" 字面型別。
 */
export type ProviderName = keyof typeof providerRegistry;

// ─── Provider 存取 ────────────────────────────────────────────────────────────

/**
 * 同步取得指定 Provider 的 singleton 實例。
 *
 * 直接從 providerRegistry 讀取，不需要快取。
 *
 * @throws Error 若 name 不存在於 providerRegistry（TypeScript 型別系統已防止此情況）
 */
export function getProvider(name: ProviderName): AgentProvider {
  return providerRegistry[name];
}

// ─── Re-exports ───────────────────────────────────────────────────────────────
export type {
  AgentProvider,
  ProviderCapabilities,
  ProviderMetadata,
  ChatRequestContext,
  NormalizedEvent,
} from "./types.js";
export { CLAUDE_CAPABILITIES, CODEX_CAPABILITIES } from "./capabilities.js";
