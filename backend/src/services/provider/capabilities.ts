import type { ProviderCapabilities } from "./types.js";

/** Claude Provider 支援所有功能 */
export const CLAUDE_CAPABILITIES: Readonly<ProviderCapabilities> =
  Object.freeze({
    chat: true,
    plugin: true,
    repository: true,
    mcp: true,
  });

/** Codex Provider 與 Claude 行為一致。 */
export const CODEX_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze(
  {
    chat: true,
    plugin: true,
    repository: true,
    mcp: true,
  },
);

/** Claude Provider 支援的模型清單，供前端選擇器動態渲染 */
export const CLAUDE_AVAILABLE_MODELS = Object.freeze([
  Object.freeze({ label: "Sonnet", value: "sonnet" }),
  Object.freeze({ label: "Opus", value: "opus" }),
  Object.freeze({ label: "Haiku", value: "haiku" }),
] as const);

/**
 * Claude 合法 model value 的 Set，從 CLAUDE_AVAILABLE_MODELS 衍生。
 * 供 podStore 以 O(1) Set.has 驗證，避免每次呼叫都 .map().includes()。
 */
export const CLAUDE_AVAILABLE_MODEL_VALUES: ReadonlySet<string> = new Set(
  CLAUDE_AVAILABLE_MODELS.map((m) => m.value),
);

/** Codex Provider 支援的模型清單，供前端選擇器動態渲染 */
export const CODEX_AVAILABLE_MODELS = Object.freeze([
  Object.freeze({ label: "GPT-5.4", value: "gpt-5.4" }),
  Object.freeze({ label: "GPT-5.5", value: "gpt-5.5" }),
  Object.freeze({ label: "GPT-5.4-mini", value: "gpt-5.4-mini" }),
] as const);

/**
 * Codex 合法 model value 的 Set，從 CODEX_AVAILABLE_MODELS 衍生。
 * 供 podStore 以 O(1) Set.has 驗證，避免每次呼叫都 .map().includes()。
 */
export const CODEX_AVAILABLE_MODEL_VALUES: ReadonlySet<string> = new Set(
  CODEX_AVAILABLE_MODELS.map((m) => m.value),
);

/**
 * Opencode Provider 能力矩陣。
 * 支援 chat、repository、mcp；不支援 plugin（opencode 不走 Claude plugin 機制）。
 */
export const OPENCODE_CAPABILITIES: Readonly<ProviderCapabilities> =
  Object.freeze({
    chat: true,
    plugin: false,
    repository: true,
    mcp: true,
  });

/** 各 provider 共用的 thinking level 型別 alias，供 pod 設定與型別引用 */
export type ThinkingLevel = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Claude 各模型支援的 thinking levels 與預設值。
 * haiku 不支援，levels 為空陣列、default 為 null。
 */
export const CLAUDE_MODEL_THINKING_LEVELS: Readonly<
  Record<string, { levels: readonly string[]; default: string | null }>
> = Object.freeze({
  opus: Object.freeze({
    levels: Object.freeze(["low", "medium", "high", "xhigh", "max"] as const),
    default: "high",
  }),
  sonnet: Object.freeze({
    levels: Object.freeze(["low", "medium", "high", "max"] as const),
    default: "high",
  }),
  haiku: Object.freeze({
    levels: Object.freeze([] as const),
    default: null,
  }),
});

/** Codex 各模型支援的 thinking levels 與預設值，三個 model 行為一致 */
export const CODEX_MODEL_THINKING_LEVELS: Readonly<
  Record<string, { levels: readonly string[]; default: string | null }>
> = Object.freeze({
  "gpt-5.4": Object.freeze({
    levels: Object.freeze(["low", "medium", "high", "xhigh"] as const),
    default: "medium",
  }),
  "gpt-5.5": Object.freeze({
    levels: Object.freeze(["low", "medium", "high", "xhigh"] as const),
    default: "medium",
  }),
  "gpt-5.4-mini": Object.freeze({
    levels: Object.freeze(["low", "medium", "high", "xhigh"] as const),
    default: "medium",
  }),
});
