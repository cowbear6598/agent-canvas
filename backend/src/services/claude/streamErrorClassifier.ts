import {
  InvalidWorkspaceError,
  ProviderNotFoundError,
} from "../../utils/errorHelpers.js";

/**
 * 嘗試將錯誤對應到具體的 WebSocket 錯誤碼、i18n key，以及對外顯示的固定中文訊息。
 *
 * - InvalidWorkspaceError（路徑穿越 / 工作目錄非法）→ { code: "INVALID_PATH", ... }
 * - ProviderNotFoundError（Provider 不存在 / buildOptions 失敗）→ { code: "PROVIDER_NOT_FOUND", ... }
 * - 其他無法分類的錯誤 → null（由呼叫端決定如何處理）
 *
 * content 為對外顯示的固定中文訊息，不透傳 error.message 以避免洩漏內部細節。
 * 改用 instanceof 而非硬編碼字串比對，避免訊息修改導致分類失效。
 */
export function classifyKnownError(error: unknown): {
  code: string;
  i18nKey: string;
  /** 對外顯示的固定中文訊息，不含原始 error.message */
  content: string;
} | null {
  if (error instanceof InvalidWorkspaceError) {
    return {
      code: "INVALID_PATH",
      i18nKey: "errors.invalidWorkspacePath",
      content: "工作目錄路徑無效或存取遭拒，請確認 Pod 設定後重試。",
    };
  }
  if (error instanceof ProviderNotFoundError) {
    return {
      code: "PROVIDER_NOT_FOUND",
      i18nKey: "errors.providerNotFound",
      content: "找不到對應的 AI Provider，請確認 Pod 設定後重試。",
    };
  }
  return null;
}
