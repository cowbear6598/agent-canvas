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

/** sub-message ID 分隔符，統一定義以避免散落的 magic string */
const SUB_MESSAGE_ID_SEPARATOR = "-";

export function buildSubMessageId(
  parentMessageId: string,
  toolUseId: string | undefined,
): string {
  return `${parentMessageId}${SUB_MESSAGE_ID_SEPARATOR}${toolUseId ?? "none"}`;
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
 * #42 反向索引：以 toolUseId 為 key，快速定位 {subIndex, toolIndex}。
 * 在 applyToolResultToMessage 中一次建立後作 O(1) 查找，取代雙層 findIndex。
 */
function buildToolReverseIndex(
  subMessages: Message["subMessages"],
): Map<string, { subIndex: number; toolIndex: number }> {
  const index = new Map<string, { subIndex: number; toolIndex: number }>();
  if (!subMessages) return index;
  for (let si = 0; si < subMessages.length; si++) {
    const toolUse = subMessages[si]?.toolUse;
    if (!toolUse) continue;
    for (let ti = 0; ti < toolUse.length; ti++) {
      const id = toolUse[ti]?.toolUseId;
      if (id) index.set(id, { subIndex: si, toolIndex: ti });
    }
  }
  return index;
}

/**
 * 不可變地將 tool result 套用到 message 中對應的 toolUse entry。
 * 回傳新的 Message 物件；若找不到對應 toolUseId 或無 subMessages，回傳原始 message。
 *
 * 內部建立反向索引 Map<toolUseId, {subIndex, toolIndex}>，讓更新路徑為 O(1)。
 */
export function applyToolResultToMessage(
  message: Message,
  payload: {
    toolUseId: string;
    output: string;
  },
): Message {
  if (!message.subMessages) return message;

  // 一次性建立反向索引，O(n) 建立後 O(1) 查找
  const reverseIndex = buildToolReverseIndex(message.subMessages);
  const pos = reverseIndex.get(payload.toolUseId);
  if (!pos) return message;

  const { subIndex, toolIndex } = pos;
  const subMessage = message.subMessages[subIndex]!;

  const updatedToolUse = subMessage.toolUse!.map((t, idx) =>
    idx === toolIndex
      ? { ...t, output: payload.output, status: "completed" as const }
      : t,
  );

  const updatedSubMessages = message.subMessages.map((sub, idx) =>
    idx === subIndex ? { ...sub, toolUse: updatedToolUse } : sub,
  );

  return { ...message, subMessages: updatedSubMessages };
}

/**
 * 將訊息插入或更新 messages 陣列。
 *
 * @param knownIndex 已知的陣列 index 提示（串流期間由呼叫端維護 Map<messageId, index> 快取）；
 *   若提供且 messages[knownIndex].id === messageId 則跳過 findIndex，達成 O(1) 定位。
 */
export function upsertMessage(
  messages: Message[],
  messageId: string,
  content: string,
  isPartial: boolean,
  role: MessageRole,
  delta?: string,
  metadata?: SystemMessageMetadata,
  knownIndex?: number,
): void {
  // 若呼叫端提供了快取 index 且仍有效，直接用來定位；否則回退 findIndex
  const existingIndex =
    knownIndex !== undefined && messages[knownIndex]?.id === messageId
      ? knownIndex
      : messages.findIndex((m) => m.id === messageId);
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
