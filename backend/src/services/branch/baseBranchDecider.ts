/**
 * baseBranchDecider
 *
 * BranchDecider 的 template method 實作，三家 provider 共用此 base class。
 * 差異只在 connection 帶入的 provider / model，流程完全相同。
 *
 * 流程：
 * 1. recentMessages 與 persistedSummary 皆為空 → 選擇第一個 branch label，不發 model call
 * 2. 組 prompt（branchPromptBuilder）
 * 3. 呼叫 executeDisposableChat
 * 4. parseBranchDecision；失敗則重試一次（第二次仍失敗 → 回傳結構化失敗）
 * 5. 全程於關鍵點檢查 abortSignal
 */

import { branchPromptBuilder } from "../workflow/branchPromptBuilder.js";
import { executeDisposableChat } from "../disposableChatService.js";
import { parseBranchDecision } from "./branchDecisionParser.js";
import { logger } from "../../utils/logger.js";
import { isAbortError } from "../../utils/errorHelpers.js";
import { BranchAbortError } from "./abortError.js";
import type {
  BranchDecider,
  BranchDecisionFailure,
  BranchDecisionFailureAttempt,
  BranchDecisionInput,
  BranchDecisionOutput,
} from "./branchDecider.js";

// ─── Abort 檢查 helper ────────────────────────────────────────────────────────

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new BranchAbortError();
  }
}

function buildFailure(
  attempts: BranchDecisionFailureAttempt[],
): BranchDecisionFailure {
  const kinds = new Set(attempts.map((attempt) => attempt.kind));
  const lastAttempt = attempts[attempts.length - 1];

  return {
    kind:
      kinds.size === 1
        ? (attempts[0]?.kind ?? "provider_error")
        : "mixed",
    message: lastAttempt?.message ?? "Branch 決策失敗",
    attempts,
  };
}

// ─── 實作 ─────────────────────────────────────────────────────────────────────

export class BaseBranchDecider implements BranchDecider {
  async decide(input: BranchDecisionInput): Promise<BranchDecisionOutput> {
    const {
      sourcePodName,
      sourcePod,
      branches,
      persistedSummary,
      recentMessages,
      provider,
      model,
      thinkingLevel,
      workspacePath,
      runContext,
      abortSignal,
    } = input;

    checkAbort(abortSignal);

    const validLabels = branches.map((b) => b.label);

    if (recentMessages.length === 0 && !persistedSummary) {
      const selectedLabel = validLabels[0];

      if (selectedLabel) {
        return { kind: "success", selectedLabel };
      }

      return {
        kind: "failed",
        failure: buildFailure([
          {
            attempt: 1,
            kind: "parse_error",
            message: "找不到可選擇的 branch label",
          },
        ]),
      };
    }

    const systemPrompt = branchPromptBuilder.buildSystemPrompt();
    const userMessage = branchPromptBuilder.buildUserPrompt({
      sourcePodName,
      persistedSummary,
      recentMessages,
      branches,
    });

    const failureAttempts: BranchDecisionFailureAttempt[] = [];
    let rawResponse: string | null = null;
    try {
      const result = await executeDisposableChat({
        provider,
        model,
        systemPrompt,
        userMessage,
        workspacePath,
        sourcePod,
        runContext,
        thinkingLevel,
      });
      if (result.success) {
        rawResponse = result.content;
      } else {
        failureAttempts.push({
          attempt: 1,
          kind: "provider_error",
          message: result.error ?? "第一次模型呼叫失敗",
        });
        logger.warn(
          "Workflow",
          "Warn",
          `[BaseBranchDecider] 第一次 executeDisposableChat 失敗，將進行重試：${result.error ?? "未知錯誤"}`,
        );
      }
    } catch (err) {
      // AbortError：中止訊號觸發，直接向上拋出（不走 fallback）
      if (isAbortError(err)) {
        throw err;
      }
      failureAttempts.push({
        attempt: 1,
        kind: "provider_error",
        message: err instanceof Error ? err.message : String(err),
      });
      logger.warn(
        "Workflow",
        "Warn",
        `[BaseBranchDecider] 第一次 executeDisposableChat 發生例外，將進行重試：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    checkAbort(abortSignal);

    if (rawResponse !== null) {
      const parsed = parseBranchDecision(rawResponse, validLabels);
      if (parsed.ok) {
        return { kind: "success", selectedLabel: parsed.selectedLabel };
      }

      failureAttempts.push({
        attempt: 1,
        kind: "parse_error",
        message: parsed.reason,
      });

      logger.warn(
        "Workflow",
        "Warn",
        `[BaseBranchDecider] 第一次解析失敗（原因：${parsed.reason}），進行重試`,
      );
    }

    checkAbort(abortSignal);

    let retryRawResponse: string | null = null;
    try {
      const retryResult = await executeDisposableChat({
        provider,
        model,
        systemPrompt,
        userMessage,
        workspacePath,
        sourcePod,
        runContext,
        thinkingLevel,
      });
      if (retryResult.success) {
        retryRawResponse = retryResult.content;
      } else {
        failureAttempts.push({
          attempt: 2,
          kind: "provider_error",
          message: retryResult.error ?? "第二次模型呼叫失敗",
        });
        logger.warn(
          "Workflow",
          "Warn",
          `[BaseBranchDecider] 第二次 executeDisposableChat 失敗：${retryResult.error ?? "未知錯誤"}`,
        );
      }
    } catch (err) {
      // AbortError：中止訊號觸發，直接向上拋出（不走 fallback）
      if (isAbortError(err)) {
        throw err;
      }
      failureAttempts.push({
        attempt: 2,
        kind: "provider_error",
        message: err instanceof Error ? err.message : String(err),
      });
      logger.warn(
        "Workflow",
        "Warn",
        `[BaseBranchDecider] 第二次 executeDisposableChat 發生例外：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (retryRawResponse !== null) {
      const retryParsed = parseBranchDecision(retryRawResponse, validLabels);
      if (retryParsed.ok) {
        return { kind: "success", selectedLabel: retryParsed.selectedLabel };
      }

      failureAttempts.push({
        attempt: 2,
        kind: "parse_error",
        message: retryParsed.reason,
      });

      logger.warn(
        "Workflow",
        "Warn",
        `[BaseBranchDecider] 重試後仍解析失敗（原因：${retryParsed.reason}），回傳結構化失敗`,
      );
    } else {
      logger.warn(
        "Workflow",
        "Warn",
        "[BaseBranchDecider] 兩次呼叫均失敗，回傳結構化失敗",
      );
    }

    return {
      kind: "failed",
      failure: buildFailure(failureAttempts),
    };
  }
}
