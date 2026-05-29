import { v4 as uuidv4 } from "uuid";

import { isAbortError } from "../../utils/errorHelpers.js";
import { classifyKnownError } from "./streamErrorClassifier.js";
import type { ContentBlock } from "../../types";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";

import { abortRegistry } from "../provider/abortRegistry.js";
import {
  createStreamingLifecycleCoordinator,
  type StreamingLifecycleCoordinator,
} from "./streamingLifecycleCoordinator.js";
import { podStore } from "../podStore.js";
import { logger } from "../../utils/logger.js";
import type { ChatExecutionStrategy } from "../executionStrategy.js";
import { getProvider } from "../provider/index.js";
import type {
  AgentProvider,
  ChatRequestContext,
} from "../provider/types.js";
import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/index.js";
import { createI18nError } from "../../utils/i18nError.js";
import { resolveExecutionPaths } from "../runtime/executionPaths.js";
import { runExecutionService } from "../workflow/runExecutionService.js";
import {
  ensureGoalRuntime,
  getGoalRuntimeStatePath,
  readGoalRuntimeSnapshot,
} from "../goalRuntime.js";
import {
  autoForceBlock,
  evaluateGoalGate,
  GOAL_GATE_LIMITS,
  nextNoProgressCount,
} from "../goalCompletionGate.js";
import { runStore } from "../runStore.js";

export interface GoalRoundDividerContext {
  sourcePodIds: string[];
  sourcePodNames: string[];
  connectionIds: string[];
}

export interface StreamingChatExecutorOptions {
  canvasId: string;
  podId: string;
  /**
   * 已展開後的訊息內容（含 Command `<command>` 標籤，若有）。
   * 契約：caller 必須在進入 executor 前自行完成 Command 展開，executor 不再做展開。
   * 六條 caller 路徑（chatHandlers / runChatHelpers / scheduleService / workflowExecutionService /
   * integrationEventPipeline / workflowApi）皆於上游呼叫 tryExpandCommandMessage 後再傳入。
   */
  message: string | ContentBlock[];
  abortable: boolean;
  strategy: ChatExecutionStrategy;
  goalRoundDivider?: GoalRoundDividerContext;
}

export interface StreamingChatExecutorCallbacks {
  onComplete?: (canvasId: string, podId: string) => void | Promise<void>;
  onError?: (
    canvasId: string,
    podId: string,
    error: Error,
  ) => void | Promise<void>;
  onAborted?: (
    canvasId: string,
    podId: string,
    messageId: string,
  ) => void | Promise<void>;
}

export interface StreamingChatExecutorResult {
  messageId: string;
  content: string;
  hasContent: boolean;
  aborted: boolean;
}

/**
 * 串流節流窗口（ms）。
 * 串流期間僅做粗粒度 checkpoint，最終完成態仍會強制 flush。
 * 這裡刻意把 SQLite 寫入節奏放慢，避免長 workflow 在多 pod 並行時持續高頻打 DB。
 */
const THROTTLE_MS = 2000;

async function handleStreamAbort(
  lifecycle: StreamingLifecycleCoordinator,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  lifecycle.abortStream("使用者中斷執行");

  if (callbacks?.onAborted) {
    await callbacks.onAborted(
      lifecycle.canvasId,
      lifecycle.podId,
      lifecycle.messageId,
    );
  }

  return {
    messageId: lifecycle.messageId,
    content: lifecycle.streamState.accumulatedContent,
    hasContent: lifecycle.hasAssistantContent(),
    aborted: true,
  };
}

async function handleStreamError(
  lifecycle: StreamingLifecycleCoordinator,
  error: unknown,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  const classified = classifyKnownError(error);

  if (classified) {
    // 已知的業務錯誤（路徑穿越、Provider 不可用）：發送具體錯誤給前端，不再拋出
    lifecycle.errorStream();

    // 原始 error.message 只進 logger，不洩漏給前端
    logger.error(
      "Chat",
      "Error",
      `[handleStreamError] 已知業務錯誤（podId=${lifecycle.podId}, canvasId=${lifecycle.canvasId}, code=${classified.code}）：${error instanceof Error ? error.message : String(error)}`,
    );

    lifecycle.appendSystemMessage({
      // 對外顯示固定中文訊息，不含 error.message 以避免洩漏內部細節
      content: classified.content,
      metadata: {
        provider: lifecycle.providerName,
        code: classified.code,
        severity: "fatal",
        // rawContent 僅供內部除錯用，不顯示於前端 UI
        rawContent: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      messageId: lifecycle.messageId,
      content: lifecycle.streamState.accumulatedContent,
      hasContent: lifecycle.hasAssistantContent(),
      aborted: false,
    };
  }

  // 未分類錯誤（串流中斷、AbortError、其他預期外錯誤）：維持既有行為，向上拋出
  lifecycle.errorStream();

  if (callbacks?.onError) {
    await callbacks.onError(
      lifecycle.canvasId,
      lifecycle.podId,
      error as Error,
    );
  }

  throw error;
}

/**
 * 統一處理串流執行過程中的錯誤：依錯誤類型分流處理。
 */
async function handleExecutionError(
  error: unknown,
  lifecycle: StreamingLifecycleCoordinator,
  abortable: boolean,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  if (isAbortError(error) && abortable) {
    return handleStreamAbort(lifecycle, callbacks);
  }

  return handleStreamError(lifecycle, error, callbacks);
}

/**
 * 執行 provider 串流的核心迴圈，並封裝 abort 生命週期管理。
 *
 * 職責：
 *   1. 向 abortRegistry 登記 queryKey，取得 AbortController 並注入 abortSignal 至 ctx
 *   2. for-await 消費 provider.chat(ctx) 的事件，逐一交由 processNormalizedEvent 處理
 *   3. 無論正常或異常結束，finally 保證從 registry 登出（防 Memory Leak）
 *   4. 回傳 { aborted } 表達 abort 是否發生
 *
 * 收斂 abort 判斷說明：
 *   部分 Provider（例如 Codex）的 abort 實作是 proc.kill()，
 *   for-await 以 break 結束而非拋出 AbortError。
 *   若不在此檢查 signal.aborted，呼叫端會誤判為「正常完成」，
 *   走進 lifecycle.finalizeAfterStream 把半成品 sessionId 寫入 DB，導致下次 resume 失敗。
 */
async function runProviderStream(
  provider: AgentProvider,
  ctxWithoutSignal: Omit<ChatRequestContext, "abortSignal">,
  queryKey: string,
  podId: string,
  abortable: boolean,
  lifecycle: StreamingLifecycleCoordinator,
): Promise<{ aborted: boolean }> {
  // abortRegistry 建立 controller，供外部 abort 呼叫（透過 registry 觸發 signal）
  // 同時傳入 podId 以建立二級索引，支援 abortByPodId
  const abortController = abortRegistry.register(queryKey, podId);
  const ctx: ChatRequestContext = {
    ...ctxWithoutSignal,
    abortSignal: abortController.signal,
  };

  try {
    // 消費 provider.chat(ctx) 的 NormalizedEvent 串流（Claude 與 Codex 共用）
    for await (const ev of provider.chat(ctx)) {
      const result = lifecycle.processNormalizedEvent(ev);
      if (result.aborted) {
        // fatal error event：transcript system message 已寫入，
        // 中止迴圈但不 throw，由呼叫端走正常 finalize 收尾。
        break;
      }
    }
  } finally {
    // 無論串流正常或異常結束，都清理 abortRegistry entry 防 Memory Leak
    abortRegistry.unregister(queryKey, podId);
  }

  if (abortController.signal.aborted && abortable) {
    return { aborted: true };
  }
  return { aborted: false };
}

/** resolveExecutionDependencies 回傳的執行所需元件 */
interface ExecutionDependencies {
  provider: AgentProvider;
  queryKey: string;
  ctxWithoutSignal: Omit<ChatRequestContext, "abortSignal">;
}

/**
 * 發送 Pod 不存在的 WebSocket 錯誤事件。
 * 不將 podId 暴露給 client，改記入 server log 供除錯追查。
 */
function emitPodNotFoundError(canvasId: string, podId: string): void {
  logger.error(
    "Chat",
    "Check",
    `[executeStreamingChat] 找不到 Pod（podId=${podId}, canvasId=${canvasId}）`,
  );
  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_ERROR, {
    canvasId,
    podId,
    success: false,
    error: createI18nError("errors.podNotFound", { id: podId }),
    code: "POD_NOT_FOUND",
  });
}

/**
 * 集中「查詢期」邏輯：取 provider → 取 sessionId/queryKey/runContext → 組 ctxWithoutSignal。
 * Pod 已由 executeStreamingChat 確認存在後傳入，此函式只負責組裝執行所需元件。
 * 同時將 provider 名稱寫入 lifecycle，讓後續錯誤 transcript 使用正確 provider metadata。
 * resolveWorkspacePath 與 provider.buildOptions 可能拋出錯誤，由呼叫端的 try-catch 統一交給 handleExecutionError。
 */
async function resolveExecutionDependencies(
  options: StreamingChatExecutorOptions,
  lifecycle: StreamingLifecycleCoordinator,
  pod: Pod,
): Promise<ExecutionDependencies> {
  const { podId, message, strategy } = options;

  const providerName = pod.provider ?? "claude";
  lifecycle.setProviderName(providerName);
  const provider = getProvider(providerName);

  const sessionId = strategy.getSessionId(podId);
  const queryKey = strategy.getQueryKey(podId);
  const runContext = strategy.getRunContext();

  // 解析執行路徑（可能拋出錯誤，由呼叫端 try-catch 統一交給 handleExecutionError）
  const executionPaths = resolveExecutionPaths(pod, runContext);

  // 建構 Provider 執行時選項（可能拋出錯誤，同上）
  const providerOptions = await provider.buildOptions(pod, runContext);

  // 組裝 ChatRequestContext（不含 abortSignal，由 runProviderStream 內部注入）
  const ctxWithoutSignal: Omit<ChatRequestContext, "abortSignal"> = {
    podId,
    podName: pod.name,
    message,
    workspacePath: executionPaths.workspacePath,
    resumeSessionId: sessionId ?? null,
    runContext,
    options: providerOptions,
  };

  return { provider, queryKey, ctxWithoutSignal };
}

/**
 * 單一輪 chat turn 的結果。
 *   - completed：turn 正常結束，可進入 gate 判定
 *   - aborted_or_errored：abort 或 error，已由 handleStreamAbort/handleExecutionError 處理；
 *     呼叫端應直接 return result，不再進 gate loop
 *   - completed_with_recoverable_provider_error：turn 因 fatal provider error 中止，
 *     但 goal gate 仍可根據未完成狀態繼續 retry
 *   - completed_with_unrecoverable_provider_error：turn 因 fatal provider error 中止，
 *     若 goal 尚未完成，必須保留未完成狀態且不可觸發 onComplete
 */
interface ChatTurnOutcome {
  result: StreamingChatExecutorResult;
  finished:
    | "completed"
    | "aborted_or_errored"
    | "completed_with_recoverable_provider_error"
    | "completed_with_unrecoverable_provider_error";
}

const CLIENT_SAFE_BLOCKED_REASON_MAX_LENGTH = 240;
const PENDING_GOAL_UNRECOVERABLE_PROVIDER_ERROR_MESSAGE =
  "Provider 發生不可恢復錯誤，Goal 尚未完成";

function createClientSafeBlockedReason(reason: string | null): string | null {
  const normalized = reason
    ?.trim()
    .replace(/\s+/g, " ")
    .replace(/\/(?:Users|private|tmp|var|etc|opt|home)\/[^\s"'`，。；、)）]+/g, "[路徑已隱藏]")
    .replace(/[A-Za-z]:\\[^\s"'`，。；、)）]+/g, "[路徑已隱藏]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g,
      "[敏感資訊已隱藏]",
    );
  if (!normalized) return null;

  return normalized.length > CLIENT_SAFE_BLOCKED_REASON_MAX_LENGTH
    ? `${normalized.slice(0, CLIENT_SAFE_BLOCKED_REASON_MAX_LENGTH)}...`
    : normalized;
}

function persistGoalRoundDivider(
  options: StreamingChatExecutorOptions,
): void {
  const runContext = options.strategy.getRunContext();
  if (!runContext || !options.goalRoundDivider) return;

  const snapshot = readGoalRuntimeSnapshot(
    getGoalRuntimeStatePath(runContext, options.podId),
  );
  if (!snapshot) return;

  const status = snapshot.state.status;
  if (status !== "completed" && status !== "blocked") return;

  const blockedReason =
    status === "blocked"
      ? createClientSafeBlockedReason(snapshot.state.blockedReason)
      : null;

  const divider = runStore.addRunGoalRoundDivider({
    runId: runContext.runId,
    podId: options.podId,
    sourcePodIds: options.goalRoundDivider.sourcePodIds,
    sourcePodNames: options.goalRoundDivider.sourcePodNames,
    status,
    blockedReason,
    connectionIds: options.goalRoundDivider.connectionIds,
  });
  options.strategy.createEmitStrategy().emitGoalRoundDivider({
    canvasId: options.canvasId,
    divider,
  });
}

function hasPendingGoalRuntime(
  runContext: RunContext | undefined,
  podId: string,
): boolean {
  if (!runContext) return false;

  const snapshot = readGoalRuntimeSnapshot(
    getGoalRuntimeStatePath(runContext, podId),
  );
  if (!snapshot) return false;

  return (
    snapshot.state.status === "running" && snapshot.state.activeTodoId !== null
  );
}

/**
 * 執行單一 chat turn：自行建立 lifecycle coordinator、註冊 stream、跑 provider 串流、收尾。
 * 對 abort / 已知錯誤負責呼叫對應 handler；未知錯誤往上 throw。
 *
 * 每個 retry turn 都會呼叫此 helper 一次，因此每 turn 會有獨立的 messageId
 * 與 transcript 訊息，避免不同輪的內容互相覆寫。
 */
async function executeChatTurn(
  options: StreamingChatExecutorOptions,
  pod: Pod,
  turnMessage: StreamingChatExecutorOptions["message"],
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<ChatTurnOutcome> {
  const turnOptions: StreamingChatExecutorOptions = {
    ...options,
    message: turnMessage,
  };
  const { abortable, strategy, podId } = turnOptions;

  const lifecycle = createStreamingLifecycleCoordinator({
    canvasId: turnOptions.canvasId,
    podId,
    messageId: uuidv4(),
    strategy,
    throttleMs: THROTTLE_MS,
  });

  strategy.onStreamStart(podId);

  try {
    const depsResult = await resolveExecutionDependencies(
      turnOptions,
      lifecycle,
      pod,
    );
    const { provider, queryKey, ctxWithoutSignal } = depsResult;

    const result = await runProviderStream(
      provider,
      ctxWithoutSignal,
      queryKey,
      podId,
      abortable,
      lifecycle,
    );

    if (result.aborted) {
      const abortResult = await handleStreamAbort(lifecycle, callbacks);
      return { result: abortResult, finished: "aborted_or_errored" };
    }

    lifecycle.finalizeAfterStream();

    return {
      result: {
        messageId: lifecycle.messageId,
        content: lifecycle.streamState.accumulatedContent,
        hasContent: lifecycle.hasAssistantContent(),
        aborted: false,
      },
      finished:
        lifecycle.lastFatalProviderErrorRecovery === "recoverable"
          ? "completed_with_recoverable_provider_error"
          : lifecycle.lastFatalProviderErrorRecovery === "unrecoverable"
            ? "completed_with_unrecoverable_provider_error"
            : "completed",
    };
  } catch (error) {
    const handled = await handleExecutionError(
      error,
      lifecycle,
      abortable,
      callbacks,
    );
    return { result: handled, finished: "aborted_or_errored" };
  }
}

/**
 * 統一的串流聊天執行器，透過 ChatExecutionStrategy 管理 Run mode 的執行行為。
 *
 * 流程：
 *   1. 第一輪 turn 帶 caller 傳入的 message
 *   2. 進入 Goal 完成 gate loop：
 *      - proceed → 跳出，呼叫 callbacks.onComplete
 *      - retry   → 透過 strategy.addUserMessage 注入 nudge，再跑一輪
 *      - force_block → 自動標記剩餘 todo 為 blocked 後放行下游
 *   3. abort 或 error 在 turn 內部就已處理；gate loop 不會被執行
 *
 * onComplete callback 只會在 gate 放行後呼叫一次，下游 workflow 觸發以此為準。
 */
export async function executeStreamingChat(
  options: StreamingChatExecutorOptions,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  const { canvasId, podId, strategy } = options;

  const podResult = podStore.getByIdGlobal(podId);
  if (!podResult) {
    emitPodNotFoundError(canvasId, podId);
    return { messageId: "", content: "", hasContent: false, aborted: false };
  }

  const baseRunContext = strategy.getRunContext();
  const effectiveOptions =
    baseRunContext &&
    !baseRunContext.goalRuntimeScopeId &&
    (podResult.pod.goal?.todos.length ?? 0) > 0
      ? {
          ...options,
          strategy: strategy.withGoalRuntimeScope(uuidv4()),
        }
      : options;
  const scopedRunContext = effectiveOptions.strategy.getRunContext();
  if (scopedRunContext?.goalRuntimeScopeId) {
    ensureGoalRuntime(podResult.pod, scopedRunContext);
  }

  // 第一輪 turn：使用 caller 傳入的 message
  let turnOutcome = await executeChatTurn(
    effectiveOptions,
    podResult.pod,
    effectiveOptions.message,
    callbacks,
  );
  if (turnOutcome.finished === "aborted_or_errored") {
    const runContext = effectiveOptions.strategy.getRunContext();
    if (runContext) {
      runExecutionService.unregisterActiveStream(runContext.runId, podId);
    }
    return turnOutcome.result;
  }

  // Goal 完成 gate loop：只有當 runContext 存在且 Goal Runtime 有 active todo 時才會進迴圈
  const runContext = effectiveOptions.strategy.getRunContext();
  let retryCount = 0;
  let noProgressCount = 0;

  while (true) {
    if (!runContext) break;

    if (
      turnOutcome.finished === "completed_with_unrecoverable_provider_error"
    ) {
      if (hasPendingGoalRuntime(runContext, podId)) {
        if (callbacks?.onError) {
          await callbacks.onError(
            canvasId,
            podId,
            new Error(PENDING_GOAL_UNRECOVERABLE_PROVIDER_ERROR_MESSAGE),
          );
        }
        return turnOutcome.result;
      }
      break;
    }

    const decision = evaluateGoalGate(runContext, podId, {
      retryCount,
      noProgressCount,
    });

    if (decision.action === "proceed") break;

    if (decision.action === "force_block") {
      autoForceBlock(runContext, podResult.pod, decision.reason);
      break;
    }

    // decision.action === "retry"
    await effectiveOptions.strategy.addUserMessage(podId, decision.nudgeMessage);
    turnOutcome = await executeChatTurn(
      effectiveOptions,
      podResult.pod,
      decision.nudgeMessage,
      callbacks,
    );
    if (turnOutcome.finished === "aborted_or_errored") {
      return turnOutcome.result;
    }

    noProgressCount = nextNoProgressCount(
      runContext,
      podId,
      decision.completedCountBefore,
      noProgressCount,
    );
    retryCount++;

    // 防呆：理論上 evaluateGoalGate 會在 retryCount >= hardRetryLimit 時回 force_block；
    // 此處再次檢查避免任何遞增邏輯改動造成意外無限迴圈
    if (retryCount > GOAL_GATE_LIMITS.hardRetryLimit) break;
  }

  persistGoalRoundDivider(effectiveOptions);

  if (runContext) {
    runExecutionService.unregisterActiveStream(runContext.runId, podId);
  }

  if (callbacks?.onComplete) {
    await callbacks.onComplete(canvasId, podId);
  }

  return turnOutcome.result;
}
