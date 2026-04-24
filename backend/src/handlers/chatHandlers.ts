import { WebSocketResponseEvents } from "../schemas";
import type { Pod } from "../types";
import { isPodBusy } from "../types/index.js";
import type {
  ChatSendPayload,
  ChatHistoryPayload,
  ChatAbortPayload,
} from "../schemas";
import { podStore } from "../services/podStore.js";
import { messageStore } from "../services/messageStore.js";
import { emitError, emitSuccess } from "../utils/websocketResponse.js";
import { abortRegistry } from "../services/provider/abortRegistry.js";
import { createI18nError } from "../utils/i18nError.js";
import {
  onChatComplete,
  onChatAborted,
  onRunChatComplete,
} from "../utils/chatCallbacks.js";
import { validatePod, withCanvasId } from "../utils/handlerHelpers.js";
import { executeStreamingChat } from "../services/claude/streamingChatExecutor.js";
import { injectUserMessage } from "../utils/chatHelpers.js";
import { launchMultiInstanceRun } from "../utils/runChatHelpers.js";
import { NormalModeExecutionStrategy } from "../services/normalExecutionStrategy.js";
import { getProvider } from "../services/provider/index.js";

function validateIntegrationBindings(
  connectionId: string,
  pod: Pod,
  requestId: string,
): boolean {
  if (pod.integrationBindings?.length) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.podIntegrationBound", { name: pod.name }),
      requestId,
      pod.id,
      "INTEGRATION_BOUND",
    );
    return false;
  }
  return true;
}

function validatePodNotBusy(
  connectionId: string,
  pod: Pod,
  requestId: string,
): boolean {
  if (isPodBusy(pod.status)) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.podBusy", { id: pod.id, status: pod.status }),
      requestId,
      pod.id,
      "POD_BUSY",
    );
    return false;
  }
  return true;
}

export const handleChatSend = withCanvasId<ChatSendPayload>(
  WebSocketResponseEvents.POD_ERROR,
  async (
    connectionId: string,
    canvasId: string,
    payload: ChatSendPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, message } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_ERROR,
      requestId,
    );
    if (!pod) return;

    if (!validateIntegrationBindings(connectionId, pod, requestId)) return;

    // Capability 守門：Codex Pod 不支援 Run 模式
    if (
      pod.multiInstance === true &&
      !getProvider(pod.provider).metadata.capabilities.runMode
    ) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_ERROR,
        createI18nError("errors.runNotSupported", { provider: pod.provider }),
        requestId,
        pod.id,
        "RUN_NOT_SUPPORTED",
      );
      return;
    }

    const podName = pod.name;

    if (pod.multiInstance === true) {
      await launchMultiInstanceRun({
        canvasId,
        podId,
        message,
        abortable: true,
        onComplete: (runContext) =>
          onRunChatComplete(runContext, canvasId, podId),
        onAborted: (abortedCanvasId, abortedPodId, messageId) =>
          onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
      });
      return;
    }

    if (!validatePodNotBusy(connectionId, pod, requestId)) return;

    const strategy = new NormalModeExecutionStrategy(canvasId);

    await injectUserMessage({ canvasId, podId, content: message });

    await executeStreamingChat(
      { canvasId, podId, message, abortable: true, strategy },
      {
        onComplete: onChatComplete,
        onAborted: (abortedCanvasId, abortedPodId, messageId) =>
          onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
      },
    );
  },
);

export const handleChatAbort = withCanvasId<ChatAbortPayload>(
  WebSocketResponseEvents.POD_ERROR,
  async (
    connectionId: string,
    canvasId: string,
    payload: ChatAbortPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_ERROR,
      requestId,
    );
    if (!pod) return;

    if (pod.status !== "chatting") {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_ERROR,
        createI18nError("errors.podNotChatting", { id: podId }),
        requestId,
        podId,
        "POD_NOT_CHATTING",
      );
      return;
    }

    const aborted = abortRegistry.abort(podId);
    if (!aborted) {
      // abort 失敗但 pod 狀態是 chatting，重設為 idle 避免卡死
      podStore.setStatus(canvasId, podId, "idle");
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_ERROR,
        createI18nError("errors.noActiveQuery", { id: podId }),
        requestId,
        podId,
        "NO_ACTIVE_QUERY",
      );
      return;
    }
  },
);

export const handleChatHistory = withCanvasId<ChatHistoryPayload>(
  WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT,
  async (
    connectionId: string,
    canvasId: string,
    payload: ChatHistoryPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId } = payload;

    const pod = podStore.getById(canvasId, podId);
    if (!pod) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT,
        createI18nError("errors.podNotFound", { id: podId }),
        requestId,
        podId,
        "NOT_FOUND",
      );
      return;
    }

    const messages = messageStore.getMessages(podId);
    emitSuccess(connectionId, WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT, {
      requestId,
      success: true,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        subMessages: message.subMessages,
      })),
    });
  },
);
