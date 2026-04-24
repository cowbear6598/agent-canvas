import type { ProviderCapabilities } from "./types.js";

/** Claude Provider 支援所有功能 */
export const CLAUDE_CAPABILITIES: Readonly<ProviderCapabilities> =
  Object.freeze({
    chat: true,
    outputStyle: true,
    skill: true,
    subAgent: true,
    repository: true,
    command: true,
    mcp: true,
    integration: true,
    runMode: true,
  });

/** Codex Provider 僅支援基本聊天，其餘功能皆不支援 */
export const CODEX_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze(
  {
    chat: true,
    outputStyle: false,
    skill: false,
    subAgent: false,
    repository: false,
    command: false,
    mcp: false,
    integration: false,
    runMode: false,
  },
);

/** Claude Provider 支援的模型清單，供前端選擇器動態渲染 */
export const CLAUDE_AVAILABLE_MODELS = Object.freeze([
  Object.freeze({ label: "Opus", value: "opus" }),
  Object.freeze({ label: "Sonnet", value: "sonnet" }),
  Object.freeze({ label: "Haiku", value: "haiku" }),
] as const);

/** Codex Provider 支援的模型清單，供前端選擇器動態渲染 */
export const CODEX_AVAILABLE_MODELS = Object.freeze([
  Object.freeze({ label: "GPT-5.4", value: "gpt-5.4" }),
  Object.freeze({ label: "GPT-5.5", value: "gpt-5.5" }),
  Object.freeze({ label: "GPT-5.4-mini", value: "gpt-5.4-mini" }),
] as const);
