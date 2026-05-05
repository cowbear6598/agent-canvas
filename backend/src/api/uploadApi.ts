import { jsonResponse } from "./apiHelpers.js";
import { writeAttachmentToStaging } from "../services/attachmentWriter.js";
import {
  AttachmentTooLargeError,
  AttachmentInvalidNameError,
  AttachmentDiskFullError,
  AttachmentWriteError,
} from "../services/attachmentErrors.js";
import { UPLOAD_SESSION_ID_REGEX } from "../services/uploadConstants.js";
import {
  ERROR_CODE_UPLOAD_NO_FILE,
  ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
  ERROR_CODE_ATTACHMENT_TOO_LARGE,
  ERROR_CODE_ATTACHMENT_INVALID_NAME,
  ERROR_CODE_ATTACHMENT_WRITE_FAILED,
  ERROR_CODE_ATTACHMENT_DISK_FULL,
} from "../types/errorCodes.js";
import { HTTP_STATUS } from "../constants.js";
import { logger } from "../utils/logger.js";
import { handshakeAuthService } from "../services/auth/handshakeAuthService.js";
import { authAccessService } from "../services/auth/authAccessService.js";
import { canvasStore } from "../services/canvasStore.js";

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
  // 解析 multipart/form-data（使用 unknown 避免 Bun undici-types 與 lib.dom FormData 型別衝突）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let formData: any;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_NO_FILE,
        message: "無法解析上傳表單，請確認請求格式為 multipart/form-data",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  // 取得 uploadSessionId 欄位
  const canvasId = formData.get("canvasId");
  if (canvasId === null || canvasId === "") {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
        message: "缺少 canvasId 欄位",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (typeof canvasId !== "string") {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
        message: "canvasId 格式無效",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (!canvasStore.getById(canvasId)) {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
        message: "canvasId 不存在",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const sessionId = handshakeAuthService.resolveRequestSessionId(req);
  if (!authAccessService.isCanvasAccessible(sessionId, canvasId)) {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
        message: "Canvas password required",
      },
      HTTP_STATUS.FORBIDDEN,
    );
  }

  // 取得 uploadSessionId 欄位
  const uploadSessionId = formData.get("uploadSessionId");
  if (uploadSessionId === null || uploadSessionId === "") {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
        message: "缺少 uploadSessionId 欄位",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (typeof uploadSessionId !== "string") {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
        message: "uploadSessionId 格式無效",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  // 驗證 uploadSessionId 格式（UUID v4）
  if (!UPLOAD_SESSION_ID_REGEX.test(uploadSessionId)) {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_INVALID_SESSION_ID,
        message: "uploadSessionId 格式無效，必須為 UUID v4",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  // 取得 file 欄位
  const file = formData.get("file");
  if (file === null) {
    return jsonResponse(
      { errorCode: ERROR_CODE_UPLOAD_NO_FILE, message: "缺少 file 欄位" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (!(file instanceof File)) {
    return jsonResponse(
      {
        errorCode: ERROR_CODE_UPLOAD_NO_FILE,
        message: "file 欄位必須為檔案類型",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  // 將檔案寫入 staging 目錄
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
  } catch (err) {
    if (err instanceof AttachmentTooLargeError) {
      // 413 Payload Too Large
      return new Response(
        JSON.stringify({
          errorCode: ERROR_CODE_ATTACHMENT_TOO_LARGE,
          message: "檔案超過允許的最大大小（10 MB）",
        }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
    if (err instanceof AttachmentInvalidNameError) {
      return jsonResponse(
        {
          errorCode: ERROR_CODE_ATTACHMENT_INVALID_NAME,
          message: "檔案名稱包含不合法字元或格式",
        },
        HTTP_STATUS.BAD_REQUEST,
      );
    }
    if (err instanceof AttachmentDiskFullError) {
      // 507 Insufficient Storage
      return new Response(
        JSON.stringify({
          errorCode: ERROR_CODE_ATTACHMENT_DISK_FULL,
          message: "磁碟空間不足，無法儲存檔案",
        }),
        { status: 507, headers: { "Content-Type": "application/json" } },
      );
    }
    if (err instanceof AttachmentWriteError) {
      logger.error("Upload", "Error", "附件寫入失敗", err);
      return jsonResponse(
        {
          errorCode: ERROR_CODE_ATTACHMENT_WRITE_FAILED,
          message: "檔案寫入失敗，請稍後再試",
        },
        HTTP_STATUS.INTERNAL_ERROR,
      );
    }
    // 未預期的錯誤
    logger.error("Upload", "Error", "上傳時發生未預期的錯誤", err);
    return jsonResponse(
      {
        errorCode: ERROR_CODE_ATTACHMENT_WRITE_FAILED,
        message: "上傳時發生未預期的錯誤，請稍後再試",
      },
      HTTP_STATUS.INTERNAL_ERROR,
    );
  }
}
