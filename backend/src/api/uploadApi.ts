import { jsonResponse } from "./apiHelpers.js";
import { writeAttachmentToStaging } from "../services/attachmentWriter.js";
import {
  AttachmentTooLargeError,
  AttachmentInvalidNameError,
  AttachmentDiskFullError,
  AttachmentWriteError,
  AttachmentInvalidArchiveError,
  AttachmentArchiveTooLargeError,
} from "../services/attachmentErrors.js";
import { UPLOAD_SESSION_ID_REGEX } from "../services/uploadConstants.js";
import {
  ERROR_CODE_UPLOAD_NO_FILE,
  ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
  ERROR_CODE_ATTACHMENT_TOO_LARGE,
  ERROR_CODE_ATTACHMENT_INVALID_NAME,
  ERROR_CODE_ATTACHMENT_WRITE_FAILED,
  ERROR_CODE_ATTACHMENT_DISK_FULL,
  ERROR_CODE_ATTACHMENT_INVALID_ARCHIVE,
  ERROR_CODE_ATTACHMENT_ARCHIVE_TOO_LARGE,
} from "../types/errorCodes.js";
import { HTTP_STATUS } from "../constants.js";
import { logger } from "../utils/logger.js";
import { handshakeAuthService } from "../services/auth/handshakeAuthService.js";
import { authAccessService } from "../services/auth/authAccessService.js";
import { canvasStore } from "../services/canvasStore.js";

type UploadFormData = Awaited<ReturnType<Request["formData"]>>;

function uploadError(
  errorCode: string,
  message: string,
  status: number,
): Response {
  return jsonResponse({ errorCode, message }, status);
}

function requireStringField(
  formData: UploadFormData,
  fieldName: string,
  missingMessage: string,
  invalidMessage: string,
): string | Response {
  const value = formData.get(fieldName);
  if (value === null || value === "") {
    return uploadError(
      ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
      missingMessage,
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (typeof value !== "string") {
    return uploadError(
      ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
      invalidMessage,
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  return value;
}

function validateCanvasAccess(req: Request, canvasId: string): Response | null {
  if (!canvasStore.getById(canvasId)) {
    return uploadError(
      ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
      "canvasId 不存在",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const sessionId = handshakeAuthService.resolveRequestSessionId(req);
  if (!authAccessService.isCanvasAccessible(sessionId, canvasId)) {
    return uploadError(
      ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
      "Canvas password required",
      HTTP_STATUS.FORBIDDEN,
    );
  }
  return null;
}

function requireUploadFile(formData: UploadFormData): File | Response {
  const file = formData.get("file");
  if (file === null) {
    return uploadError(
      ERROR_CODE_UPLOAD_NO_FILE,
      "缺少 file 欄位",
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (!(file instanceof File)) {
    return uploadError(
      ERROR_CODE_UPLOAD_NO_FILE,
      "file 欄位必須為檔案類型",
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  return file;
}

function rawJsonError(errorCode: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ errorCode, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function attachmentErrorResponse(error: unknown): Response {
  if (error instanceof AttachmentArchiveTooLargeError) {
    return rawJsonError(
      ERROR_CODE_ATTACHMENT_ARCHIVE_TOO_LARGE,
      "ZIP 解壓後總大小超過允許的最大大小（100 MB）",
      413,
    );
  }
  if (error instanceof AttachmentTooLargeError) {
    return rawJsonError(
      ERROR_CODE_ATTACHMENT_TOO_LARGE,
      "檔案超過允許的最大大小（100 MB）",
      413,
    );
  }
  if (error instanceof AttachmentInvalidArchiveError) {
    return uploadError(
      ERROR_CODE_ATTACHMENT_INVALID_ARCHIVE,
      "ZIP 檔案格式無效、已損毀或含有不安全內容",
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (error instanceof AttachmentInvalidNameError) {
    return uploadError(
      ERROR_CODE_ATTACHMENT_INVALID_NAME,
      "檔案名稱包含不合法字元或格式",
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (error instanceof AttachmentDiskFullError) {
    return rawJsonError(
      ERROR_CODE_ATTACHMENT_DISK_FULL,
      "磁碟空間不足，無法儲存檔案",
      507,
    );
  }
  if (error instanceof AttachmentWriteError) {
    logger.error("Upload", "Error", "附件寫入失敗", error);
    return uploadError(
      ERROR_CODE_ATTACHMENT_WRITE_FAILED,
      "檔案寫入失敗，請稍後再試",
      HTTP_STATUS.INTERNAL_ERROR,
    );
  }

  logger.error("Upload", "Error", "上傳時發生未預期的錯誤", error);
  return uploadError(
    ERROR_CODE_ATTACHMENT_WRITE_FAILED,
    "上傳時發生未預期的錯誤，請稍後再試",
    HTTP_STATUS.INTERNAL_ERROR,
  );
}

/**
 * POST /api/upload
 *
 * 接受 multipart/form-data，包含：
 *   - uploadSessionId: string（UUID v4）
 *   - file: File
 *
 * 成功回 200 JSON：{ filename, size, mime, uploadSessionId }
 * 失敗回對應 HTTP status 與 { errorCode, message }
 *
 * 注意：此階段不檢查 Pod 忙碌狀態，race window 故意留給 WS 階段處理。
 */
export async function handleUpload(req: Request): Promise<Response> {
  let formData: UploadFormData;
  try {
    formData = await req.formData();
  } catch {
    return uploadError(
      ERROR_CODE_UPLOAD_NO_FILE,
      "無法解析上傳表單，請確認請求格式為 multipart/form-data",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const canvasId = requireStringField(
    formData,
    "canvasId",
    "缺少 canvasId 欄位",
    "canvasId 格式無效",
  );
  if (canvasId instanceof Response) return canvasId;
  const canvasAccessError = validateCanvasAccess(req, canvasId);
  if (canvasAccessError) return canvasAccessError;

  const uploadSessionId = requireStringField(
    formData,
    "uploadSessionId",
    "缺少 uploadSessionId 欄位",
    "uploadSessionId 格式無效",
  );
  if (uploadSessionId instanceof Response) return uploadSessionId;

  if (!UPLOAD_SESSION_ID_REGEX.test(uploadSessionId)) {
    return uploadError(
      ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
      "uploadSessionId 格式無效，必須為 UUID v4",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const file = requireUploadFile(formData);
  if (file instanceof Response) return file;

  try {
    const result = await writeAttachmentToStaging(
      uploadSessionId,
      file,
      file.name,
    );
    return jsonResponse(
      {
        filename: result.filename,
        size: result.size,
        mime: result.mime,
        uploadSessionId,
      },
      HTTP_STATUS.OK,
    );
  } catch (error) {
    return attachmentErrorResponse(error);
  }
}
