/**
 * ProviderConfigResolver：集中管理 Pod 的 provider / providerConfig 解析邏輯。
 *
 * 提供單一高階入口 resolveProviderFields，讓 PodStore 只需呼叫一個函式，
 * 取代原本五個私有 method（resolveProvider / sanitizeProviderConfig /
 * sanitizeProviderConfigStrict / ensureModelField / warnIfModelOutOfRange）散落於 PodStore 中。
 *
 * 讀取路徑（DB → Pod）使用 resolveProviderFields。
 * 寫入路徑（create / update）使用 sanitizeProviderConfigStrict。
 */

import type { ProviderName } from "../provider/types.js";
import { getProvider, providerRegistry } from "../provider/index.js";
import {
  CLAUDE_MODEL_THINKING_LEVELS,
  CODEX_MODEL_THINKING_LEVELS,
  GEMINI_MODEL_THINKING_LEVELS,
} from "../provider/capabilities.js";
import { logger } from "../../utils/logger.js";

/**
 * 取得指定 provider + model 的 default thinking level。
 * 找不到對應 record 或該 model 不支援 thinking level 時回傳 null。
 */
export function getDefaultThinkingLevel(
  provider: ProviderName,
  model: string,
): string | null {
  let table:
    | Readonly<
        Record<string, { levels: readonly string[]; default: string | null }>
      >
    | undefined;
  if (provider === "claude") {
    table = CLAUDE_MODEL_THINKING_LEVELS;
  } else if (provider === "codex") {
    table = CODEX_MODEL_THINKING_LEVELS;
  } else if (provider === "gemini") {
    table = GEMINI_MODEL_THINKING_LEVELS;
  }
  if (!table) return null;
  const entry = table[model];
  if (!entry) return null;
  return entry.default;
}

/**
 * 白名單過濾 providerConfig，只保留合法欄位（目前僅 model）。
 * 不驗證 model 值是否在 provider 的 availableModels 內，供讀取路徑（DB → Pod 物件）使用，
 * 避免舊 pod 中可能存在的不合法 model 值造成 Pod 打不開。寫入路徑請改用 sanitizeProviderConfigStrict。
 * 歷史 DB 舊格式 {provider, model} 需淨化為 {model} 以符合 .strict() schema，前端型別曾為 discriminated union 導致多餘 key 流入。
 */
function sanitizeProviderConfig(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  if ("model" in raw) {
    sanitized.model = raw.model;
  }
  if ("thinkingLevel" in raw) {
    sanitized.thinkingLevel = raw.thinkingLevel;
  }
  return sanitized;
}

/**
 * 讀取路徑下的 warn log：若 DB 中的 model 不在 provider 的 availableModels 內，
 * 記錄一次 warn log 但不丟棄原值（不影響 Pod 載入）。
 */
function warnIfModelOutOfRange(
  model: unknown,
  provider: ProviderName,
  podId: string,
): void {
  if (typeof model !== "string") {
    logger.warn(
      "Pod",
      "Warn",
      `DB 中 Pod ${podId} 的 providerConfig.model 非字串值（typeof=${typeof model}），略過範圍檢查`,
    );
    return;
  }
  const { availableModelValues } = getProvider(provider).metadata;
  if (!availableModelValues.has(model)) {
    logger.warn(
      "Pod",
      "Warn",
      `DB 中 Pod ${podId} 的 providerConfig.model 值 ${model} 不在 provider ${provider} 的 availableModels 內，保留原值`,
    );
  }
}

/**
 * 確保 sanitized 物件含有 model 欄位：
 * 若缺少則補入 provider 預設值；若已有則做 availableModels 範圍檢查並 warn log（保留原值）。
 */
function ensureModelField(
  sanitized: Record<string, unknown>,
  provider: ProviderName,
  podId: string,
): void {
  if (!("model" in sanitized)) {
    const defaultOptions = getProvider(provider).metadata
      .defaultOptions as Record<string, unknown>;
    sanitized.model = defaultOptions.model;
  } else {
    warnIfModelOutOfRange(sanitized.model, provider, podId);
  }
}

/**
 * 解析 DB row 的 provider 欄位，不合法值 fallback 為 'claude'。
 * DB 欄位可能為空或含歷史非法值，需 fallback 以保持向後相容。
 */
export function resolveProvider(rawProvider: string): ProviderName {
  // 以 providerRegistry 的 key 作為白名單，未來新增 provider 時自動涵蓋，不需回頭改這個函式
  const isValidProvider = (value: unknown): value is ProviderName =>
    typeof value === "string" && value in providerRegistry;

  if (!isValidProvider(rawProvider)) {
    const rawValue = String(rawProvider);
    const safeValue = /^[a-z0-9_-]{1,32}$/.test(rawValue)
      ? rawValue
      : `<invalid format, len=${rawValue.length}>`;
    logger.warn(
      "Pod",
      "Warn",
      `收到未知 provider 值：${safeValue}，已 fallback 為 claude`,
    );
    return "claude";
  }
  return rawProvider as ProviderName;
}

/**
 * 解析 DB row 的 providerConfig JSON 字串，缺少 model 時補入對應 provider 的預設值。
 * 供讀取路徑（DB → Pod 物件）使用。
 *
 * @param providerConfigJson DB 中 provider_config_json 欄位原始值（可為 null）
 * @param rawConfig 已 JSON.parse 的物件（由 safeJsonParse 提供，為 null 時請傳 {}）
 * @param provider 已解析的 ProviderName
 * @param podId 僅用於 warn log
 */
export function resolveProviderConfig(
  rawConfig: Record<string, unknown>,
  provider: ProviderName,
  podId: string,
): Record<string, unknown> {
  // 讀取路徑：使用 relaxed 版本白名單過濾，丟棄舊格式中的 provider 等多餘 key；
  // 不驗證 model 是否在 availableModels 內，避免舊 pod 的歷史 model 值導致 Pod 打不開
  const sanitized = sanitizeProviderConfig(rawConfig);
  ensureModelField(sanitized, provider, podId);

  // 既有 Pod（在 thinking level 功能上線前建立）DB 中沒有 thinkingLevel key，
  // 在讀取路徑補入該 model 的 default，使 UI 上能直接顯示對應顏色；
  // 若 default 為 null（model 不支援 thinking）則不寫入。
  if (!("thinkingLevel" in sanitized)) {
    const defaultLevel = getDefaultThinkingLevel(
      provider,
      sanitized.model as string,
    );
    if (defaultLevel !== null) {
      sanitized.thinkingLevel = defaultLevel;
    }
  }

  return sanitized;
}

/**
 * 嚴格版的 providerConfig 白名單過濾：在保留 model 欄位後，
 * 會檢查 model 值是否在指定 provider 的 metadata.availableModels 清單內，
 * 不合法時 throw Error（不 fallback），供寫入路徑（create / update）使用。
 */
export function sanitizeProviderConfigStrict(
  raw: Record<string, unknown>,
  provider: ProviderName,
): Record<string, unknown> {
  const sanitized = sanitizeProviderConfig(raw);

  if ("model" in sanitized) {
    const { availableModelValues } = getProvider(provider).metadata;
    if (!availableModelValues.has(sanitized.model as string)) {
      throw new Error(`Provider ${provider} 不支援此 model`);
    }
  } else {
    // 補填預設 model：寫入路徑若未指定 model，自動補入 provider 預設值
    const defaultOptions = getProvider(provider).metadata
      .defaultOptions as Record<string, unknown>;
    sanitized.model = defaultOptions.model;
  }

  // 自動注入該 model 的 default thinkingLevel：
  // 僅在使用者「未顯式傳入」（raw 中沒有 thinkingLevel key）且該 model 有 default 時補入；
  // 若 default 為 null（model 不支援 thinking）則不寫入，避免 Haiku/Gemini 出現 thinkingLevel 欄位。
  if (!("thinkingLevel" in raw)) {
    const defaultLevel = getDefaultThinkingLevel(
      provider,
      sanitized.model as string,
    );
    if (defaultLevel !== null) {
      sanitized.thinkingLevel = defaultLevel;
    }
  }

  return sanitized;
}
