/**
 * 後端 WebSocket 錯誤碼常量。
 * handler 使用字串常量，避免拼字錯誤，前端可依此做對應處理。
 */

// ── 通用錯誤碼 ────────────────────────────────────────────────────
export const ERROR_CODE_INTERNAL_ERROR = "INTERNAL_ERROR" as const;
export const ERROR_CODE_UNKNOWN_ERROR = "UNKNOWN_ERROR" as const;
export const ERROR_CODE_NOT_FOUND = "NOT_FOUND" as const;
export const ERROR_CODE_IN_USE = "IN_USE" as const;
export const ERROR_CODE_INVALID_STATE = "INVALID_STATE" as const;
export const ERROR_CODE_INVALID_INPUT = "INVALID_INPUT" as const;
export const ERROR_CODE_INVALID_PATH = "INVALID_PATH" as const;
export const ERROR_CODE_ALREADY_EXISTS = "ALREADY_EXISTS" as const;
export const ERROR_CODE_VALIDATION_ERROR = "VALIDATION_ERROR" as const;

// ── Attachment 錯誤碼 ─────────────────────────────────────────────
export const ERROR_CODE_ATTACHMENT_EMPTY = "ATTACHMENT_EMPTY" as const;
export const ERROR_CODE_ATTACHMENT_TOO_LARGE = "ATTACHMENT_TOO_LARGE" as const;
export const ERROR_CODE_ATTACHMENT_INVALID_NAME =
  "ATTACHMENT_INVALID_NAME" as const;
export const ERROR_CODE_ATTACHMENT_DISK_FULL = "ATTACHMENT_DISK_FULL" as const;
export const ERROR_CODE_ATTACHMENT_WRITE_FAILED =
  "ATTACHMENT_WRITE_FAILED" as const;

// ── Upload 錯誤碼 ─────────────────────────────────────────────────
/** 找不到對應 staging session（前端可能上傳未完成或 session 已過期） */
export const ERROR_CODE_UPLOAD_SESSION_NOT_FOUND =
  "UPLOAD_SESSION_NOT_FOUND" as const;
/** sessionId 格式不合法 */
export const ERROR_CODE_UPLOAD_INVALID_SESSION_ID =
  "UPLOAD_INVALID_SESSION_ID" as const;
/** HTTP 請求缺少檔案欄位 */
export const ERROR_CODE_UPLOAD_NO_FILE = "UPLOAD_NO_FILE" as const;

// ── Attachment i18n key 常量 ──────────────────────────────────────
export const I18N_KEY_ATTACHMENT_EMPTY = "errors.attachmentEmpty" as const;
export const I18N_KEY_ATTACHMENT_TOO_LARGE =
  "errors.attachmentTooLarge" as const;
export const I18N_KEY_ATTACHMENT_INVALID_NAME =
  "errors.attachmentInvalidName" as const;
export const I18N_KEY_ATTACHMENT_DISK_FULL =
  "errors.attachmentDiskFull" as const;
export const I18N_KEY_ATTACHMENT_WRITE_FAILED =
  "errors.attachmentWriteFailed" as const;

// ── Upload i18n key 常量 ──────────────────────────────────────────
export const I18N_KEY_UPLOAD_SESSION_NOT_FOUND =
  "errors.uploadSessionNotFound" as const;
export const I18N_KEY_UPLOAD_INVALID_SESSION_ID =
  "errors.uploadInvalidSessionId" as const;
export const I18N_KEY_UPLOAD_NO_FILE = "errors.uploadNoFile" as const;
