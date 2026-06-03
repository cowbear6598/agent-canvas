import type {
  RunChatTimelineItem,
  RunGoalRoundDivider,
  RunMessagesPageInfo,
} from "@/types/run";
import type {
  Message,
  MessageRole,
  SystemMessageMetadata,
  ToolUseInfo,
} from "@/types/chat";
import {
  mergeToolResultIntoMessage,
  mergeToolUseIntoMessage,
  upsertMessage,
} from "@/stores/chat/messageHelpers";
import {
  finalizeSubMessages,
  finalizeToolUse,
  updateMainMessageState,
} from "@/stores/chat/subMessageHelpers";
import { createAssistantMessageWithTool } from "@/stores/run/runStoreHelpers";

export interface RunTranscriptStateShape {
  runChatMessages: Map<string, Map<string, RunChatTimelineItem[]>>;
  isLoadingPodMessages: boolean;
  isLoadingOlderPodMessages: boolean;
  activeRunChatPageInfo: RunMessagesPageInfo;
  accumulatedLengthByMessageId: Map<string, number>;
  messageIndexCache: Map<string, number>;
}

export function createEmptyRunChatPageInfo(): RunMessagesPageInfo {
  return {
    hasMore: false,
    nextCursor: null,
  };
}

export function isRunChatMessage(
  item: RunChatTimelineItem,
): item is Message {
  return !("type" in item && item.type === "goal-round-divider");
}

export function findMessageIndex(
  timelineItems: RunChatTimelineItem[],
  messageId: string,
): number {
  return timelineItems.findIndex(
    (item) => isRunChatMessage(item) && item.id === messageId,
  );
}

export function getRunChatMessagesFromTimeline(
  timelineItems: RunChatTimelineItem[],
): Message[] {
  return timelineItems.filter(isRunChatMessage);
}

export function mergeLoadedTimelineItems(
  loadedItems: RunChatTimelineItem[],
  liveItems: RunChatTimelineItem[],
): RunChatTimelineItem[] {
  if (liveItems.length === 0) {
    return loadedItems;
  }

  const mergedById = new Map<string, RunChatTimelineItem>();
  const orderedIds: string[] = [];

  for (const item of loadedItems) {
    orderedIds.push(item.id);
    mergedById.set(item.id, item);
  }

  for (const item of liveItems) {
    const existing = mergedById.get(item.id);
    if (existing && isRunChatMessage(existing) && isRunChatMessage(item)) {
      mergedById.set(item.id, {
        ...existing,
        ...item,
        metadata: item.metadata ?? existing.metadata,
        toolUse: item.toolUse ?? existing.toolUse,
        subMessages: item.subMessages ?? existing.subMessages,
      });
      continue;
    }

    if (existing) {
      mergedById.set(item.id, item);
      continue;
    }

    orderedIds.push(item.id);
    mergedById.set(item.id, item);
  }

  return orderedIds
    .map((itemId) => mergedById.get(itemId))
    .filter((item): item is RunChatTimelineItem => Boolean(item));
}

export function clearMessageCaches(
  state: RunTranscriptStateShape,
  timelineItems: RunChatTimelineItem[],
): void {
  for (const message of getRunChatMessagesFromTimeline(timelineItems)) {
    state.accumulatedLengthByMessageId.delete(message.id);
    state.messageIndexCache.delete(message.id);
  }
}

export function cleanupRunTranscript(
  state: RunTranscriptStateShape,
  runId: string,
): void {
  const podMap = state.runChatMessages.get(runId);
  if (!podMap) return;

  for (const timelineItems of podMap.values()) {
    clearMessageCaches(state, timelineItems);
  }

  state.runChatMessages.delete(runId);
}

export function resetRunChatState(state: RunTranscriptStateShape): void {
  state.runChatMessages = new Map();
  state.isLoadingPodMessages = false;
  state.accumulatedLengthByMessageId = new Map();
  state.messageIndexCache = new Map();
  state.activeRunChatPageInfo = createEmptyRunChatPageInfo();
  state.isLoadingOlderPodMessages = false;
}

export function rebuildActiveMessageCaches(
  state: RunTranscriptStateShape,
  timelineItems: RunChatTimelineItem[],
): void {
  state.messageIndexCache = new Map(
    timelineItems.flatMap((item, index) =>
      isRunChatMessage(item) ? [[item.id, index] as const] : [],
    ),
  );
  state.accumulatedLengthByMessageId = new Map(
    getRunChatMessagesFromTimeline(timelineItems)
      .filter((message) => message.isPartial)
      .map((message) => [message.id, message.content.length]),
  );
}

export function setActiveRunChatTimelineItems(
  state: RunTranscriptStateShape,
  runId: string,
  podId: string,
  timelineItems: RunChatTimelineItem[],
): void {
  let podMap = state.runChatMessages.get(runId);
  if (!podMap) {
    podMap = new Map();
    state.runChatMessages.set(runId, podMap);
  }

  podMap.set(podId, timelineItems);
  rebuildActiveMessageCaches(state, timelineItems);
}

export function setActiveRunChatMessages(
  state: RunTranscriptStateShape,
  runId: string,
  podId: string,
  messages: Message[],
): void {
  setActiveRunChatTimelineItems(state, runId, podId, messages);
}

export function appendRunChatMessage(
  state: RunTranscriptStateShape,
  payload: {
    runId: string;
    podId: string;
    messageId: string;
    content: string;
    isPartial: boolean;
    role: MessageRole;
    metadata?: SystemMessageMetadata;
    receivedDelta?: string;
  },
): void {
  let podMap = state.runChatMessages.get(payload.runId);
  if (!podMap) {
    podMap = new Map();
    state.runChatMessages.set(payload.runId, podMap);
  }
  const timelineItems = podMap.get(payload.podId) ?? [];

  const cachedIndex = state.messageIndexCache.get(payload.messageId);
  const cachedItem =
    cachedIndex !== undefined ? timelineItems[cachedIndex] : undefined;
  const knownIndex =
    cachedItem !== undefined &&
    isRunChatMessage(cachedItem) &&
    cachedItem.id === payload.messageId
      ? cachedIndex
      : undefined;
  const existingIndex =
    knownIndex ?? findMessageIndex(timelineItems, payload.messageId);
  const existingMessage =
    existingIndex !== -1 ? timelineItems[existingIndex] : undefined;
  const existingContent =
    existingMessage !== undefined && isRunChatMessage(existingMessage)
      ? existingMessage.content
      : "";
  const lastLength =
    state.accumulatedLengthByMessageId.get(payload.messageId) ?? 0;
  const delta =
    payload.receivedDelta ??
    (payload.content.length < lastLength
      ? payload.content
      : payload.content.slice(lastLength));
  const nextContent =
    payload.receivedDelta !== undefined
      ? `${existingContent}${payload.receivedDelta}`
      : payload.content;

  if (payload.isPartial) {
    state.accumulatedLengthByMessageId.set(
      payload.messageId,
      nextContent.length,
    );
  } else {
    state.accumulatedLengthByMessageId.delete(payload.messageId);
  }

  upsertMessage(
    timelineItems as Message[],
    payload.messageId,
    nextContent,
    payload.isPartial,
    payload.role,
    delta,
    payload.metadata,
    knownIndex,
  );

  if (knownIndex === undefined) {
    const newIndex = findMessageIndex(timelineItems, payload.messageId);
    if (newIndex !== -1) {
      state.messageIndexCache.set(payload.messageId, newIndex);
    }
  }

  podMap.set(payload.podId, timelineItems);
}

export function appendRunChatDivider(
  state: RunTranscriptStateShape,
  divider: RunGoalRoundDivider,
): void {
  let podMap = state.runChatMessages.get(divider.runId);
  if (!podMap) {
    podMap = new Map();
    state.runChatMessages.set(divider.runId, podMap);
  }

  const timelineItems = podMap.get(divider.podId) ?? [];
  const existingIndex = timelineItems.findIndex(
    (item) =>
      "type" in item &&
      item.type === "goal-round-divider" &&
      item.id === divider.id,
  );

  if (existingIndex !== -1) {
    const updatedItems = [...timelineItems];
    updatedItems[existingIndex] = divider;
    podMap.set(divider.podId, updatedItems);
    return;
  }

  podMap.set(divider.podId, [...timelineItems, divider]);
}

export function handleRunChatToolUse(
  state: RunTranscriptStateShape,
  payload: {
    runId: string;
    podId: string;
    messageId: string;
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
): void {
  let podMap = state.runChatMessages.get(payload.runId);
  if (!podMap) {
    podMap = new Map();
    state.runChatMessages.set(payload.runId, podMap);
  }
  const timelineItems = podMap.get(payload.podId) ?? [];

  const toolUseInfo: ToolUseInfo = {
    toolUseId: payload.toolUseId,
    toolName: payload.toolName,
    input: payload.input,
    status: "running",
  };

  const messageIndex = findMessageIndex(timelineItems, payload.messageId);

  if (messageIndex === -1) {
    const nextMessages = [
      ...timelineItems,
      createAssistantMessageWithTool(payload.messageId, toolUseInfo),
    ];
    state.messageIndexCache.set(payload.messageId, nextMessages.length - 1);
    podMap.set(payload.podId, nextMessages);
    return;
  }

  const message = timelineItems[messageIndex];
  if (!message || !isRunChatMessage(message)) return;

  const toolAlreadyExists = message.toolUse?.some(
    (tool) => tool.toolUseId === payload.toolUseId,
  );
  if (toolAlreadyExists) return;

  const updatedMessages = [...timelineItems];
  updatedMessages[messageIndex] = mergeToolUseIntoMessage(
    message,
    toolUseInfo,
  );
  podMap.set(payload.podId, updatedMessages);
}

export function handleRunChatToolResult(
  state: RunTranscriptStateShape,
  payload: {
    runId: string;
    podId: string;
    messageId: string;
    toolUseId: string;
    toolName: string;
    output: string;
  },
): void {
  let podMap = state.runChatMessages.get(payload.runId);
  if (!podMap) {
    podMap = new Map();
    state.runChatMessages.set(payload.runId, podMap);
  }

  const timelineItems = podMap.get(payload.podId) ?? [];
  const messageIndex = findMessageIndex(timelineItems, payload.messageId);
  const toolUseInfo: ToolUseInfo = {
    toolUseId: payload.toolUseId,
    toolName: payload.toolName,
    input: {},
    status: "running",
  };

  if (messageIndex === -1) {
    const createdMessage = mergeToolResultIntoMessage(
      createAssistantMessageWithTool(payload.messageId, toolUseInfo),
      payload.toolUseId,
      payload.output,
      payload.toolName,
    );
    const nextMessages = [...timelineItems, createdMessage];
    state.messageIndexCache.set(payload.messageId, nextMessages.length - 1);
    podMap.set(payload.podId, nextMessages);
    return;
  }

  const updatedMessages = [...timelineItems];
  const message = updatedMessages[messageIndex];
  if (!message || !isRunChatMessage(message)) return;

  const hasToolUse = message.toolUse?.some(
    (tool) => tool.toolUseId === payload.toolUseId,
  );
  const messageWithToolUse = hasToolUse
    ? message
    : mergeToolUseIntoMessage(message, toolUseInfo);

  updatedMessages[messageIndex] = mergeToolResultIntoMessage(
    messageWithToolUse,
    payload.toolUseId,
    payload.output,
    payload.toolName,
  );
  podMap.set(payload.podId, updatedMessages);
}

export function handleRunChatComplete(
  state: RunTranscriptStateShape,
  payload: {
    runId: string;
    podId: string;
    messageId: string;
    fullContent: string;
  },
): void {
  let podMap = state.runChatMessages.get(payload.runId);
  if (!podMap) {
    podMap = new Map();
    state.runChatMessages.set(payload.runId, podMap);
  }

  const currentTimelineItems = podMap.get(payload.podId) ?? [];
  let messageIndex = findMessageIndex(currentTimelineItems, payload.messageId);

  if (messageIndex === -1) {
    appendRunChatMessage(state, {
      ...payload,
      content: payload.fullContent,
      isPartial: false,
      role: "assistant",
    });
  }

  const timelineItems = podMap.get(payload.podId);
  if (!timelineItems) return;

  messageIndex = findMessageIndex(timelineItems, payload.messageId);
  if (messageIndex === -1) return;

  state.accumulatedLengthByMessageId.delete(payload.messageId);
  state.messageIndexCache.delete(payload.messageId);

  const message = timelineItems[messageIndex];
  if (!message || !isRunChatMessage(message)) return;
  const updatedToolUse = finalizeToolUse(message.toolUse);
  const finalizedSubMessages = finalizeSubMessages(message.subMessages);

  const updatedMessages = [...timelineItems];
  updatedMessages[messageIndex] = updateMainMessageState(
    message,
    payload.fullContent,
    updatedToolUse,
    finalizedSubMessages,
  );
  podMap.set(payload.podId, updatedMessages);
}
