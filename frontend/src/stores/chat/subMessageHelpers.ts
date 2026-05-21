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
  messageId: string,
): SubMessage[] {
  const lastSubIndex = subMessages.length - 1;
  if (lastSubIndex < 0) return subMessages;

  const lastSub = subMessages[lastSubIndex];
  if (!lastSub) return subMessages;

  // 上一個 sub-message 是工具步驟（有 toolUse 但 content 為空）時，
  // 新進來的文字 delta 不應該擠進工具 bubble，而是另起一個文字 bubble。
  // 對應後端 opencode v2 / partID 補拉路徑：tool → text 切換時的顯示分段。
  const isToolOnlySegment =
    (lastSub.toolUse?.length ?? 0) > 0 && lastSub.content === "";
  if (isToolOnlySegment) {
    return [
      ...subMessages.slice(0, lastSubIndex),
      { ...lastSub, isPartial: false },
      {
        id: `${messageId}-sub-${subMessages.length}`,
        content: delta,
        isPartial,
      },
    ];
  }

  const updatedSubMessages = [...subMessages];
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
    existingMessage.id,
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

export function finalizeSubMessages(
  subMessages: SubMessage[] | undefined,
): SubMessage[] | undefined {
  if (!subMessages || subMessages.length === 0) {
    return undefined;
  }

  return subMessages.map((sub) => finalizeToolUseInSub(sub));
}

function applyFinalTextToSingleTextSubMessage(
  subMessages: SubMessage[] | undefined,
  fullContent: string,
): SubMessage[] | undefined {
  if (!subMessages || subMessages.length !== 1) {
    return subMessages;
  }

  const [onlySubMessage] = subMessages;
  if (!onlySubMessage || (onlySubMessage.toolUse?.length ?? 0) > 0) {
    return subMessages;
  }

  return [{ ...onlySubMessage, content: fullContent }];
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
    updated.subMessages = applyFinalTextToSingleTextSubMessage(
      finalizedSubMessages,
      fullContent,
    );
  }

  return updated;
}
