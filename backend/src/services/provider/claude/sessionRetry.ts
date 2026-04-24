/**
 * Claude Session 重試模組。
 *
 * 包裝 runClaudeQuery，處理 resume session 失敗後的自動重試邏輯：
 *   1. 第一次嘗試帶 resumeSessionId 執行
 *   2. 若串流中途發生錯誤且錯誤訊息含 session/resume 關鍵字，清掉 resumeSessionId 後重試一次
 *   3. 最多重試一次，避免無限重試
 *
 * 對應 claudeService.executeWithSessionRetry / shouldRetrySession / handleSendMessageError 的邏輯。
 *
 * 注意：session 持久化（podStore.setSessionId / podStore.resetClaudeSession）
 * 由 executor 端透過 session_started NormalizedEvent 完成，本模組不直接寫 DB。
 */

import { getErrorMessage, isAbortError } from "../../../utils/errorHelpers.js";
import { logger } from "../../../utils/logger.js";
import type { NormalizedEvent, ChatRequestContext } from "../types.js";
import type { ClaudeOptions } from "./buildClaudeOptions.js";
import { runClaudeQuery } from "./runClaudeQuery.js";

// ─── shouldRetrySession ──────────────────────────────────────────────────────

/** 判斷是否為 session resume 相關的錯誤（沿用 claudeService 的判斷邏輯） */
const SESSION_RESUME_ERROR_KEYWORDS = ["session", "resume"] as const;

function isSessionResumeError(errorMessage: string): boolean {
  return SESSION_RESUME_ERROR_KEYWORDS.some((keyword) =>
    errorMessage.includes(keyword),
  );
}

/**
 * 判斷是否應該重試 session。
 * - 已是重試 → false（避免無限重試）
 * - 無 resumeSessionId → false（新對話無需重試）
 * - 錯誤訊息含 session/resume 關鍵字 → true
 */
function shouldRetrySession(
  error: unknown,
  resumeSessionId: string | null,
  isRetry: boolean,
): boolean {
  if (isRetry) return false;
  if (!resumeSessionId) return false;
  const errorMessage = getErrorMessage(error);
  return isSessionResumeError(errorMessage);
}

// ─── withSessionRetry ────────────────────────────────────────────────────────

/**
 * 以 Session 重試邏輯包裝 runClaudeQuery。
 *
 * 若第一次執行因 session resume 失敗（errorMessage 含 session/resume 關鍵字），
 * 則清除 resumeSessionId 後重跑一次 runClaudeQuery。
 *
 * 語意：
 *   - Run mode（ctx 帶 runContext）：不清 pod 全域 session（由呼叫方處理）
 *   - Normal mode：executor 端在 for-await loop 捕捉到 error 後需清 pod session；
 *     本模組只負責重試，session 持久化仍交給 executor
 *
 * 重試機制：
 *   - 發生 session resume 錯誤 → 產出 error event → 停止第一次串流 → 清 resumeSessionId 重跑
 *   - 重試最多一次（isRetry=true 後 shouldRetrySession 回 false）
 */
export async function* withSessionRetry(
  ctx: ChatRequestContext<ClaudeOptions>,
): AsyncIterable<NormalizedEvent> {
  const { podId } = ctx;

  // 嘗試第一次執行
  try {
    yield* runClaudeQuery(ctx);
    // 第一次成功，直接結束
    return;
  } catch (error) {
    // AbortError：正常中止，向上拋出
    if (isAbortError(error)) {
      throw error;
    }

    // 判斷是否應重試 session
    if (!shouldRetrySession(error, ctx.resumeSessionId, false)) {
      // 非 session 相關錯誤：送出 error event 後終止
      const message = getErrorMessage(error);
      logger.error(
        "Chat",
        "Error",
        `[withSessionRetry] Pod ${podId} 查詢失敗（非 session 錯誤）：${message}`,
      );
      yield { type: "error", message, fatal: true };
      return;
    }

    // Session resume 失敗：log 並重試（清除 resumeSessionId）
    const message = getErrorMessage(error);
    logger.log(
      "Chat",
      "Update",
      `[withSessionRetry] Pod ${podId} Session 恢復失敗，清除 resumeSessionId 並重試：${message}`,
    );
  }

  // 第二次嘗試：清掉 resumeSessionId
  const retryCtx: ChatRequestContext<ClaudeOptions> = {
    ...ctx,
    resumeSessionId: null,
  };

  try {
    yield* runClaudeQuery(retryCtx);
  } catch (error) {
    // AbortError：正常中止，向上拋出
    if (isAbortError(error)) {
      throw error;
    }

    // 重試後仍失敗：送出 error event 終止
    const message = getErrorMessage(error);
    logger.error(
      "Chat",
      "Error",
      `[withSessionRetry] Pod ${podId} 重試後仍失敗：${message}`,
    );
    yield { type: "error", message, fatal: true };
  }
}
