/**
 * uploadConstants — HTTP 與 WebSocket 上傳共用常數（single source of truth）。
 *
 * 此檔案是所有上傳限制的單一事實來源，HTTP 路由與 WS handler 皆應從此處 import，
 * 避免兩處各自維護導致不一致。
 */

/** 單一上傳檔案上限：100 MB */
export const MAX_SINGLE_BYTES = 100 * 1024 * 1024;

/** ZIP 解壓後所有檔案的總大小上限：100 MB */
export const MAX_ZIP_EXTRACTED_BYTES = MAX_SINGLE_BYTES;

/** ZIP 內最多允許的項目數，避免大量小檔案耗盡系統資源 */
export const MAX_ZIP_ENTRY_COUNT = 10_000;

/**
 * uploadSessionId（UUID v4）驗證正則。
 * 格式：xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
 */
export const UPLOAD_SESSION_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
