import type { AgentProvider } from "./types.js";
import { claudeProvider } from "./claudeProvider.js";
import { codexProvider } from "./codexProvider.js";
import { geminiProvider } from "./geminiProvider.js";

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
  gemini: geminiProvider,
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

// ─── 模型解析 helper ──────────────────────────────────────────────────────────

export interface ResolvedModelResult {
  /** 實際使用的模型名稱（若 fallback 則與輸入不同） */
  resolved: string;
  /** 是否發生了 fallback（輸入模型不合法，改用 provider 預設模型） */
  didFallback: boolean;
}

/**
 * 驗證傳入的 model 是否在該 provider 的合法清單內。
 * 不合法時 fallback 到 provider 預設模型。
 *
 * connectionStore.create、connectionStore.update 與 disposableChatService
 * 均呼叫此 helper，避免三處重複相同的驗證邏輯。
 */
export function resolveModelWithFallback(
  provider: ProviderName,
  requestedModel: string,
): ResolvedModelResult {
  const metadata = getProvider(provider).metadata;
  const isValid = metadata.availableModelValues.has(requestedModel);

  if (isValid) {
    return { resolved: requestedModel, didFallback: false };
  }

  const resolved =
    (metadata.defaultOptions as { model?: string }).model ?? requestedModel;
  return { resolved, didFallback: true };
}

// ─── Re-exports ───────────────────────────────────────────────────────────────
export type {
  AgentProvider,
  ProviderCapabilities,
  ProviderMetadata,
  ChatRequestContext,
  NormalizedEvent,
} from "./types.js";
export {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  GEMINI_CAPABILITIES,
} from "./capabilities.js";
