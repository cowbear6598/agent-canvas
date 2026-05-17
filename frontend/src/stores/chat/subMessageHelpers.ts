import type { Message, SubMessage, ToolUseInfo } from "@/types/chat";
import { isValidToolUseStatus } from "@/types/chat";
import type { PersistedMessage } from "@/types/websocket/responses";

/** 從 PersistedMessage 的 subMessages 中收集所有 ToolUseInfo */
export function collectToolUseFromSubMessages(
  subMessages: PersistedMessage["subMessages"],
): ToolUseInfo[] {
  if (!subMessages) return [];
  return subMessages.flatMap((sub) =>
    (sub.toolUse ?? []).map((tool) => ({
      toolUseId: tool.toolUseId,
      toolName: tool.toolName,
      input: tool.input,
      output: tool.output,
      status: isValidToolUseStatus(tool.status) ? tool.status : "completed",
    })),
  );
}

export function markToolCompleted(tool: ToolUseInfo): ToolUseInfo {
  return { ...tool, status: "completed" };
}

export function appendToolToLastSubMessage(
  subMessages: SubMessage[],
  toolUseInfo: ToolUseInfo,
): SubMessage[] {
  const updated = [...subMessages];
  const lastIndex = updated.length - 1;
  const lastSub = updated[lastIndex];

  if (!lastSub) return updated;

  updated[lastIndex] = {
    ...lastSub,
    toolUse: [...(lastSub.toolUse ?? []), toolUseInfo],
  };
  return updated;
}

export function flushAndCreateNewSubMessage(
  subMessages: SubMessage[],
  messageId: string,
  toolUseInfo: ToolUseInfo,
): SubMessage[] {
  const updated = [...subMessages];
  const lastIndex = updated.length - 1;
  const lastSub = updated[lastIndex];

  if (lastSub) {
    updated[lastIndex] = { ...lastSub, isPartial: false };
  }

  const newSubMessage: SubMessage = {
    id: `${messageId}-sub-${updated.length}`,
    content: "",
    isPartial: true,
    toolUse: [toolUseInfo],
  };

  return [...updated, newSubMessage];
}

function updateLastSubMessage(
  subMessages: SubMessage[],
  delta: string,
  isPartial: boolean,
): SubMessage[] {
  const updatedSubMessages = [...subMessages];
  const lastSubIndex = updatedSubMessages.length - 1;
  if (lastSubIndex < 0) return updatedSubMessages;

  const lastSub = updatedSubMessages[lastSubIndex];
  if (!lastSub) return updatedSubMessages;

  updatedSubMessages[lastSubIndex] = {
    ...lastSub,
    content: lastSub.content + delta,
    isPartial,
  };
  return updatedSubMessages;
}

export function updateAssistantSubMessages(
  existingMessage: Message,
  delta: string,
  isPartial: boolean,
): Pick<Message, "subMessages"> {
  if (!existingMessage.subMessages) {
    return { subMessages: existingMessage.subMessages };
  }
  const subMessages = updateLastSubMessage(
    existingMessage.subMessages,
    delta,
    isPartial,
  );
  return { subMessages };
}

export function markToolWithOutput(
  toolUse: ToolUseInfo[],
  toolUseId: string,
  output: string,
  toolName?: string,
): ToolUseInfo[] {
  return toolUse.map((tool) =>
    tool.toolUseId === toolUseId
      ? {
          ...markToolCompleted(tool),
          output,
          ...(toolName ? { toolName } : {}),
        }
      : tool,
  );
}

function updateSingleSubToolUse(
  sub: SubMessage,
  toolUseId: string,
  output: string,
  toolName?: string,
): SubMessage {
  if (!sub.toolUse) return sub;

  const updatedSubToolUse = markToolWithOutput(
    sub.toolUse,
    toolUseId,
    output,
    toolName,
  );

  const allToolsCompleted = updatedSubToolUse.every(
    (tool) => tool.status === "completed" || tool.status === "error",
  );

  const updatedSub: SubMessage = {
    ...sub,
    toolUse: updatedSubToolUse,
  };

  if (allToolsCompleted) {
    updatedSub.isPartial = false;
  }

  return updatedSub;
}

export function updateSubMessagesToolUseResult(
  subMessages: SubMessage[],
  toolUseId: string,
  output: string,
  toolName?: string,
): SubMessage[] {
  return subMessages.map((sub) =>
    updateSingleSubToolUse(sub, toolUseId, output, toolName),
  );
}

export function finalizeToolUse(
  toolUse: ToolUseInfo[] | undefined,
): ToolUseInfo[] | undefined {
  if (!toolUse || toolUse.length === 0) {
    return undefined;
  }

  return toolUse.map((tool) =>
    tool.status === "running" ? markToolCompleted(tool) : tool,
  );
}

function finalizeToolUseInSub(sub: SubMessage): SubMessage {
  const finalizedToolUse = finalizeToolUse(sub.toolUse);
  return {
    ...sub,
    isPartial: false,
    toolUse: finalizedToolUse,
  };
}

function mergeEmptySubMessages(subMessages: SubMessage[]): SubMessage[] {
  // 將 content 為空的 SubMessage 的 toolUse 合併到前一個，避免渲染空氣泡
  // 若該 SubMessage 已是第一個（沒有前一個可合併），則保留不動
  const result: SubMessage[] = [];

  for (const sub of subMessages) {
    const isEmpty = sub.content.trim() === "";
    const hasTool = sub.toolUse && sub.toolUse.length > 0;

    if (isEmpty && hasTool && result.length > 0) {
      const prev = result[result.length - 1]!;
      const existingIds = new Set((prev.toolUse ?? []).map((t) => t.toolUseId));
      const newTools = sub.toolUse!.filter(
        (t) => !existingIds.has(t.toolUseId),
      );
      result[result.length - 1] = {
        ...prev,
        toolUse: [...(prev.toolUse ?? []), ...newTools],
      };
    } else {
      result.push(sub);
    }
  }

  return result;
}

export function finalizeSubMessages(
  subMessages: SubMessage[] | undefined,
): SubMessage[] | undefined {
  if (!subMessages || subMessages.length === 0) {
    return undefined;
  }

  const merged = mergeEmptySubMessages(subMessages);
  return merged.map((sub) => finalizeToolUseInSub(sub));
}

export function updateMainMessageState(
  message: Message,
  fullContent: string,
  updatedToolUse: ToolUseInfo[] | undefined,
  finalizedSubMessages: SubMessage[] | undefined,
): Message {
  const updated: Message = {
    ...message,
    content: fullContent,
    isPartial: false,
  };

  if (updatedToolUse !== undefined) {
    updated.toolUse = updatedToolUse;
  }

  if (finalizedSubMessages !== undefined) {
    updated.subMessages = finalizedSubMessages;
  }

  return updated;
}
