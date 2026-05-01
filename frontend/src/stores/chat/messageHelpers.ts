import type {
  Message,
  MessageRole,
  SystemMessageMetadata,
  ToolUseInfo,
} from "@/types/chat";
import {
  appendToolToLastSubMessage,
  flushAndCreateNewSubMessage,
  markToolWithOutput,
  updateAssistantSubMessages,
  updateSubMessagesToolUseResult,
} from "./subMessageHelpers";
import { createAssistantMessageShape } from "./chatMessageActions";

export function buildRunPodCacheKey(runId: string, podId: string): string {
  return `${runId}:${podId}`;
}

export function buildSubMessageId(
  parentMessageId: string,
  toolUseId: string | undefined,
): string {
  return `${parentMessageId}-${toolUseId ?? "no-tool"}`;
}

/**
 * 不可變地將 toolUseInfo 加入 message 的 toolUse 和 subMessages。
 * 呼叫前需自行處理 dedup（檢查 toolUseId 是否已存在）。
 */
export function mergeToolUseIntoMessage(
  message: Message,
  toolUseInfo: ToolUseInfo,
): Message {
  const existingToolUse = message.toolUse ?? [];

  const updatedMessage: Message = {
    ...message,
    toolUse: [...existingToolUse, toolUseInfo],
  };

  if (message.subMessages !== undefined && message.subMessages.length > 0) {
    const lastSub = message.subMessages[message.subMessages.length - 1];
    if (lastSub && lastSub.content.trim() === "") {
      updatedMessage.subMessages = appendToolToLastSubMessage(
        message.subMessages,
        toolUseInfo,
      );
    } else {
      updatedMessage.subMessages = flushAndCreateNewSubMessage(
        message.subMessages,
        message.id,
        toolUseInfo,
      );
    }
  }

  return updatedMessage;
}

/**
 * 不可變地將 tool result（output）合併到 message 的 toolUse 和 subMessages。
 * 若 message 無 toolUse 則回傳原始 message。
 */
export function mergeToolResultIntoMessage(
  message: Message,
  toolUseId: string,
  output: string,
): Message {
  if (!message.toolUse) return message;

  const updatedToolUse = markToolWithOutput(message.toolUse, toolUseId, output);

  const updatedMessage: Message = {
    ...message,
    toolUse: updatedToolUse,
  };

  if (message.subMessages) {
    updatedMessage.subMessages = updateSubMessagesToolUseResult(
      message.subMessages,
      toolUseId,
      output,
    );
  }

  return updatedMessage;
}

/**
 * 不可變地將 tool result 套用到 message 中對應的 toolUse entry。
 * 回傳新的 Message 物件；若找不到對應 toolUseId 或無 subMessages，回傳原始 message。
 */
export function applyToolResultToMessage(
  message: Message,
  payload: {
    toolUseId: string;
    output: string;
  },
): Message {
  if (!message.subMessages) return message;

  for (let i = 0; i < message.subMessages.length; i++) {
    const subMessage = message.subMessages[i]!;
    if (!subMessage.toolUse) continue;

    const toolIndex = subMessage.toolUse.findIndex(
      (t) => t.toolUseId === payload.toolUseId,
    );
    if (toolIndex === -1) continue;

    const updatedToolUse = subMessage.toolUse.map((t, idx) =>
      idx === toolIndex
        ? { ...t, output: payload.output, status: "completed" as const }
        : t,
    );

    const updatedSubMessages = message.subMessages.map((sub, idx) =>
      idx === i ? { ...sub, toolUse: updatedToolUse } : sub,
    );

    return { ...message, subMessages: updatedSubMessages };
  }

  return message;
}

export function upsertMessage(
  messages: Message[],
  messageId: string,
  content: string,
  isPartial: boolean,
  role: MessageRole,
  delta?: string,
  metadata?: SystemMessageMetadata,
): void {
  const existingIndex = messages.findIndex((m) => m.id === messageId);
  if (existingIndex !== -1) {
    const existing = messages[existingIndex];
    if (existing) {
      const shouldUpdateSub =
        existing.role === "assistant" &&
        existing.subMessages &&
        delta !== undefined;
      const subMessageUpdates = shouldUpdateSub
        ? updateAssistantSubMessages(existing, delta, isPartial)
        : {};
      messages[existingIndex] = {
        ...existing,
        // 有 subMessages 但 delta 不可用時，不更新 content，避免 content 與 subMessages 不同步
        ...(existing.subMessages && !shouldUpdateSub ? {} : { content }),
        ...(metadata !== undefined ? { metadata } : {}),
        isPartial,
        ...subMessageUpdates,
      };
    }
    return;
  }

  const baseMessage: Message = {
    id: messageId,
    role,
    content,
    metadata,
    isPartial,
  };

  const shape =
    role === "assistant"
      ? createAssistantMessageShape(messageId, content, isPartial, delta)
      : {};

  messages.push({ ...baseMessage, ...shape });
}
