/**
 * Claude SDK 呼叫模組。
 *
 * 將 SDK Message → NormalizedEvent 的分派邏輯（原 processSDKMessage + handleXxxMessage）
 * 搬至此處，以 async generator 形式產出 NormalizedEvent。
 *
 * 不再使用 onSessionInit callback，改為 yield { type: "session_started", sessionId }，
 * 由 executor 端在 for-await loop 內消化並呼叫 strategy.onSessionInit。
 */

import {
  type Options,
  type Query,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage as SDKUserMessageType,
  SDKToolProgressMessage,
  SDKRateLimitEvent,
  SDKAuthStatusMessage,
  SDKAPIRetryMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { NormalizedEvent, ChatRequestContext } from "../types.js";
import type { ClaudeOptions } from "./buildClaudeOptions.js";
import {
  buildClaudeContentBlocks,
  createUserMessageStream,
  type SDKUserMessage,
} from "../../claude/messageBuilder.js";
import { GOAL_MCP_SERVER_NAME } from "../../goalRuntime.js";
import {
  checkRateLimitEvent,
  checkAuthStatus,
  formatApiRetryMessage,
} from "../../claude/sdkErrorMapper.js";
import {
  buildClaudeSandboxAllowWrite,
  buildClaudeSandboxDenyWrite,
  buildClaudeSandboxNetwork,
} from "../../claude/claudeSandboxPaths.js";
import { logger, sanitizeSensitiveInfo } from "../../../utils/logger.js";
import { sanitizePodName } from "../podNameSanitizer.js";
import {
  buildGoalRuntimeBootstrapPrompt,
  buildGoalRuntimeBootstrapContentBlock,
} from "../goalBootstrapPrompt.js";

// ─── 型別定義 ────────────────────────────────────────────────────────────────

type AssistantTextBlock = { type: "text"; text: string };
type AssistantToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AssistantContentBlock = AssistantTextBlock | AssistantToolUseBlock;

type UserToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content?: string;
};

// SDK 的 SDKToolProgressMessage 不含 output/result 欄位，此為實際接收到的訊息結構（runtime 額外夾帶）
type SDKToolProgressWithOutput = SDKToolProgressMessage & {
  output?: string;
  result?: string;
};

interface ActiveToolEntry {
  toolName: string;
  input: Record<string, unknown>;
}

interface QueryState {
  sessionId: string | null;
  fullContent: string;
  activeTools: Map<string, ActiveToolEntry>;
}

const MAX_STDERR_DIAGNOSTIC_CHARS = 2000;

function buildClaudeSystemError(params: {
  content: string;
  code?: string | null;
  fatal: boolean;
  rawContent?: string;
}): Extract<NormalizedEvent, { type: "error" }> {
  const { content, code, fatal, rawContent } = params;

  return {
    type: "error",
    message: content,
    fatal,
    ...(code ? { code } : {}),
    systemMessage: {
      role: "system",
      content,
      metadata: {
        provider: "claude",
        code: code ?? null,
        severity: fatal ? "fatal" : "error",
        rawContent: rawContent ?? content,
      },
    },
  };
}

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

/** 組裝 Claude SDK prompt（文字或 ContentBlock 陣列） */
function buildPrompt(
  message: string | import("../../../types/message.js").ContentBlock[],
  resumeSessionId: string | null,
  shouldBootstrapGoalRuntime: boolean,
): string | AsyncIterable<SDKUserMessage> {
  // resume 時（gate retry 第 2 輪以後）不再注入 bootstrap，避免覆蓋 nudge 指示
  const doBootstrap = shouldBootstrapGoalRuntime && !resumeSessionId;

  if (typeof message === "string") {
    // 空白訊息 fallback：使用語意明確的中間變數，避免三元運算式在閱讀時語意模糊
    const trimmed = message.trim();
    const prompt = trimmed.length === 0 ? "請開始執行" : trimmed;
    if (!doBootstrap) {
      return prompt;
    }
    return buildGoalRuntimeBootstrapPrompt(prompt);
  }

  const contentArray = buildClaudeContentBlocks(message);
  const finalContentArray = doBootstrap
    ? [buildGoalRuntimeBootstrapContentBlock(), ...contentArray]
    : contentArray;
  const sessionId = resumeSessionId ?? "";
  return createUserMessageStream(finalContentArray, sessionId);
}

function isToolResultBlock(block: unknown): block is UserToolResultBlock {
  if (typeof block !== "object" || block === null) return false;
  const record = block as Record<string, unknown>;
  return record.type === "tool_result" && "tool_use_id" in record;
}

function buildClaudeStderrDiagnostic(
  stderrText: string,
): Extract<NormalizedEvent, { type: "error" }> | null {
  const trimmed = stderrText.trim();
  if (!trimmed) return null;

  const truncated =
    trimmed.length > MAX_STDERR_DIAGNOSTIC_CHARS
      ? `${trimmed.slice(0, MAX_STDERR_DIAGNOSTIC_CHARS)}... [TRUNCATED]`
      : trimmed;

  return buildClaudeSystemError({
    content: `Claude 執行診斷：${truncated}`,
    code: "STDERR_DIAGNOSTIC",
    fatal: false,
    rawContent: truncated,
  });
}

// ─── SDKMessage 處理器（各回傳 NormalizedEvent 或 null） ─────────────────────

/** system/init → session_started NormalizedEvent */
function* handleSystemInit(
  sdkMessage: SDKSystemMessage,
  state: QueryState,
): Generator<NormalizedEvent> {
  state.sessionId = sdkMessage.session_id;
  if (sdkMessage.session_id) {
    yield { type: "session_started", sessionId: sdkMessage.session_id };
  }
}

/** system/api_retry → text NormalizedEvent（⚠️ 重試通知） */
function* handleApiRetry(
  sdkMessage: SDKAPIRetryMessage,
): Generator<NormalizedEvent> {
  const { attempt, max_retries, error_status } = sdkMessage;
  logger.log(
    "Chat",
    "Update",
    `[runClaudeQuery] API 請求重試：第 ${attempt}/${max_retries} 次，error_status=${error_status ?? "null"}`,
  );
  const message = formatApiRetryMessage(attempt, max_retries, error_status);
  yield { type: "text", content: message };
}

/** assistant → text/tool_call_start NormalizedEvent */
function* handleAssistant(
  sdkMessage: SDKAssistantMessage,
  state: QueryState,
): Generator<NormalizedEvent> {
  const assistantMessage = sdkMessage.message;
  if (assistantMessage.content) {
    for (const block of assistantMessage.content as AssistantContentBlock[]) {
      if (block.type === "text" && block.text) {
        state.fullContent += block.text;
        yield { type: "text", content: block.text };
      } else if (block.type === "tool_use") {
        state.activeTools.set(block.id, {
          toolName: block.name,
          input: block.input,
        });
        yield {
          type: "tool_call_start",
          toolUseId: block.id,
          toolName: block.name,
          input: block.input,
        };
      }
    }
  }

  if (sdkMessage.error) {
    // 原始 SDK error 字串只記 log，不暴露給前端（避免洩漏 SDK 內部細節）
    logger.error("Chat", "Error", "assistant message 錯誤", sdkMessage.error);
    yield buildClaudeSystemError({
      content: "Claude SDK 回傳 assistant 錯誤，請稍後重試。",
      code: "ASSISTANT_ERROR",
      fatal: true,
    });
    // AI 業務錯誤：只 yield 給上層 executor 寫入 transcript，後續 SDK message 由迴圈自然處理
    return;
  }
}

/** user（tool_result）→ tool_call_result NormalizedEvent */
function* handleUser(
  sdkMessage: SDKUserMessageType,
  state: QueryState,
): Generator<NormalizedEvent> {
  const userMessage = sdkMessage.message;
  if (!userMessage.content || !Array.isArray(userMessage.content)) return;

  for (const block of userMessage.content) {
    if (!isToolResultBlock(block)) continue;

    const toolUseId = block.tool_use_id;
    const content = block.content ?? "";
    const toolInfo = state.activeTools.get(toolUseId);
    if (!toolInfo) continue;

    yield {
      type: "tool_call_result",
      toolUseId,
      toolName: toolInfo.toolName,
      output: content,
    };
  }
}

/** tool_progress → tool_call_result NormalizedEvent */
function* handleToolProgress(
  sdkMessage: SDKToolProgressWithOutput,
  state: QueryState,
): Generator<NormalizedEvent> {
  const outputText = sdkMessage.output ?? sdkMessage.result;
  if (!outputText) return;

  const toolUseId = sdkMessage.tool_use_id;

  let toolInfo: ActiveToolEntry | undefined;
  if (toolUseId && state.activeTools.has(toolUseId)) {
    toolInfo = state.activeTools.get(toolUseId);
  }

  if (!toolInfo) return;

  yield {
    type: "tool_call_result",
    toolUseId: toolUseId ?? "",
    toolName: toolInfo.toolName,
    output: outputText,
  };
}

/** result/success → turn_complete NormalizedEvent；result/error → yield system error（不 throw） */
function* handleResult(
  sdkMessage: SDKResultMessage,
  state: QueryState,
): Generator<NormalizedEvent> {
  if (sdkMessage.subtype === "success") {
    if (!state.fullContent && sdkMessage.result) {
      state.fullContent = sdkMessage.result;
    }
    yield { type: "turn_complete" };
    return;
  }

  // 原始 SDK errors 只記 log，不暴露給前端（避免洩漏內部細節）
  logger.error("Chat", "Error", "result/error 回傳錯誤", sdkMessage.errors);
  const rawContent = Array.isArray(sdkMessage.errors)
    ? sdkMessage.errors.join("\n")
    : "Claude result error";
  yield buildClaudeSystemError({
    content: rawContent,
    code: "RESULT_ERROR",
    fatal: true,
    rawContent,
  });
  // AI 業務錯誤：result event 即代表本輪結束，generator 自然回到外層迴圈
  return;
}

/**
 * rate_limit_event → yield 人類可讀的 system error（不 throw）。
 *
 * `rate_limit_info` 為 SDKRateLimitInfo（status / resetsAt / rateLimitType / utilization 等欄位）。
 * `content` 由可用欄位組合成英文可讀字串，保留 provider 原語系；
 * 完整原始 JSON 仍寫入 `rawContent` 供 debug。
 */
function* handleRateLimitEvent(
  sdkMessage: SDKRateLimitEvent,
): Generator<NormalizedEvent> {
  const result = checkRateLimitEvent(sdkMessage.rate_limit_info);
  if (!result.shouldAbort) return;

  const rawContent = JSON.stringify(sdkMessage.rate_limit_info);
  const content = formatRateLimitInfo(sdkMessage.rate_limit_info);
  yield buildClaudeSystemError({
    content,
    code: "RATE_LIMIT_REJECTED",
    fatal: true,
    rawContent,
  });
  // AI 業務錯誤：上層 executor 已寫入 transcript，generator 結束讓外層迴圈繼續處理後續 SDK message
  return;
}

/**
 * 將 SDKRateLimitInfo 組合成人類可讀英文字串，保留 provider 原語系。
 *
 * 優先嘗試從物件中讀取 `message`（防呆：若 SDK 未來新增此欄位也能直接吃下）；
 * 否則使用 `status` / `rateLimitType` / `resetsAt` / `utilization` 等已知欄位拼接。
 */
function formatRateLimitInfo(info: unknown): string {
  if (typeof info !== "object" || info === null) {
    return "Rate limit reached.";
  }
  const record = info as Record<string, unknown>;

  // 優先使用 SDK 提供的 message 欄位（若有）
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }

  const parts: string[] = [];
  const status = typeof record.status === "string" ? record.status : null;
  parts.push(status ? `Status: ${status}` : "Status: rejected");

  if (typeof record.rateLimitType === "string") {
    parts.push(`type: ${record.rateLimitType}`);
  }

  if (typeof record.utilization === "number") {
    // utilization 通常為 0~1 的比例，乘 100 顯示百分比
    parts.push(`utilization: ${(record.utilization * 100).toFixed(1)}%`);
  }

  // resetsAt 為 unix timestamp（秒），轉為 ISO 字串以便閱讀
  if (typeof record.resetsAt === "number" && Number.isFinite(record.resetsAt)) {
    const resetDate = new Date(record.resetsAt * 1000);
    if (!Number.isNaN(resetDate.getTime())) {
      parts.push(`resets at ${resetDate.toISOString()}`);
    }
  }

  return `Rate limit reached. ${parts.join(", ")}.`;
}

/** auth_status → yield system error（不 throw）。AI 業務錯誤交由 transcript 呈現。 */
function* handleAuthStatus(
  sdkMessage: SDKAuthStatusMessage,
): Generator<NormalizedEvent> {
  const result = checkAuthStatus(sdkMessage.error);
  if (!result.shouldAbort) return;

  // 原始 SDK error 字串只記 log，不暴露給前端（避免洩漏 SDK 內部細節）
  logger.error("Chat", "Error", "auth_status 錯誤", sdkMessage.error);
  yield buildClaudeSystemError({
    content: "Claude 認證失敗，請確認 API Key 設定後重試。",
    code: "AUTH_STATUS_ERROR",
    fatal: true,
  });
  // AI 業務錯誤：generator 自然繼續處理後續 SDK message
  return;
}

/** system case 的內部子路由：依 subtype 分派至 handleSystemInit / handleApiRetry */
function* dispatchSystemMessage(
  sdkMessage: SDKSystemMessage | SDKAPIRetryMessage,
  state: QueryState,
): Generator<NormalizedEvent> {
  if (sdkMessage.subtype === "init") {
    yield* handleSystemInit(sdkMessage as SDKSystemMessage, state);
  } else if (sdkMessage.subtype === "api_retry") {
    yield* handleApiRetry(sdkMessage as SDKAPIRetryMessage);
  }
  // 其他 subtype 略過
}

/** 分派 SDKMessage 至對應的處理器，回傳 NormalizedEvent iterable */
function* dispatchSDKMessage(
  sdkMessage: SDKMessage,
  state: QueryState,
): Generator<NormalizedEvent> {
  switch (sdkMessage.type) {
    case "system":
      yield* dispatchSystemMessage(
        sdkMessage as SDKSystemMessage | SDKAPIRetryMessage,
        state,
      );
      break;
    case "assistant":
      yield* handleAssistant(sdkMessage as SDKAssistantMessage, state);
      break;
    case "user":
      yield* handleUser(sdkMessage as SDKUserMessageType, state);
      break;
    case "tool_progress":
      yield* handleToolProgress(sdkMessage as SDKToolProgressWithOutput, state);
      break;
    case "result":
      yield* handleResult(sdkMessage as SDKResultMessage, state);
      break;
    case "rate_limit_event":
      yield* handleRateLimitEvent(sdkMessage as SDKRateLimitEvent);
      break;
    case "auth_status":
      yield* handleAuthStatus(sdkMessage as SDKAuthStatusMessage);
      break;
    // 其他未知 type 略過
  }
}

// ─── runClaudeQuery ──────────────────────────────────────────────────────────

/**
 * 呼叫 Claude SDK query()，並將 SDKMessage 轉換為 NormalizedEvent 串流。
 *
 * - 消費 ctx.abortSignal，當 abort 發生時 SDK 串流中止
 * - system/init → yield session_started（不再使用 onSessionInit callback）
 * - 串流正常結束後若 abortSignal 已觸發，手動拋出 AbortError（防禦性檢查）
 *
 * 此函式不處理 session retry，由 sessionRetry.ts 包裝此函式來完成。
 */
export async function* runClaudeQuery(
  ctx: ChatRequestContext<ClaudeOptions>,
): AsyncIterable<NormalizedEvent> {
  const {
    podName,
    message,
    workspacePath,
    sandboxHomePath,
    resumeSessionId,
    abortSignal,
    options,
  } = ctx;

  if (!options) {
    yield buildClaudeSystemError({
      content: "[runClaudeQuery] ClaudeOptions 未提供",
      code: "MISSING_OPTIONS",
      fatal: true,
    });
    return;
  }

  const prompt = buildPrompt(
    message,
    resumeSessionId,
    Boolean(options.mcpServers?.[GOAL_MCP_SERVER_NAME]),
  );
  const pendingStderrChunks: string[] = [];
  let hasYieldedStderrDiagnostic = false;
  let resolveStderrSignal: (() => void) | null = null;

  // 建立 abortController，供 ctx.abortSignal 橋接
  const abortController = new AbortController();
  if (abortSignal.aborted) {
    abortController.abort();
  } else {
    const onAbort = (): void => abortController.abort();
    abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  // 一次建構完整 sdkOptions，使用物件展開將 ClaudeOptions 映射到 SDK Options 格式；
  // 選填欄位（mcpServers / plugins / resume）只在有值時才包含，
  // 避免傳入 undefined 干擾 SDK 行為
  const enqueueStderrDiagnostic = (chunk: string): void => {
    const sanitizedChunk = sanitizeSensitiveInfo(chunk);
    logger.warn("Chat", "Warn", `[claude-sdk stderr] ${sanitizedChunk}`);

    if (hasYieldedStderrDiagnostic || sanitizedChunk.trim().length === 0) {
      return;
    }

    pendingStderrChunks.push(sanitizedChunk);
    if (resolveStderrSignal) {
      resolveStderrSignal();
      resolveStderrSignal = null;
    }
  };

  const drainPendingStderrDiagnostic = (): Extract<
    NormalizedEvent,
    { type: "error" }
  > | null => {
    if (pendingStderrChunks.length === 0) return null;

    const joined = pendingStderrChunks.splice(0).join("").trim();
    if (!joined) return null;

    if (hasYieldedStderrDiagnostic) {
      return null;
    }

    const diagnosticEvent = buildClaudeStderrDiagnostic(joined);
    if (!diagnosticEvent) return null;

    hasYieldedStderrDiagnostic = true;
    return diagnosticEvent;
  };

  const waitForStderrSignal = (): Promise<{ source: "stderr" }> => {
    if (pendingStderrChunks.length > 0) {
      return Promise.resolve({ source: "stderr" });
    }

    return new Promise<{ source: "stderr" }>((resolve) => {
      resolveStderrSignal = (): void => {
        resolve({ source: "stderr" });
      };
    });
  };

  // SDK 內建 sandbox 配置（取代自寫的 claudeSandboxLauncher）。
  // 注意：此 sandbox 隔離的是 Claude 執行 Bash 工具時跑的指令，並非 Claude binary 本身；
  // 因此 ~/.claude / ~/.claude.json 不需要列入 allowWrite（Claude 自身不在 sandbox 內）。
  const sandboxAllowWrite = buildClaudeSandboxAllowWrite(
    workspacePath,
    sandboxHomePath,
  );

  const defaultSandbox = {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    filesystem: {
      allowWrite: sandboxAllowWrite,
      denyWrite: buildClaudeSandboxDenyWrite(),
    },
    network: buildClaudeSandboxNetwork(),
  };

  const sdkOptions: Options & { abortController: AbortController } = {
    cwd: workspacePath,
    settingSources: options.settingSources,
    permissionMode: options.permissionMode,
    includePartialMessages: options.includePartialMessages,
    pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
    allowedTools: options.allowedTools,
    model: options.model,
    abortController,
    sandbox: options.sandbox ?? defaultSandbox,
    // stderr 除了寫入 backend log，也轉成 provider 診斷事件，避免 Linux sandbox 問題靜默卡住
    stderr: enqueueStderrDiagnostic,
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.thinking ? { thinking: options.thinking } : {}),
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
  };

  const state: QueryState = {
    sessionId: null,
    fullContent: "",
    activeTools: new Map(),
  };

  logger.log(
    "Chat",
    "Update",
    `[ClaudeProvider] ${sanitizePodName(podName)} 開始查詢（model: ${options.model}，thinking: ${options.effort ?? "none"}）`,
  );

  const queryStream: Query = query({ prompt, options: sdkOptions });
  const iterator = queryStream[Symbol.asyncIterator]();
  let nextResultPromise: Promise<IteratorResult<SDKMessage>> = iterator.next();

  // 以 race 同時等待 SDK message 與 stderr 診斷，避免 Linux sandbox 只寫 stderr 時前端完全靜默
  while (true) {
    const stderrDiagnostic = drainPendingStderrDiagnostic();
    if (stderrDiagnostic) {
      yield stderrDiagnostic;
      continue;
    }

    const winner = await Promise.race([
      nextResultPromise.then((result) => ({ source: "sdk" as const, result })),
      waitForStderrSignal(),
    ]);

    if (winner.source === "stderr") {
      continue;
    }

    resolveStderrSignal = null;

    if (winner.result.done) {
      break;
    }

    nextResultPromise = iterator.next();
    const sdkMessage = winner.result.value;
    yield* dispatchSDKMessage(sdkMessage, state);
  }

  const finalStderrDiagnostic = drainPendingStderrDiagnostic();
  if (finalStderrDiagnostic) {
    yield finalStderrDiagnostic;
  }

  // 防禦性檢查：若 abort signal 已觸發但未拋出 AbortError，手動拋出
  if (abortSignal.aborted) {
    const abortError = new Error("查詢已被中斷");
    abortError.name = "AbortError";
    throw abortError;
  }
}
