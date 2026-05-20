import type { ContentBlock, TextContentBlock } from "../../types/message.js";
import { buildMcpBootstrapPrompt } from "./mcpBootstrapPrompt.js";

export function buildPromptText(message: string | ContentBlock[]): string {
  if (typeof message === "string") return message;

  return message
    .filter((block): block is TextContentBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * 組合 opencode 的 prompt 文字。
 * Goal Runtime 引導語與 Plugin Skill Catalog 都只在 fresh session 第一輪注入；
 * resume 時（gate retry 第 2 輪以後）兩段都不注入，避免覆蓋 nudge 指示。
 */
export function buildOpencodePromptText(
  message: string | ContentBlock[],
  goalRuntimeAvailable: boolean,
  pluginCatalogText: string,
  resumeSessionId?: string | null,
): string {
  const promptText = buildPromptText(message);
  if (resumeSessionId) {
    return promptText;
  }
  return buildMcpBootstrapPrompt(promptText, {
    goalRuntimeAvailable,
    pluginCatalogText,
  });
}
