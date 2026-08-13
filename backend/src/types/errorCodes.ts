/**
 * 後端 WebSocket 錯誤碼常量。
 * handler 使用字串常量，避免拼字錯誤，前端可依此做對應處理。
 */

// ── Attachment 錯誤碼 ─────────────────────────────────────────────
export const ERROR_CODE_ATTACHMENT_TOO_LARGE = "ATTACHMENT_TOO_LARGE" as const;
export const ERROR_CODE_ATTACHMENT_INVALID_NAME =
  "ATTACHMENT_INVALID_NAME" as const;
export const ERROR_CODE_ATTACHMENT_DISK_FULL = "ATTACHMENT_DISK_FULL" as const;
export const ERROR_CODE_ATTACHMENT_WRITE_FAILED =
  "ATTACHMENT_WRITE_FAILED" as const;
export const ERROR_CODE_ATTACHMENT_INVALID_ARCHIVE =
  "ATTACHMENT_INVALID_ARCHIVE" as const;
export const ERROR_CODE_ATTACHMENT_ARCHIVE_TOO_LARGE =
  "ATTACHMENT_ARCHIVE_TOO_LARGE" as const;

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
export const I18N_KEY_ATTACHMENT_TOO_LARGE =
  "errors.attachmentTooLarge" as const;
export const I18N_KEY_ATTACHMENT_INVALID_NAME =
  "errors.attachmentInvalidName" as const;
export const I18N_KEY_ATTACHMENT_DISK_FULL =
  "errors.attachmentDiskFull" as const;
export const I18N_KEY_ATTACHMENT_WRITE_FAILED =
  "errors.attachmentWriteFailed" as const;
export const I18N_KEY_ATTACHMENT_INVALID_ARCHIVE =
  "errors.attachmentInvalidArchive" as const;
export const I18N_KEY_ATTACHMENT_ARCHIVE_TOO_LARGE =
  "errors.attachmentArchiveTooLarge" as const;

// ── Upload i18n key 常量 ──────────────────────────────────────────
export const I18N_KEY_UPLOAD_SESSION_NOT_FOUND =
  "errors.uploadSessionNotFound" as const;
