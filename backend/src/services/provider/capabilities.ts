import type { ProviderCapabilities } from "./types.js";

/** Claude Provider 支援所有功能 */
export const CLAUDE_CAPABILITIES: Readonly<ProviderCapabilities> =
  Object.freeze({
    chat: true,
    plugin: true,
    repository: true,
    command: true,
    mcp: true,
  });

/** Codex Provider 支援所有功能，與 Claude 行為完全一致（chat、command、repository、plugin、mcp 皆為 true） */
export const CODEX_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze(
  {
    chat: true,
    plugin: true,
    repository: true,
    command: true,
    mcp: true,
  },
);

/** Claude Provider 支援的模型清單，供前端選擇器動態渲染 */
export const CLAUDE_AVAILABLE_MODELS = Object.freeze([
  Object.freeze({ label: "Opus", value: "opus" }),
  Object.freeze({ label: "Sonnet", value: "sonnet" }),
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
