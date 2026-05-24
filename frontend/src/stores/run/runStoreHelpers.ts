import type { Message, SubMessage, ToolUseInfo } from "@/types/chat";
import { isValidToolUseStatus } from "@/types/chat";
import type { RunChatTimelineItem } from "@/types/run";
import type {
  PersistedMessage,
  RunChatTimelineItemPayload,
} from "@/types/websocket/responses";
import { buildSubMessageId } from "@/stores/chat/messageHelpers";
import {
  collectToolUseFromSubMessages,
  finalizeSubMessages,
} from "@/stores/chat/subMessageHelpers";

/** 將 PersistedMessage 的 subMessages 轉換為前端 Message 格式 */
export function convertSubMessages(
  pm: PersistedMessage,
): Pick<Message, "subMessages" | "toolUse"> {
  if (!pm.subMessages || pm.subMessages.length === 0) {
    return {
      subMessages: [
        {
          id: `${pm.id}-sub-0`,
          content: pm.content,
          isPartial: false,
        },
      ],
    };
  }

  const rawSubMessages: SubMessage[] = pm.subMessages.map((sub, index) => ({
    id:
      sub.id ??
      buildSubMessageId(pm.id, sub.toolUse?.[0]?.toolUseId ?? `sub-${index}`),
    content: sub.content,
    isPartial: false,
    toolUse: sub.toolUse?.map((t) => ({
      toolUseId: t.toolUseId,
      toolName: t.toolName,
      input: t.input,
      output: t.output,
      status: isValidToolUseStatus(t.status) ? t.status : "completed",
    })),
  }));

  // 套用與 live 串流完成時相同的分段整理規則，確保 rehydrate 後的顯示結果一致
  const finalizedSubMessages =
    finalizeSubMessages(rawSubMessages) ?? rawSubMessages;
  const allToolUse = collectToolUseFromSubMessages(pm.subMessages);

  const result: Pick<Message, "subMessages" | "toolUse"> = {
    subMessages: finalizedSubMessages,
  };

  if (allToolUse.length > 0) {
    result.toolUse = allToolUse;
  }

  return result;
}

/** 建立帶有單一工具的 assistant 訊息（tool use 先於 text 到達時使用） */
export function createAssistantMessageWithTool(
  messageId: string,
  toolUseInfo: ToolUseInfo,
): Message {
  return {
    id: messageId,
    role: "assistant",
    content: "",
    isPartial: true,
    toolUse: [toolUseInfo],
    subMessages: [
      {
        id: `${messageId}-sub-0`,
        content: "",
        isPartial: true,
        toolUse: [toolUseInfo],
      },
    ],
  };
}

/** 將後端 PersistedMessage 轉換為前端 Message */
export function toMessage(pm: PersistedMessage): Message {
  const message: Message = {
    id: pm.id,
    role: pm.role,
    content: pm.content,
    metadata: pm.metadata,
    isPartial: false,
  };

  if (pm.role !== "assistant") return message;

  return { ...message, ...convertSubMessages(pm) };
}

export function isRunGoalRoundDivider(
  item: RunChatTimelineItemPayload,
): item is Extract<RunChatTimelineItemPayload, { type: "goal-round-divider" }> {
  return "type" in item && item.type === "goal-round-divider";
}

export function toRunChatTimelineItem(
  item: RunChatTimelineItemPayload,
): RunChatTimelineItem {
  if (isRunGoalRoundDivider(item)) return item;

  return toMessage(item);
}
