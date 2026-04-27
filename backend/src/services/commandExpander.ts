import type { ContentBlock } from "../types/message.ts";
import type { Pod } from "../types/pod.js";
import { commandService } from "./commandService.js";
import { logger } from "../utils/logger.js";

/**
 * 當 Command 不存在時的備援提示訊息（供整合錯誤處理使用）
 */
export const COMMAND_EXPAND_FALLBACK_MESSAGE =
  "Command 不存在，請在 Pod 上重新選擇或解除綁定";

/**
 * 當使用者綁定的 Command 檔案已被刪除時，產生對應的錯誤提示文字
 */
export function buildCommandNotFoundMessage(commandId: string): string {
  return `Command 「${commandId}」已不存在，請至 Pod 設定重新選擇或解除綁定。`;
}

/**
 * 將 Command 的 markdown 內容組裝成 <command> 標籤，並 prepend 到訊息前。
 *
 * - string 訊息：回傳「標籤 + 原字串」的單一字串
 * - ContentBlock[] 訊息：把標籤字串 prepend 到第一個 type='text' block 的 text 欄位前；
 *   若全無 text block，則在陣列最前插入一個新的 text block
 */
export function expandCommandMessage(params: {
  message: string | ContentBlock[];
  markdown: string;
}): string | ContentBlock[] {
  const { message, markdown } = params;
  const tag = `<command>\n${markdown}\n</command>\n`;

  if (typeof message === "string") {
    return tag + message;
  }

  const firstTextIndex = message.findIndex((block) => block.type === "text");

  if (firstTextIndex === -1) {
    // 全無 text block，插入新的 text block 到最前面
    return [{ type: "text", text: tag }, ...message];
  }

  // 把標籤字串 prepend 到第一個 text block 的 text 欄位前
  return message.map((block, index) => {
    if (index === firstTextIndex && block.type === "text") {
      return { ...block, text: tag + block.text };
    }
    return block;
  });
}

export type ExpandCommandResult =
  | { ok: true; message: string | ContentBlock[] }
  | { ok: false; commandId: string };

/**
 * 嘗試展開 Pod 綁定的 Command 內容（共用版本）。
 * - pod 無 commandId 時：直接回傳原始訊息（ok: true）
 * - command 讀取成功時：回傳展開版訊息（ok: true）
 * - command 讀取失敗（檔案已消失）：回傳 ok: false 帶 commandId
 *
 * @param context - 呼叫來源，供 log 識別（例如 "handleChatSend" / "workflow" / "schedule"）
 */
export async function tryExpandCommandMessage(
  pod: Pod,
  message: string | ContentBlock[],
  context = "unknown",
): Promise<ExpandCommandResult> {
  if (!pod.commandId) {
    return { ok: true, message };
  }

  const commandId = pod.commandId;
  const markdown = await commandService.read(commandId);
  if (markdown !== null) {
    return {
      ok: true,
      message: expandCommandMessage({ message, markdown }),
    };
  }

  logger.warn(
    "Chat",
    "Check",
    `[${context}] Command 不存在，commandId=${commandId}, podId=${pod.id}`,
  );
  return { ok: false, commandId };
}
