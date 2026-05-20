import type { ContentBlock, TextContentBlock } from "../../types/message.js";
import { buildGoalRuntimeBootstrapPrompt } from "./goalBootstrapPrompt.js";

export function buildPromptText(message: string | ContentBlock[]): string {
  if (typeof message === "string") return message;

  return message
    .filter((block): block is TextContentBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * 組合 opencode 的 prompt 文字。
 * resume 時（gate retry 第 2 輪以後）不注入 Goal Runtime bootstrap，避免覆蓋 nudge 指示。
 */
export function buildOpencodePromptText(
  message: string | ContentBlock[],
  goalRuntimeAvailable?: boolean,
  resumeSessionId?: string | null,
): string {
  const promptText = buildPromptText(message);
  if (!goalRuntimeAvailable || resumeSessionId) {
    return promptText;
  }
  return buildGoalRuntimeBootstrapPrompt(promptText);
}
