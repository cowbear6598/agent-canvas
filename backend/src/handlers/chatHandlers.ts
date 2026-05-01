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

/** classifyAttachmentError 的回傳結構，包含 i18n key、錯誤 code 及可選的額外參數 */
interface AttachmentErrorClassification {
  i18nKey: string;
  code: string;
  extraParams?: Record<string, string | number>;
}

/**
 * 純函式：將 promoteStagingToFinal 拋出的各類型錯誤分類，
 * 回傳對應的 i18n key 與錯誤 code，不做任何 I/O 操作。
 */
function classifyAttachmentError(err: unknown): AttachmentErrorClassification {
  if (err instanceof UploadSessionNotFoundError) {
    return {
      i18nKey: "errors.uploadSessionNotFound",
      code: "UPLOAD_SESSION_NOT_FOUND",
    };
  } else if (err instanceof AttachmentTooLargeError) {
    return {
      i18nKey: "errors.attachmentTooLarge",
      code: "ATTACHMENT_TOO_LARGE",
    };
  } else if (err instanceof AttachmentDiskFullError) {
    return {
      i18nKey: "errors.attachmentDiskFull",
      code: "ATTACHMENT_DISK_FULL",
    };
  } else if (err instanceof AttachmentInvalidNameError) {
    return {
      i18nKey: "errors.attachmentInvalidName",
      code: "ATTACHMENT_INVALID_NAME",
      extraParams: { name: err.fileName },
    };
  } else if (err instanceof AttachmentWriteError) {
    return {
      i18nKey: "errors.attachmentWriteFailed",
      code: "ATTACHMENT_WRITE_FAILED",
    };
  } else {
    // 未預期的錯誤，使用獨立 code 與 i18n key 與 AttachmentWriteError 區分
    return {
      i18nKey: "errors.attachmentUnexpected",
      code: "ATTACHMENT_UNEXPECTED",
    };
  }
}

/**
 * 將 promoteStagingToFinal 拋出的各類型錯誤對應到對應 i18n key 並 emit POD_ERROR。
 * 錯誤分類邏輯由 classifyAttachmentError 負責，本函式只負責發送錯誤事件。
 * caller 只需呼叫此函式後 return，不需再處理 error 細節。
 */
function emitAttachmentError(
  err: unknown,
  connectionId: string,
  canvasId: string,
  podId: string,
  requestId: string,
): void {
  const { i18nKey, code, extraParams } = classifyAttachmentError(err);
  emitError(
    connectionId,
    WebSocketResponseEvents.POD_ERROR,
    createI18nError(i18nKey, extraParams),
    canvasId,
    requestId,
    podId,
    code,
  );
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
    // busy check 通過後同步佔位，避免 await promoteStagingToFinal 期間 concurrent 請求繞過 busy check
    podStore.setStatus(canvasId, podId, "chatting");
  }

  // 預先產生 chatMessageId，與 promoteStagingToFinal 目標目錄名稱一致
  const chatMessageId = uuidv4();

  // 將 staging 目錄 atomic rename 為正式目錄（任一失敗都 early return，不建 chat message）
  let promoteResult: { dir: string; files: string[] };
  try {
    promoteResult = await promoteStagingToFinal(uploadSessionId, chatMessageId);
  } catch (err) {
    // 附件寫入失敗：回滾 pod 狀態為 idle，避免 pod 永遠卡在 chatting
    if (pod.multiInstance !== true) {
      podStore.setStatus(canvasId, podId, "idle");
    }
    emitAttachmentError(err, connectionId, canvasId, podId, requestId);
    return;
  }

  const fileList = promoteResult.files.join(", ");

  // dbTriggerText：寫入 DB 與顯示給前端的訊息，不含伺服器絕對路徑（避免洩漏）。
  // llmTriggerText：僅傳給 LLM，包含絕對路徑以讓 agent 能以 Read tool 讀取附件目錄。
  // 安全 trade-off：LLM 仍會收到絕對路徑，此為讓 agent 正常讀取附件的必要設計。
  // 若未來改為 per-pod workspace symlink 方案，可消除此洩漏，但需重構 tmpRoot 管理邏輯。
  const dbTriggerText = `我提供了下列檔案（附件 ID：${chatMessageId}）：${fileList}`;
  const llmTriggerText = `我提供了下列檔案在 \`${promoteResult.dir}\`：${fileList}`;

  if (pod.multiInstance === true) {
    // multi-instance pod：建新 Run，userMessageId 透傳確保落地一致
    // multi-instance 路徑由 Run 自行管理訊息儲存，此處傳 llmTriggerText 供 LLM 讀取附件
    await launchMultiInstanceRun({
      canvasId,
      podId,
      message: llmTriggerText,
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
  // 用 llmTriggerText 做 Command 展開（LLM 需知道實際路徑）
  const expandResult = await tryExpandCommandMessage(
    pod,
    llmTriggerText,
    "handleChatSend",
  );

  if (!expandResult.ok) {
    // Command 不存在：注入去路徑化訊息到 DB，推送錯誤文字，不呼叫 Claude
    await injectUserMessage({
      canvasId,
      podId,
      content: dbTriggerText,
      id: chatMessageId,
    });
    handleCommandNotFound(canvasId, podId, expandResult.commandId);
    return;
  }

  // resolvedTrigger 為 LLM 用（含絕對路徑）；DB 儲存使用 dbTriggerText（不含路徑）
  const resolvedTrigger = expandResult.message;

  // 寫入 DB（chatMessageId 對齊 attachments dir），內容使用去路徑化版本
  await injectUserMessage({
    canvasId,
    podId,
    content: dbTriggerText,
    id: chatMessageId,
  });

  const attachStrategy = new NormalModeExecutionStrategy(canvasId);

  // 送給 LLM 的訊息使用含絕對路徑版本，讓 agent 能讀取附件
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
  // busy check 通過後同步佔位，避免 await tryExpandCommandMessage 期間 concurrent 請求繞過 busy check
  podStore.setStatus(canvasId, podId, "chatting");

  // 在注入歷史記錄前先展開 Command，確保歷史與送給 Claude 的訊息一致
  const expandResult = await tryExpandCommandMessage(
    pod,
    message,
    "handleChatSend",
  );

  if (!expandResult.ok) {
    // Command 不存在：注入原始訊息、推送錯誤文字給前端，不呼叫 Claude
    // handleCommandNotFound 內部會設定 pod 狀態為 idle，不需額外回滾
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
        // 歷史回傳前對 rawContent 做遮蔽，避免敏感的原始 SDK 錯誤字串洩漏給前端。
        // rawContent 欄位仍保留（型別契約要求必填），以空字串取代原始內容。
        metadata: message.metadata
          ? { ...message.metadata, rawContent: "" }
          : undefined,
        subMessages: message.subMessages,
      })),
    });
  },
);
