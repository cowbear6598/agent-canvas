import { buildProviderSystemError } from "./types.js";
import type { NormalizedEvent, ProviderErrorRecovery } from "./types.js";

/** opencode provider 專用的系統錯誤建立 helper */
export function buildOpencodeSystemError(params: {
  content: string;
  fatal: boolean;
  code: string;
  rawContent?: string;
  recovery?: ProviderErrorRecovery;
}): Extract<NormalizedEvent, { type: "error" }> {
  return buildProviderSystemError("opencode", params);
}

/**
 * 依 session.error 訊息分類錯誤碼與使用者訊息。
 *
 * - "No auth credentials found" / "API key" → opencode_auth_missing
 * - "connection refused" / "fetch failed" / "ECONNREFUSED" → opencode_server_unreachable
 * - 其他 → opencode_session_failed
 */
export function classifySessionError(
  rawMessage: string,
  providerID: string,
): Extract<NormalizedEvent, { type: "error" }> {
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes("no auth credentials found") ||
    lower.includes("api key")
  ) {
    return buildOpencodeSystemError({
      content: `請在 terminal 執行 \`opencode auth login ${providerID}\` 後再試一次`,
      fatal: true,
      code: "opencode_auth_missing",
      recovery: "unrecoverable",
    });
  }

  if (
    lower.includes("connection refused") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused")
  ) {
    return buildOpencodeSystemError({
      content: "opencode server 連線失敗，請重啟後端",
      fatal: true,
      code: "opencode_server_unreachable",
      recovery: "unrecoverable",
    });
  }

  return buildOpencodeSystemError({
    content: "opencode session 發生錯誤，請稍後再試",
    fatal: false,
    code: "opencode_session_failed",
    recovery: "recoverable",
  });
}

/**
 * 從 session.error event 的 error 物件取出字串訊息。
 *
 * ProviderAuthError / ApiError / UnknownError / MessageAbortedError 都有 data.message，
 * fallback 到 obj.message，最後 fallback 到 JSON.stringify。
 */
export function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "未知錯誤");
  const obj = error as Record<string, unknown>;

  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.message === "string") return data.message;
  }

  if (typeof obj.message === "string") return obj.message;
  return JSON.stringify(error);
}
