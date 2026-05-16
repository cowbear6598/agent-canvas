import type { Message } from "@/types/chat";
import type {
  PodChatAbortedPayload,
  PodChatCompletePayload,
} from "@/types/websocket";
import type { ChatStoreInstance } from "./chatStore";
import {
  finalizeSubMessages,
  finalizeToolUse,
  updateMainMessageState,
} from "./subMessageHelpers";
import { getMessages, findMessageIndex } from "./chatStoreHelpers";

export function createMessageCompletionActions(
  store: ChatStoreInstance,
  setTyping: (podId: string, isTyping: boolean) => void,
): {
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
} {
  const finalizeStreaming = (podId: string, messageId: string): void => {
    setTyping(podId, false);

    if (store.currentStreamingMessageId === messageId) {
      store.currentStreamingMessageId = null;
    }
  };

  const completeMessage = (
    podId: string,
    messages: Message[],
    messageIndex: number,
    fullContent: string,
    messageId: string,
  ): void => {
    const updatedMessages = [...messages];
    const existingMessage = updatedMessages[messageIndex];

    if (!existingMessage) return;

    const updatedToolUse = finalizeToolUse(existingMessage.toolUse);
    const finalizedSubMessages = finalizeSubMessages(
      existingMessage.subMessages,
    );

    updatedMessages[messageIndex] = updateMainMessageState(
      existingMessage,
      fullContent,
      updatedToolUse,
      finalizedSubMessages,
    );

    store.messagesByPodId.set(podId, updatedMessages);

    finalizeStreaming(podId, messageId);
  };

  const handleChatComplete = (payload: PodChatCompletePayload): void => {
    const { podId, messageId, fullContent } = payload;
    const messages = getMessages(store, podId);
    const messageIndex = findMessageIndex(messages, messageId);

    store.accumulatedLengthByMessageId.delete(messageId);

    if (messageIndex === -1) {
      finalizeStreaming(podId, messageId);
      return;
    }

    completeMessage(podId, messages, messageIndex, fullContent, messageId);
  };

  const handleChatAborted = (payload: PodChatAbortedPayload): void => {
    const { podId, messageId } = payload;

    store.accumulatedLengthByMessageId.delete(messageId);

    const messages = getMessages(store, podId);
    const messageIndex = findMessageIndex(messages, messageId);

    if (messageIndex !== -1) {
      completeMessage(
        podId,
        messages,
        messageIndex,
        messages[messageIndex]!.content,
        messageId,
      );
    } else {
      finalizeStreaming(podId, messageId);
    }
  };

  return {
    handleChatComplete,
    handleChatAborted,
    finalizeStreaming,
    completeMessage,
  };
}
