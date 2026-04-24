import { v4 as uuidv4 } from "uuid";
import { WebSocketResponseEvents } from "../schemas";
import type { Pod, ContentBlock } from "../types";
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
import { commandService } from "../services/commandService.js";
import {
  buildCommandNotFoundMessage,
  expandCommandMessage,
} from "../services/commandExpander.js";
import { socketService } from "../services/socketService.js";
import { logger } from "../utils/logger.js";

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

type ExpandCommandResult =
  | { ok: true; message: string | ContentBlock[] }
  | { ok: false; commandId: string };

/**
 * 嘗試展開 Pod 綁定的 Command 內容。
 * - pod 無 commandId 時：直接回傳原始訊息（ok: true）
 * - command 讀取成功時：回傳展開版訊息（ok: true）
 * - command 讀取失敗（檔案已消失）：回傳 ok: false 帶 commandId
 */
async function tryExpandCommandMessage(
  pod: Pod,
  message: string | ContentBlock[],
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
    `[handleChatSend] Command 不存在，回傳錯誤給前端（commandId=${commandId}, podId=${pod.id}）`,
  );
  return { ok: false, commandId };
}

/**
 * 處理 Command 不存在的情況：推送錯誤文字至前端，並將 Pod 狀態重設為 idle。
 * commandId 為 Command 的檔名（即展示用名稱），直接顯示給使用者是合適的。
 */
function handleCommandNotFound(
  canvasId: string,
  podId: string,
  commandId: string,
): void {
  const errorText = buildCommandNotFoundMessage(commandId);
  socketService.emitToCanvas(
    canvasId,
    WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
    {
      canvasId,
      podId,
      messageId: uuidv4(),
      content: `\n\n⚠️ ${errorText}`,
      isPartial: false,
      role: "assistant",
    },
  );
  podStore.setStatus(canvasId, podId, "idle");
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

    // 展開 Command 內容（在 injectUserMessage 之前執行，確保 DB 存入展開版）
    const expandResult = await tryExpandCommandMessage(pod, message);

    // DB 存入展開版（或原文，若 command 讀不到）
    const contentToStore = expandResult.ok ? expandResult.message : message;
    await injectUserMessage({ canvasId, podId, content: contentToStore });

    if (!expandResult.ok) {
      // Command 檔案已消失：推送錯誤文字讓前端顯示，並將 pod 回到 idle
      handleCommandNotFound(canvasId, podId, expandResult.commandId);
      return;
    }

    const strategy = new NormalModeExecutionStrategy(canvasId);

    await executeStreamingChat(
      {
        canvasId,
        podId,
        message: expandResult.message,
        abortable: true,
        strategy,
      },
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
