/**
 * baseBranchDecider
 *
 * BranchDecider 的 template method 實作，三家 provider 共用此 base class。
 * 差異只在 connection 帶入的 provider / model，流程完全相同。
 *
 * 流程：
 * 1. recentMessages 為空 → 直接回傳 None，不發 model call
 * 2. 組 prompt（branchPromptBuilder）
 * 3. 呼叫 executeDisposableChat
 * 4. parseBranchDecision；失敗則重試一次（第二次仍失敗 → fallback None）
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
  BranchDecisionInput,
  BranchDecisionOutput,
} from "./branchDecider.js";

// ─── Abort 檢查 helper ────────────────────────────────────────────────────────

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new BranchAbortError();
  }
}

// ─── 實作 ─────────────────────────────────────────────────────────────────────

export class BaseBranchDecider implements BranchDecider {
  async decide(input: BranchDecisionInput): Promise<BranchDecisionOutput> {
    const {
      sourcePodName,
      branches,
      recentMessages,
      provider,
      model,
      workspacePath,
      abortSignal,
    } = input;

    if (recentMessages.length === 0) {
      return { selectedLabel: "None" };
    }

    checkAbort(abortSignal);

    const systemPrompt = branchPromptBuilder.buildSystemPrompt();
    const userMessage = branchPromptBuilder.buildUserPrompt({
      sourcePodName,
      recentMessages,
      branches,
    });

    // validLabels：所有 branch 的 label（parseBranchDecision 內部另外允許 "None"）
    const validLabels = branches.map((b) => b.label);

    let rawResponse: string | null = null;
    try {
      const result = await executeDisposableChat({
        provider,
        model,
        systemPrompt,
        userMessage,
        workspacePath,
      });
      rawResponse = result.content;
    } catch (err) {
      // AbortError：中止訊號觸發，直接向上拋出（不走 fallback）
      if (isAbortError(err)) {
        throw err;
      }
      // 第三方服務呼叫失敗視同 PARSE_FAIL，走重試邏輯
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
        return { selectedLabel: parsed.selectedLabel };
      }

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
      });
      retryRawResponse = retryResult.content;
    } catch (err) {
      // AbortError：中止訊號觸發，直接向上拋出（不走 fallback）
      if (isAbortError(err)) {
        throw err;
      }
      logger.warn(
        "Workflow",
        "Warn",
        `[BaseBranchDecider] 第二次 executeDisposableChat 發生例外：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (retryRawResponse !== null) {
      const retryParsed = parseBranchDecision(retryRawResponse, validLabels);
      if (retryParsed.ok) {
        return { selectedLabel: retryParsed.selectedLabel };
      }

      logger.warn(
        "Workflow",
        "Warn",
        `[BaseBranchDecider] 重試後仍解析失敗（原因：${retryParsed.reason}），fallback 為 None`,
      );
    } else {
      logger.warn(
        "Workflow",
        "Warn",
        "[BaseBranchDecider] 兩次呼叫均失敗，fallback 為 None",
      );
    }

    return { selectedLabel: "None" };
  }
}
