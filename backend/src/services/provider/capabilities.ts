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
