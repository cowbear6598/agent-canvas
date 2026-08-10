import { v4 as uuidv4 } from "uuid";
import { WebSocketResponseEvents } from "../schemas";
import type { Pod } from "../types";
import type { ChatSendPayload, ChatAbortPayload } from "../schemas";
import { emitError } from "../utils/websocketResponse.js";
import { abortRegistry } from "../services/provider/abortRegistry.js";
import { createI18nError } from "../utils/i18nError.js";
import { onChatAborted, onRunChatComplete } from "../utils/chatCallbacks.js";
import { validatePod, withCanvasId } from "../utils/handlerHelpers.js";
import { launchRun } from "../utils/runChatHelpers.js";
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
 * 處理帶有 uploadSessionId 的聊天訊息（multi-instance 路徑）。
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

  const fileList = promoteResult.files.join(", ");

  // dbTriggerText：寫入 DB 與顯示給前端的訊息，不含伺服器絕對路徑（避免洩漏）。
  // llmTriggerText：僅傳給 LLM，包含絕對路徑以讓 agent 能以 Read tool 讀取附件目錄。
  // 安全 trade-off：LLM 仍會收到絕對路徑，此為讓 agent 正常讀取附件的必要設計。
  // 若未來改為 per-pod workspace symlink 方案，可消除此洩漏，但需重構 tmpRoot 管理邏輯。
  const llmTriggerText = `我提供了下列檔案或資料夾在 \`${promoteResult.dir}\`：${fileList}`;

  // multi-instance pod：建新 Run，userMessageId 透傳確保落地一致
  // multi-instance 路徑由 Run 自行管理訊息儲存，此處傳 llmTriggerText 供 LLM 讀取附件
  await launchRun({
    canvasId,
    podId,
    message: llmTriggerText,
    abortable: true,
    userMessageId: chatMessageId,
    onComplete: (runContext) => onRunChatComplete(runContext, canvasId, podId),
    onAborted: (abortedCanvasId, abortedPodId, messageId) =>
      onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
  });
}

/**
 * 處理一般（無 attachments）的聊天訊息（multi-instance 路徑）。
 */
async function handleChatSendPlain(
  _connectionId: string,
  canvasId: string,
  payload: ChatSendPayload,
  _requestId: string,
  pod: Pod,
): Promise<void> {
  const { podId, message } = payload;
  const podName = pod.name;

  await launchRun({
    canvasId,
    podId,
    message,
    abortable: true,
    onComplete: (runContext) => onRunChatComplete(runContext, canvasId, podId),
    onAborted: (abortedCanvasId, abortedPodId, messageId) =>
      onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
  });
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
      await handleChatSendPlain(
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

    const aborted = abortRegistry.abortByPodId(podId);
    if (!aborted) {
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
    // POD_CHAT_ABORTED 事件由 streamingChatExecutor 的 onAborted callback（即 onChatAborted）負責發送
  },
);
