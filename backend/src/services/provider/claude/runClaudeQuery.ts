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
import {
  checkRateLimitEvent,
  checkAuthStatus,
  formatApiRetryMessage,
  checkAssistantError,
} from "../../claude/sdkErrorMapper.js";
import { logger } from "../../../utils/logger.js";

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

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

/** 組裝 Claude SDK prompt（文字或 ContentBlock 陣列） */
function buildPrompt(
  message: string | import("../../../types/message.js").ContentBlock[],
  resumeSessionId: string | null,
): string | AsyncIterable<SDKUserMessage> {
  if (typeof message === "string") {
    // 空白訊息 fallback：使用語意明確的中間變數，避免三元運算式在閱讀時語意模糊
    const trimmed = message.trim();
    const prompt = trimmed.length === 0 ? "請開始執行" : trimmed;
    return prompt;
  }

  const contentArray = buildClaudeContentBlocks(message);
  const sessionId = resumeSessionId ?? "";
  return createUserMessageStream(contentArray, sessionId);
}

function isToolResultBlock(block: unknown): block is UserToolResultBlock {
  if (typeof block !== "object" || block === null) return false;
  const record = block as Record<string, unknown>;
  return record.type === "tool_result" && "tool_use_id" in record;
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
    const result = checkAssistantError(sdkMessage.error);
    const userMessage = result.shouldAbort
      ? result.userMessage
      : "與 Claude 通訊時發生錯誤，請稍後再試";
    // 先送出錯誤文字，再拋出，讓上層感知到失敗；原始 SDK 錯誤只記 log，不暴露給前端
    logger.error("Chat", "Error", "assistant message 錯誤", sdkMessage.error);
    yield { type: "text", content: `\n\n⚠️ ${userMessage}` };
    throw new Error("Claude SDK 回傳 assistant 錯誤");
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

/** result/success → turn_complete NormalizedEvent；result/error → throw */
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

  // 先送出使用者友善警告文字，接著 throw，由呼叫鏈完整攔截並走通用錯誤路徑
  yield {
    type: "text",
    content: "\n\n⚠️ 與 Claude 通訊時發生錯誤，請稍後再試",
  };
  throw new Error("Claude SDK result 回傳錯誤");
}

/** rate_limit_event → throw if rejected */
function* handleRateLimitEvent(
  sdkMessage: SDKRateLimitEvent,
): Generator<NormalizedEvent> {
  const result = checkRateLimitEvent(sdkMessage.rate_limit_info);
  if (!result.shouldAbort) return;

  yield { type: "text", content: `\n\n⚠️ ${result.userMessage}` };
  throw new Error(`rate_limit_event rejected：帳戶用量已達上限`);
}

/** auth_status → throw if error */
function* handleAuthStatus(
  sdkMessage: SDKAuthStatusMessage,
): Generator<NormalizedEvent> {
  const result = checkAuthStatus(sdkMessage.error);
  if (!result.shouldAbort) return;

  // 原始 SDK error 只記 log，不暴露給前端
  logger.error("Chat", "Error", "auth_status 錯誤", sdkMessage.error);
  yield { type: "text", content: `\n\n⚠️ ${result.userMessage}` };
  throw new Error("Claude SDK auth_status 錯誤");
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
    podId,
    message,
    workspacePath,
    resumeSessionId,
    abortSignal,
    runContext,
    options,
  } = ctx;

  if (!options) {
    yield {
      type: "error",
      message: "[runClaudeQuery] ClaudeOptions 未提供",
      fatal: true,
    };
    return;
  }

  const prompt = buildPrompt(message, resumeSessionId);

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
  const sdkOptions: Options & { abortController: AbortController } = {
    cwd: workspacePath,
    settingSources: options.settingSources,
    permissionMode: options.permissionMode,
    includePartialMessages: options.includePartialMessages,
    pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
    allowedTools: options.allowedTools,
    model: options.model,
    abortController,
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
  };

  const state: QueryState = {
    sessionId: null,
    fullContent: "",
    activeTools: new Map(),
  };

  // resumeSessionId 遮蔽：僅顯示前 6 字，避免 session 識別符出現在 log 中
  const maskedResume = resumeSessionId
    ? `${resumeSessionId.slice(0, 6)}...`
    : "null";
  logger.log(
    "Chat",
    "Update",
    `[runClaudeQuery] Pod ${podId} 開始查詢，model=${options.model}，resume=${maskedResume}，runContext=${runContext?.runId ?? "null"}`,
  );

  const queryStream: Query = query({ prompt, options: sdkOptions });

  // 消費 SDK 串流，分派各 SDKMessage 並 yield NormalizedEvent
  for await (const sdkMessage of queryStream) {
    yield* dispatchSDKMessage(sdkMessage, state);
  }

  // 防禦性檢查：若 abort signal 已觸發但未拋出 AbortError，手動拋出
  if (abortSignal.aborted) {
    const abortError = new Error("查詢已被中斷");
    abortError.name = "AbortError";
    throw abortError;
  }
}
