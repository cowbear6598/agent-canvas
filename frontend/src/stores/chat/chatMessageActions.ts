import { generateRequestId } from "@/services/utils";
import { usePodStore } from "../pod/podStore";
import type { Pod } from "@/types/pod";
import type {
  Message,
  MessageRole,
  SubMessage,
  SystemMessageMetadata,
} from "@/types/chat";
import { isValidToolUseStatus } from "@/types/chat";
import type {
  PersistedMessage,
  PodChatAbortedPayload,
  PodChatCompletePayload,
  PodChatMessagePayload,
  PodChatToolResultPayload,
  PodChatToolUsePayload,
  PodMessagesClearedPayload,
} from "@/types/websocket";
import { CONTENT_PREVIEW_LENGTH } from "@/lib/constants";
import { truncateContent } from "./chatUtils";
import type { ChatStoreInstance } from "./chatStore";
import {
  updateAssistantSubMessages,
  collectToolUseFromSubMessages,
} from "./subMessageHelpers";
import { createToolTrackingActions } from "./toolTrackingActions";
import { createMessageCompletionActions } from "./messageCompletionActions";
import { getMessages, findMessageIndex, setTyping } from "./chatStoreHelpers";

function appendUserOutputToPod(pod: Pod, content: string): void {
  const podStore = usePodStore();
  const truncatedContent = `> ${truncateContent(content, CONTENT_PREVIEW_LENGTH)}`;
  const lastOutput = pod.output[pod.output.length - 1];
  if (lastOutput === truncatedContent) return;

  podStore.updatePod({
    ...pod,
    output: [...pod.output, truncatedContent],
  });
}

export function createAssistantMessageShape(
  messageId: string,
  content: string,
  isPartial: boolean,
  delta?: string,
): Partial<Message> {
  const firstSubMessage: SubMessage = {
    id: `${messageId}-sub-0`,
    content: delta ?? content,
    isPartial,
  };
  return {
    subMessages: [firstSubMessage],
  };
}

export interface ChatMessageActions {
  addUserMessage: (podId: string, content: string) => void;
  addRemoteUserMessage: (
    podId: string,
    messageId: string,
    content: string,
    timestamp: string,
  ) => void;
  handleChatMessage: (payload: PodChatMessagePayload) => void;
  addNewChatMessage: (
    podId: string,
    messageId: string,
    content: string,
    isPartial: boolean,
    role?: MessageRole,
    delta?: string,
    metadata?: SystemMessageMetadata,
  ) => void;
  updateExistingChatMessage: (
    podId: string,
    messages: Message[],
    messageIndex: number,
    content: string,
    isPartial: boolean,
    delta: string,
    metadata?: SystemMessageMetadata,
  ) => void;
  handleChatToolUse: (payload: PodChatToolUsePayload) => void;
  createMessageWithToolUse: (
    podId: string,
    messageId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
  ) => void;
  addToolUseToMessage: (
    podId: string,
    messages: Message[],
    messageIndex: number,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
  ) => void;
  handleChatToolResult: (payload: PodChatToolResultPayload) => void;
  updateToolUseResult: (
    podId: string,
    messages: Message[],
    messageIndex: number,
    toolUseId: string,
    output: string,
  ) => void;
  handleChatComplete: (payload: PodChatCompletePayload) => void;
  handleChatAborted: (payload: PodChatAbortedPayload) => void;
  finalizeStreaming: (podId: string, messageId: string) => void;
  completeMessage: (
    podId: string,
    messages: Message[],
    messageIndex: number,
    fullContent: string,
    messageId: string,
  ) => void;
  updatePodOutput: (podId: string) => void;
  convertPersistedToMessage: (persistedMessage: PersistedMessage) => Message;
  setPodMessages: (podId: string, messages: Message[]) => void;
  setTyping: (podId: string, isTyping: boolean) => void;
  clearMessagesByPodIds: (podIds: string[]) => void;
  handleMessagesClearedEvent: (payload: PodMessagesClearedPayload) => void;
}

export function createMessageActions(
  store: ChatStoreInstance,
): ChatMessageActions {
  const toolTrackingActions = createToolTrackingActions(store);
  const messageCompletionActions = createMessageCompletionActions(
    store,
    (podId, isTyping) => setTyping(store, podId, isTyping),
  );

  function appendUserMessageToStore(podId: string, message: Message): void {
    const podStore = usePodStore();
    const pod = podStore.pods.find((p) => p.id === podId);
    if (!pod) return;

    const messages = getMessages(store, podId);
    store.messagesByPodId.set(podId, [...messages, message]);

    appendUserOutputToPod(pod, message.content);
  }

  const addUserMessage = (podId: string, content: string): void => {
    const userMessage: Message = {
      id: generateRequestId(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    appendUserMessageToStore(podId, userMessage);
  };

  const addRemoteUserMessage = (
    podId: string,
    messageId: string,
    content: string,
    timestamp: string,
  ): void => {
    const userMessage: Message = {
      id: messageId,
      role: "user",
      content,
      timestamp,
    };

    appendUserMessageToStore(podId, userMessage);
  };

  const handleChatMessage = (payload: PodChatMessagePayload): void => {
    const { podId, messageId, content, isPartial, role, metadata } = payload;
    const messages = getMessages(store, podId);
    const messageIndex = findMessageIndex(messages, messageId);

    const lastLength = store.accumulatedLengthByMessageId.get(messageId) ?? 0;
    const delta = content.slice(lastLength);
    store.accumulatedLengthByMessageId.set(messageId, content.length);

    if (messageIndex === -1) {
      addNewChatMessage(
        podId,
        messageId,
        content,
        isPartial,
        role,
        delta,
        metadata,
      );
      return;
    }

    updateExistingChatMessage(
      podId,
      messages,
      messageIndex,
      content,
      isPartial,
      delta,
      metadata,
    );
  };

  function buildNewMessage(
    messageId: string,
    effectiveRole: MessageRole,
    content: string,
    isPartial: boolean,
    delta?: string,
    metadata?: SystemMessageMetadata,
  ): Message {
    const baseMessage: Message = {
      id: messageId,
      role: effectiveRole,
      content,
      metadata,
      isPartial,
      timestamp: new Date().toISOString(),
    };

    const shape =
      effectiveRole === "assistant"
        ? createAssistantMessageShape(messageId, content, isPartial, delta)
        : {};

    return { ...baseMessage, ...shape };
  }

  const addNewChatMessage = (
    podId: string,
    messageId: string,
    content: string,
    isPartial: boolean,
    role?: MessageRole,
    delta?: string,
    metadata?: SystemMessageMetadata,
  ): void => {
    const messages = getMessages(store, podId);
    const effectiveRole = role ?? "assistant";
    const newMessage = buildNewMessage(
      messageId,
      effectiveRole,
      content,
      isPartial,
      delta,
      metadata,
    );

    store.messagesByPodId.set(podId, [...messages, newMessage]);
    store.currentStreamingMessageId = messageId;

    if (isPartial) {
      setTyping(store, podId, true);
    }

    if (effectiveRole === "user") {
      const podStore = usePodStore();
      const pod = podStore.pods.find((p) => p.id === podId);
      if (pod) {
        appendUserOutputToPod(pod, content);
      }
    }
  };

  const updateExistingChatMessage = (
    podId: string,
    messages: Message[],
    messageIndex: number,
    content: string,
    isPartial: boolean,
    delta: string,
    metadata?: SystemMessageMetadata,
  ): void => {
    const existingMessage = messages[messageIndex];

    if (!existingMessage) return;

    // 直接對既有物件做屬性賦值，避免每個 chunk 都淺複製整個訊息陣列（O(n) 開銷）
    existingMessage.content = content;
    existingMessage.isPartial = isPartial;
    if (metadata !== undefined) {
      existingMessage.metadata = metadata;
    }

    if (existingMessage.role === "assistant" && existingMessage.subMessages) {
      const { subMessages } = updateAssistantSubMessages(
        existingMessage,
        delta,
        isPartial,
      );
      existingMessage.subMessages = subMessages;
    }

    // 原陣列參考不變，透過 Map.set() 讓 Pinia reactive Map 觸發更新
    store.messagesByPodId.set(podId, messages);

    if (isPartial) {
      setTyping(store, podId, true);
    }
  };

  const convertSubMessages = (
    persistedMessage: PersistedMessage,
  ): Pick<Message, "subMessages" | "toolUse"> => {
    if (
      !persistedMessage.subMessages ||
      persistedMessage.subMessages.length === 0
    ) {
      return {
        subMessages: [
          {
            id: `${persistedMessage.id}-sub-0`,
            content: persistedMessage.content,
            isPartial: false,
          },
        ],
      };
    }

    const allToolUse = collectToolUseFromSubMessages(
      persistedMessage.subMessages,
    );

    const result: Pick<Message, "subMessages" | "toolUse"> = {
      subMessages: persistedMessage.subMessages.map((sub) => ({
        id: sub.id,
        content: sub.content,
        isPartial: false,
        toolUse: sub.toolUse?.map((t) => ({
          toolUseId: t.toolUseId,
          toolName: t.toolName,
          input: t.input,
          output: t.output,
          status: isValidToolUseStatus(t.status) ? t.status : "completed",
        })),
      })),
    };

    if (allToolUse.length > 0) {
      result.toolUse = allToolUse;
    }

    return result;
  };

  const convertPersistedToMessage = (
    persistedMessage: PersistedMessage,
  ): Message => {
    const message: Message = {
      id: persistedMessage.id,
      role: persistedMessage.role,
      content: persistedMessage.content,
      metadata: persistedMessage.metadata,
      timestamp: persistedMessage.timestamp,
      isPartial: false,
    };

    if (persistedMessage.role !== "assistant") return message;

    return { ...message, ...convertSubMessages(persistedMessage) };
  };

  const setPodMessages = (podId: string, messages: Message[]): void => {
    store.messagesByPodId.set(podId, messages);
  };

  const clearMessagesByPodIds = (podIds: string[]): void => {
    podIds.forEach((podId) => {
      store.messagesByPodId.delete(podId);
      store.isTypingByPodId.delete(podId);
    });
  };

  const handleMessagesClearedEvent = (
    payload: PodMessagesClearedPayload,
  ): void => {
    clearMessagesByPodIds([payload.podId]);

    const podStore = usePodStore();
    podStore.clearPodOutputsByIds([payload.podId]);
  };

  const boundSetTyping = (podId: string, isTyping: boolean): void =>
    setTyping(store, podId, isTyping);

  return {
    addUserMessage,
    addRemoteUserMessage,
    handleChatMessage,
    addNewChatMessage,
    updateExistingChatMessage,
    ...toolTrackingActions,
    ...messageCompletionActions,
    convertPersistedToMessage,
    setPodMessages,
    setTyping: boundSetTyping,
    clearMessagesByPodIds,
    handleMessagesClearedEvent,
  };
}
