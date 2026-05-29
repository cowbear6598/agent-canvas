/**
 * Claude Session 重試模組。
 *
 * 包裝 runClaudeQuery，處理 resume session 失敗後的自動重試邏輯：
 *   1. 第一次嘗試帶 resumeSessionId 執行
 *   2. 若串流中途收到 provider 明確標記的 session resume 可恢復錯誤，清掉 resumeSessionId 後重試一次
 *   3. 最多重試一次，避免無限重試
 *
 * 對應 claudeService.executeWithSessionRetry / shouldRetrySession / handleSendMessageError 的邏輯。
 *
 * 注意：session 持久化（podStore.setSessionId / podStore.resetClaudeSession）
 * 由 executor 端透過 session_started NormalizedEvent 完成，本模組不直接寫 DB。
 */

import { getErrorMessage, isAbortError } from "../../../utils/errorHelpers.js";
import { logger } from "../../../utils/logger.js";
import {
  buildProviderSystemError,
  type ChatRequestContext,
  type NormalizedEvent,
} from "../types.js";
import type { ClaudeOptions } from "./buildClaudeOptions.js";
import { runClaudeQuery } from "./runClaudeQuery.js";

// ─── shouldRetrySession ──────────────────────────────────────────────────────

const SESSION_RESUME_FAILURE_CODE = "SESSION_RESUME_FAILED";

function buildClaudeWrapperError(params: {
  content: string;
  code: string;
  rawContent: string;
}): Extract<NormalizedEvent, { type: "error" }> {
  return buildProviderSystemError("claude", {
    ...params,
    fatal: true,
    recovery: "unrecoverable",
  });
}

/**
 * 判斷是否應該重試 session。
 * - 已是重試 → false（避免無限重試）
 * - 無 resumeSessionId → false（新對話無需重試）
 * - 只有 provider 明確標記為可恢復的 session resume 失敗才重試
 */
function shouldRetrySession(
  event: Extract<NormalizedEvent, { type: "error" }>,
  resumeSessionId: string | null,
  isRetry: boolean,
): boolean {
  if (isRetry) return false;
  if (!resumeSessionId) return false;
  return (
    event.fatal &&
    event.recovery === "recoverable" &&
    event.code === SESSION_RESUME_FAILURE_CODE
  );
}

// ─── withSessionRetry ────────────────────────────────────────────────────────

/**
 * 以 Session 重試邏輯包裝 runClaudeQuery。
 *
 * 若第一次執行因 provider 明確標記的 session resume 失敗，
 * 則清除 resumeSessionId 後重跑一次 runClaudeQuery。
 *
 * 語意：
 *   - Run mode（ctx 帶 runContext）：不清 pod 全域 session（由呼叫方處理）
 *   - Normal mode：executor 端在 for-await loop 捕捉到 error 後需清 pod session；
 *     本模組只負責重試，session 持久化仍交給 executor
 *
 * 重試機制：
 *   - 發生可恢復的 session resume 錯誤事件 → 停止第一次串流 → 清 resumeSessionId 重跑
 *   - 重試最多一次（isRetry=true 後 shouldRetrySession 回 false）
 */
export async function* withSessionRetry(
  ctx: ChatRequestContext<ClaudeOptions>,
): AsyncIterable<NormalizedEvent> {
  const { podId } = ctx;
  let shouldRetryFromFatalEvent = false;

  // 嘗試第一次執行
  try {
    for await (const event of runClaudeQuery(ctx)) {
      if (
        event.type === "error" &&
        shouldRetrySession(event, ctx.resumeSessionId, false)
      ) {
        logger.log(
          "Chat",
          "Update",
          `[withSessionRetry] Pod ${podId} Session 恢復失敗，清除 resumeSessionId 並重試：${event.message}`,
        );
        shouldRetryFromFatalEvent = true;
        break;
      }

      yield event;
    }
    if (!shouldRetryFromFatalEvent) {
      // 第一次成功，直接結束
      return;
    }
  } catch (error) {
    // AbortError：正常中止，向上拋出
    if (isAbortError(error)) {
      throw error;
    }

    const message = getErrorMessage(error);
    logger.error(
      "Chat",
      "Error",
      `[withSessionRetry] Pod ${podId} 查詢失敗：${message}`,
    );
    yield buildClaudeWrapperError({
      content: "Claude 查詢失敗，請稍後再試。",
      code: "QUERY_FAILED",
      rawContent: message,
    });
    return;
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
    yield buildClaudeWrapperError({
      content: "Claude 重試後仍失敗，請稍後再試。",
      code: "QUERY_RETRY_FAILED",
      rawContent: message,
    });
  }
}
