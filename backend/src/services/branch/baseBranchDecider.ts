/**
 * baseBranchDecider
 *
 * BranchDecider 的 template method 實作，三家 provider 共用此 base class。
 * 差異只在 connection 帶入的 provider / model，流程完全相同。
 *
 * 流程：
 * 1. recentMessages 與 persistedSummary 皆為空 → fail closed，不自動選 branch
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

function pickFallbackLabel(labels: string[]): string {
  const fallbackLabel = labels[0];
  if (!fallbackLabel) {
    throw new Error("[BaseBranchDecider] 找不到可用的 fallback branch label");
  }
  return fallbackLabel;
}

type BranchDecisionAttemptNumber = 1 | 2;

interface BranchDecisionAttemptContext {
  input: BranchDecisionInput;
  systemPrompt: string;
  userMessage: string;
  validLabels: string[];
  fallbackLabel: string;
  failures: BranchDecisionFailureAttempt[];
}

interface BranchDecisionAttemptResult {
  decision: BranchDecisionOutput | null;
  receivedResponse: boolean;
}

function logProviderFailure(
  attempt: BranchDecisionAttemptNumber,
  message: string,
  thrown: boolean,
): void {
  const ordinal = attempt === 1 ? "第一次" : "第二次";
  const action = thrown ? "發生例外" : "失敗";
  const retrySuffix = attempt === 1 ? "，將進行重試" : "";
  logger.warn(
    "Workflow",
    "Warn",
    `[BaseBranchDecider] ${ordinal} executeDisposableChat ${action}${retrySuffix}：${message}`,
  );
}

function resolveParsedDecision(
  rawResponse: string,
  attempt: BranchDecisionAttemptNumber,
  context: BranchDecisionAttemptContext,
): BranchDecisionOutput | null {
  const parsed = parseBranchDecision(rawResponse, context.validLabels);
  if (parsed.ok) {
    if (!parsed.noSelection) {
      return { kind: "success", selectedLabel: parsed.selectedLabel };
    }

    const message =
      attempt === 1
        ? "模型回傳不選擇 branch"
        : "重試後仍未選擇 branch";
    logger.warn(
      "Workflow",
      "Warn",
      `[BaseBranchDecider] ${message}，改用第一條 branch fallback：${context.fallbackLabel}`,
    );
    return { kind: "success", selectedLabel: context.fallbackLabel };
  }

  context.failures.push({
    attempt,
    kind: "parse_error",
    message: parsed.reason,
  });
  const action = attempt === 1 ? "進行重試" : "回傳結構化失敗";
  const prefix = attempt === 1 ? "第一次解析失敗" : "重試後仍解析失敗";
  logger.warn(
    "Workflow",
    "Warn",
    `[BaseBranchDecider] ${prefix}（原因：${parsed.reason}），${action}`,
  );
  return null;
}

async function executeBranchDecisionAttempt(
  attempt: BranchDecisionAttemptNumber,
  context: BranchDecisionAttemptContext,
): Promise<BranchDecisionAttemptResult> {
  const { input } = context;
  let rawResponse: string | null = null;

  try {
    const result = await executeDisposableChat({
      provider: input.provider,
      model: input.model,
      systemPrompt: context.systemPrompt,
      userMessage: context.userMessage,
      workspacePath: input.workspacePath,
      sourcePod: input.sourcePod,
      runContext: input.runContext,
      thinkingLevel: input.thinkingLevel,
    });
    if (result.success) {
      rawResponse = result.content;
    } else {
      const message =
        result.error ??
        (attempt === 1 ? "第一次模型呼叫失敗" : "第二次模型呼叫失敗");
      context.failures.push({ attempt, kind: "provider_error", message });
      logProviderFailure(attempt, result.error ?? "未知錯誤", false);
    }
  } catch (error) {
    if (isAbortError(error)) throw error;

    const message = error instanceof Error ? error.message : String(error);
    context.failures.push({ attempt, kind: "provider_error", message });
    logProviderFailure(attempt, message, true);
  }

  // 第一輪原有的 abort 時點位於 provider 回應後、解析前。
  if (attempt === 1) checkAbort(input.abortSignal);

  return {
    decision:
      rawResponse === null
        ? null
        : resolveParsedDecision(rawResponse, attempt, context),
    receivedResponse: rawResponse !== null,
  };
}

function buildFailedDecision(
  failures: BranchDecisionFailureAttempt[],
): BranchDecisionOutput {
  return {
    kind: "failed",
    failure: {
      kind: failures.every((failure) => failure.kind === "parse_error")
        ? "parse_error"
        : failures.every((failure) => failure.kind === "provider_error")
          ? "provider_error"
          : "mixed",
      message: failures.at(-1)?.message ?? "Branch 決策失敗",
      attempts: failures,
    },
  };
}

// ─── 實作 ─────────────────────────────────────────────────────────────────────

export class BaseBranchDecider implements BranchDecider {
  async decide(input: BranchDecisionInput): Promise<BranchDecisionOutput> {
    const {
      sourcePodName,
      branches,
      persistedSummary,
      recentMessages,
      abortSignal,
    } = input;

    checkAbort(abortSignal);

    const validLabels = branches.map((b) => b.label);
    const fallbackLabel = pickFallbackLabel(validLabels);

    if (recentMessages.length === 0 && !persistedSummary) {
      logger.warn(
        "Workflow",
        "Warn",
        `[BaseBranchDecider] 缺少可判斷 branch 的上下文，改用第一條 branch fallback：${fallbackLabel}`,
      );
      return { kind: "success", selectedLabel: fallbackLabel };
    }

    const systemPrompt = branchPromptBuilder.buildSystemPrompt();
    const userMessage = branchPromptBuilder.buildUserPrompt({
      sourcePodName,
      persistedSummary,
      recentMessages,
      branches,
    });

    const context: BranchDecisionAttemptContext = {
      input,
      systemPrompt,
      userMessage,
      validLabels,
      fallbackLabel,
      failures: [],
    };
    const firstAttempt = await executeBranchDecisionAttempt(1, context);
    if (firstAttempt.decision) return firstAttempt.decision;

    checkAbort(abortSignal);

    const secondAttempt = await executeBranchDecisionAttempt(2, context);
    if (secondAttempt.decision) return secondAttempt.decision;

    if (!secondAttempt.receivedResponse) {
      logger.warn(
        "Workflow",
        "Warn",
        "[BaseBranchDecider] 兩次呼叫均失敗，回傳結構化失敗",
      );
    }

    return buildFailedDecision(context.failures);
  }
}
