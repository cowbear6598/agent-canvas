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

/** Gemini Provider 支援 chat、command、repository、plugin；尚未支援 mcp */
export const GEMINI_CAPABILITIES: Readonly<ProviderCapabilities> =
  Object.freeze({
    chat: true,
    plugin: true,
    repository: true,
    command: true,
    // 目前 Gemini CLI 透過 extensions（plugin）管理 MCP，本 capability 維持 false，待後續評估直接 mcp 支援
    mcp: false,
  });

/**
 * Gemini Provider 支援的模型清單，供前端選擇器動態渲染。
 *
 * 注意：gemini-3-pro-preview、gemini-3-flash-preview、gemini-3.1-flash-lite-preview
 * 均為 preview 版本，可能隨時下架或變更行為。
 * review 點：型別目前為 { label, value } object array（string[]），
 * 若未來需標記 available/preview 狀態，需同步更新前端 providerCapabilityStore
 * 與 PodModelSelector，屬破壞性變更，目前保守僅加註釋。
 */
export const GEMINI_AVAILABLE_MODELS = Object.freeze([
  Object.freeze({ label: "2.5 Pro", value: "gemini-2.5-pro" }),
  Object.freeze({ label: "2.5 Flash", value: "gemini-2.5-flash" }),
  Object.freeze({ label: "2.5 Flash L", value: "gemini-2.5-flash-lite" }),
  // 以下三個為 preview 版本，API 可能隨時變更
  Object.freeze({ label: "3 Pro P", value: "gemini-3-pro-preview" }),
  Object.freeze({ label: "3 Flash P", value: "gemini-3-flash-preview" }),
  Object.freeze({
    label: "3.1 Flash L/P",
    value: "gemini-3.1-flash-lite-preview",
  }),
] as const);

/**
 * Gemini 合法 model value 的 Set，從 GEMINI_AVAILABLE_MODELS 衍生。
 * 供 podStore 以 O(1) Set.has 驗證，避免每次呼叫都 .map().includes()。
 */
export const GEMINI_AVAILABLE_MODEL_VALUES: ReadonlySet<string> = new Set(
  GEMINI_AVAILABLE_MODELS.map((m) => m.value),
);
