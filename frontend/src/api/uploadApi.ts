import { getApiBaseUrl } from "@/services/utils";

/** 上傳進度事件 */
export interface UploadProgressEvent {
  /** 已上傳 bytes */
  loaded: number;
  /** 檔案總 bytes */
  total: number;
}

/** 前端或後端回傳的錯誤代碼聯集 */
export type UploadFailureReason =
  | "network"
  | "aborted"
  | "unknown"
  | "UPLOAD_NO_FILE"
  | "UPLOAD_INVALID_SESSION_ID"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_INVALID_NAME"
  | "ATTACHMENT_WRITE_FAILED"
  | "ATTACHMENT_DISK_FULL"
  | "ATTACHMENT_INVALID_ARCHIVE"
  | "ATTACHMENT_ARCHIVE_TOO_LARGE";

/** 上傳失敗的自訂錯誤類別 */
export class UploadError extends Error {
  /** 錯誤原因代碼 */
  readonly reason: UploadFailureReason;
  /** HTTP 狀態碼（僅後端回應時有值） */
  readonly httpStatus?: number;

  constructor(reason: UploadFailureReason, httpStatus?: number) {
    super(
      `上傳失敗：${reason}${httpStatus !== undefined ? `（HTTP ${httpStatus}）` : ""}`,
    );
    this.name = "UploadError";
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

/** 上傳成功的回傳值 */
export interface UploadResult {
  filename: string;
  size: number;
  mime: string;
}

/**
 * 上傳檔案至後端
 * - 使用 XMLHttpRequest 以取得真實的上傳進度（fetch 不支援 upload progress）
 * - multipart/form-data 包含 `file` 與 `uploadSessionId` 兩個 field
 *
 * @param file           要上傳的檔案
 * @param uploadSessionId 上傳 session ID
 * @param onProgress     上傳進度回呼
 * @returns              上傳成功後的檔案資訊
 */
export function uploadFile(
  file: File,
  canvasId: string,
  uploadSessionId: string,
  onProgress: (e: UploadProgressEvent) => void,
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const baseUrl = getApiBaseUrl();
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event: ProgressEvent): void => {
      if (event.lengthComputable) {
        onProgress({ loaded: event.loaded, total: event.total });
      }
    };

    xhr.onload = (): void => {
      const status = xhr.status;

      if (status >= 200 && status < 300) {
        try {
          const result = JSON.parse(xhr.responseText) as UploadResult;
          resolve(result);
        } catch {
          reject(new UploadError("unknown", status));
        }
        return;
      }

      try {
        const body = JSON.parse(xhr.responseText) as {
          errorCode?: string;
          message?: string;
        };
        const errorCode = body?.errorCode;
        if (typeof errorCode === "string" && errorCode.length > 0) {
          reject(new UploadError(errorCode as UploadFailureReason, status));
        } else {
          reject(new UploadError("unknown", status));
        }
      } catch {
        // 解析失敗，fallback 為 unknown
        reject(new UploadError("unknown", status));
      }
    };

    xhr.onerror = (): void => {
      reject(new UploadError("network"));
    };

    xhr.onabort = (): void => {
      reject(new UploadError("aborted"));
    };

    const formData = new FormData();
    formData.append("file", file);
    formData.append("canvasId", canvasId);
    formData.append("uploadSessionId", uploadSessionId);

    xhr.open("POST", `${baseUrl}/api/upload`);
    xhr.send(formData);
  });
}
