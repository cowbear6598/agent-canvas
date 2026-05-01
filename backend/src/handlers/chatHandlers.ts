import { v4 as uuidv4 } from "uuid";
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
import {
  buildCommandNotFoundMessage,
  tryExpandCommandMessage,
} from "../services/commandExpander.js";
import { socketService } from "../services/socketService.js";
import { promoteStagingToFinal } from "../services/attachmentWriter.js";
import {
  AttachmentTooLargeError,
  AttachmentDiskFullError,
  AttachmentInvalidNameError,
  AttachmentWriteError,
  UploadSessionNotFoundError,
} from "../services/attachmentErrors.js";

function validateIntegrationBindings(
  connectionId: string,
  canvasId: string,
  pod: Pod,
  requestId: string,
): boolean {
  if (pod.integrationBindings?.length) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.podIntegrationBound", { name: pod.name }),
      canvasId,
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
  canvasId: string,
  pod: Pod,
  requestId: string,
): boolean {
  if (isPodBusy(pod.status)) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.podBusy", { id: pod.id, status: pod.status }),
      canvasId,
      requestId,
      pod.id,
      "POD_BUSY",
    );
    return false;
  }
  return true;
}

/**
 * 將 promoteStagingToFinal 拋出的各類型錯誤對應到對應 i18n key 並 emit POD_ERROR。
 * caller 只需呼叫此函式後 return，不需再處理 error 細節。
 */
function emitAttachmentError(
  err: unknown,
  connectionId: string,
  canvasId: string,
  podId: string,
  requestId: string,
): void {
  if (err instanceof UploadSessionNotFoundError) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.uploadSessionNotFound"),
      canvasId,
      requestId,
      podId,
      "UPLOAD_SESSION_NOT_FOUND",
    );
  } else if (err instanceof AttachmentTooLargeError) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.attachmentTooLarge"),
      canvasId,
      requestId,
      podId,
      "ATTACHMENT_TOO_LARGE",
    );
  } else if (err instanceof AttachmentDiskFullError) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.attachmentDiskFull"),
      canvasId,
      requestId,
      podId,
      "ATTACHMENT_DISK_FULL",
    );
  } else if (err instanceof AttachmentInvalidNameError) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.attachmentInvalidName", {
        name: err.fileName,
      }),
      canvasId,
      requestId,
      podId,
      "ATTACHMENT_INVALID_NAME",
    );
  } else if (err instanceof AttachmentWriteError) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.attachmentWriteFailed"),
      canvasId,
      requestId,
      podId,
      "ATTACHMENT_WRITE_FAILED",
    );
  } else {
    // 未預期的錯誤
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_ERROR,
      createI18nError("errors.attachmentWriteFailed"),
      canvasId,
      requestId,
      podId,
      "ATTACHMENT_WRITE_FAILED",
    );
  }
}

/**
 * 處理帶有 uploadSessionId 的聊天訊息（multi-instance 與串行兩條路徑）。
 * 呼叫 promoteStagingToFinal 將 staging 目錄 atomic rename 為正式附件目錄，
 * 失敗時 emit 對應錯誤並 early return，不建立 chat message。
 */
async function handleChatSendWithUploadSession(
  connectionId: string,
  canvasId: string,
  payload: ChatSendPayload,
  requestId: string,
  pod: Pod,
): Promise<void> {
  const { podId } = payload;
  const uploadSessionId = payload.uploadSessionId!;
  const podName = pod.name;

  // 串行 pod：先確認 pod 不忙碌，busy 直接拒絕。
  // 注意：busy 時不主動清除 staging，留給 6h tmpCleanup 定時清理（YAGNI）。
  if (pod.multiInstance !== true) {
    if (!validatePodNotBusy(connectionId, canvasId, pod, requestId)) return;
  }

  // 預先產生 chatMessageId，與 promoteStagingToFinal 目標目錄名稱一致
  const chatMessageId = uuidv4();

  // 將 staging 目錄 atomic rename 為正式目錄（任一失敗都 early return，不建 chat message）
  let promoteResult: { dir: string; files: string[] };
  try {
    promoteResult = await promoteStagingToFinal(uploadSessionId, chatMessageId);
  } catch (err) {
    emitAttachmentError(err, connectionId, canvasId, podId, requestId);
    return;
  }

  // 組觸發訊息（zh-TW），前端 drop 路徑 message 永遠為空字串
  // 安全 trade-off 說明：此處刻意將絕對路徑（promoteResult.dir）傳入 LLM prompt。
  // 原因：agent 必須能以 Read tool 讀取附件目錄，若改用相對路徑或符號化名稱
  // 則 agent 無法定位檔案，功能完全失效。
  // 已知此設計會將伺服器 tmpRoot 絕對路徑洩漏給 LLM，屬必要 trade-off 而非 oversight。
  // 若未來改為 per-pod workspace symlink 方案可消除洩漏，但需重構 tmpRoot 管理邏輯。
  const fileList = promoteResult.files.join(", ");
  const triggerText = `我提供了下列檔案在 \`${promoteResult.dir}\`：${fileList}`;

  if (pod.multiInstance === true) {
    // multi-instance pod：建新 Run，userMessageId 透傳確保落地一致
    await launchMultiInstanceRun({
      canvasId,
      podId,
      message: triggerText,
      abortable: true,
      commandNotFoundBehavior: "skip",
      userMessageId: chatMessageId,
      onCommandNotFound: (commandId) =>
        handleCommandNotFound(canvasId, podId, commandId),
      onComplete: (runContext) =>
        onRunChatComplete(runContext, canvasId, podId),
      onAborted: (abortedCanvasId, abortedPodId, messageId) =>
        onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
    });
    return;
  }

  // 串行 pod：展開 Command（若訊息含 Command 語法）
  const expandResult = await tryExpandCommandMessage(
    pod,
    triggerText,
    "handleChatSend",
  );

  if (!expandResult.ok) {
    // Command 不存在：注入原始觸發訊息、推送錯誤文字，不呼叫 Claude
    await injectUserMessage({
      canvasId,
      podId,
      content: triggerText,
      id: chatMessageId,
    });
    handleCommandNotFound(canvasId, podId, expandResult.commandId);
    return;
  }

  const resolvedTrigger = expandResult.message;

  // 寫入 DB（chatMessageId 對齊 attachments dir）並送 LLM
  await injectUserMessage({
    canvasId,
    podId,
    content: resolvedTrigger,
    id: chatMessageId,
  });

  const attachStrategy = new NormalModeExecutionStrategy(canvasId);

  await executeStreamingChat(
    {
      canvasId,
      podId,
      message: resolvedTrigger,
      abortable: true,
      strategy: attachStrategy,
    },
    {
      onComplete: onChatComplete,
      onAborted: (abortedCanvasId, abortedPodId, messageId) =>
        onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
    },
  );
}

/**
 * 處理一般（無 attachments）的聊天訊息（multi-instance 與串行兩條路徑）。
 */
async function handleChatSendNormal(
  connectionId: string,
  canvasId: string,
  payload: ChatSendPayload,
  requestId: string,
  pod: Pod,
): Promise<void> {
  const { podId, message } = payload;
  const podName = pod.name;

  if (pod.multiInstance === true) {
    await launchMultiInstanceRun({
      canvasId,
      podId,
      message,
      abortable: true,
      commandNotFoundBehavior: "skip",
      onCommandNotFound: (commandId) =>
        handleCommandNotFound(canvasId, podId, commandId),
      onComplete: (runContext) =>
        onRunChatComplete(runContext, canvasId, podId),
      onAborted: (abortedCanvasId, abortedPodId, messageId) =>
        onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
    });
    return;
  }

  if (!validatePodNotBusy(connectionId, canvasId, pod, requestId)) return;

  // 在注入歷史記錄前先展開 Command，確保歷史與送給 Claude 的訊息一致
  const expandResult = await tryExpandCommandMessage(
    pod,
    message,
    "handleChatSend",
  );

  if (!expandResult.ok) {
    // Command 不存在：注入原始訊息、推送錯誤文字給前端，不呼叫 Claude
    await injectUserMessage({ canvasId, podId, content: message });
    handleCommandNotFound(canvasId, podId, expandResult.commandId);
    return;
  }

  const resolvedMessage = expandResult.message;

  // 歷史記錄與 Claude 都使用展開版訊息
  await injectUserMessage({ canvasId, podId, content: resolvedMessage });

  const strategy = new NormalModeExecutionStrategy(canvasId);

  await executeStreamingChat(
    {
      canvasId,
      podId,
      message: resolvedMessage,
      abortable: true,
      strategy,
    },
    {
      onComplete: onChatComplete,
      onAborted: (abortedCanvasId, abortedPodId, messageId) =>
        onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
    },
  );
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
    const { podId } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_ERROR,
      requestId,
    );
    if (!pod) return;

    if (!validateIntegrationBindings(connectionId, canvasId, pod, requestId))
      return;

    if (payload.uploadSessionId !== undefined) {
      await handleChatSendWithUploadSession(
        connectionId,
        canvasId,
        payload,
        requestId,
        pod,
      );
    } else {
      await handleChatSendNormal(
        connectionId,
        canvasId,
        payload,
        requestId,
        pod,
      );
    }
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
        canvasId,
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
        canvasId,
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
        canvasId,
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
        metadata: message.metadata,
        subMessages: message.subMessages,
      })),
    });
  },
);
