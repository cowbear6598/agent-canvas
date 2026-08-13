import { createI18nError } from "../utils/i18nError.js";
import {
  ERROR_CODE_ATTACHMENT_TOO_LARGE,
  ERROR_CODE_ATTACHMENT_INVALID_NAME,
  ERROR_CODE_ATTACHMENT_DISK_FULL,
  ERROR_CODE_ATTACHMENT_WRITE_FAILED,
  ERROR_CODE_ATTACHMENT_INVALID_ARCHIVE,
  ERROR_CODE_ATTACHMENT_ARCHIVE_TOO_LARGE,
  ERROR_CODE_UPLOAD_SESSION_NOT_FOUND,
  I18N_KEY_ATTACHMENT_TOO_LARGE,
  I18N_KEY_ATTACHMENT_INVALID_NAME,
  I18N_KEY_ATTACHMENT_DISK_FULL,
  I18N_KEY_ATTACHMENT_WRITE_FAILED,
  I18N_KEY_ATTACHMENT_INVALID_ARCHIVE,
  I18N_KEY_ATTACHMENT_ARCHIVE_TOO_LARGE,
  I18N_KEY_UPLOAD_SESSION_NOT_FOUND,
} from "../types/errorCodes.js";

/**
 * 附件超過允許的最大檔案大小。
 */
export class AttachmentTooLargeError extends Error {
  readonly code = ERROR_CODE_ATTACHMENT_TOO_LARGE;
  readonly i18nError = createI18nError(I18N_KEY_ATTACHMENT_TOO_LARGE);

  constructor() {
    super("附件超過允許的最大大小");
    this.name = "AttachmentTooLargeError";
  }
}

/**
 * 附件檔名不合法（包含路徑穿越字元或不允許的符號）。
 */
export class AttachmentInvalidNameError extends Error {
  readonly code = ERROR_CODE_ATTACHMENT_INVALID_NAME;
  readonly i18nError: ReturnType<typeof createI18nError>;
  readonly fileName: string;

  constructor(name: string) {
    super(`附件檔名不合法：${name}`);
    this.name = "AttachmentInvalidNameError";
    this.fileName = name;
    this.i18nError = createI18nError(I18N_KEY_ATTACHMENT_INVALID_NAME, {
      name,
    });
  }
}

/**
 * 磁碟空間不足，無法寫入附件。
 */
export class AttachmentDiskFullError extends Error {
  readonly code = ERROR_CODE_ATTACHMENT_DISK_FULL;
  readonly i18nError = createI18nError(I18N_KEY_ATTACHMENT_DISK_FULL);

  constructor() {
    super("磁碟空間不足，無法儲存附件");
    this.name = "AttachmentDiskFullError";
  }
}

/**
 * 附件寫入失敗（I/O 錯誤或其他非磁碟滿的原因）。
 */
export class AttachmentWriteError extends Error {
  readonly code = ERROR_CODE_ATTACHMENT_WRITE_FAILED;
  readonly i18nError = createI18nError(I18N_KEY_ATTACHMENT_WRITE_FAILED);

  constructor(cause?: Error) {
    super("附件寫入失敗");
    this.name = "AttachmentWriteError";
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * ZIP 附件格式損毀或含有不安全內容。
 */
export class AttachmentInvalidArchiveError extends Error {
  readonly code = ERROR_CODE_ATTACHMENT_INVALID_ARCHIVE;
  readonly i18nError = createI18nError(I18N_KEY_ATTACHMENT_INVALID_ARCHIVE);

  constructor(message = "ZIP 檔案格式無效或含有不安全內容") {
    super(message);
    this.name = "AttachmentInvalidArchiveError";
  }
}

/**
 * ZIP 解壓後總大小超過允許上限。
 */
export class AttachmentArchiveTooLargeError extends Error {
  readonly code = ERROR_CODE_ATTACHMENT_ARCHIVE_TOO_LARGE;
  readonly i18nError = createI18nError(
    I18N_KEY_ATTACHMENT_ARCHIVE_TOO_LARGE,
  );

  constructor() {
    super("ZIP 解壓後總大小超過 100 MB 上限");
    this.name = "AttachmentArchiveTooLargeError";
  }
}

/**
 * 找不到對應的 staging session（可能已過期或從未建立）。
 */
export class UploadSessionNotFoundError extends Error {
  readonly code = ERROR_CODE_UPLOAD_SESSION_NOT_FOUND;
  readonly i18nError: ReturnType<typeof createI18nError>;
  readonly uploadSessionId: string;

  constructor(uploadSessionId: string) {
    super(`找不到 staging session：${uploadSessionId}`);
    this.name = "UploadSessionNotFoundError";
    this.uploadSessionId = uploadSessionId;
    this.i18nError = createI18nError(I18N_KEY_UPLOAD_SESSION_NOT_FOUND, {
      uploadSessionId,
    });
  }
}
