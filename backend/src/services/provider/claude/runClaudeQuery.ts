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
  commandId: string | null,
  resumeSessionId: string | null,
): string | AsyncIterable<SDKUserMessage> {
  if (typeof message === "string") {
    let prompt = commandId ? `/${commandId} ${message}` : message;
    if (prompt.trim().length === 0) {
      prompt = "請開始執行";
    }
    return prompt;
  }

  const contentArray = buildClaudeContentBlocks(message, commandId);
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
    // 先送出錯誤文字，再拋出，讓上層感知到失敗
    yield { type: "text", content: `\n\n⚠️ ${userMessage}` };
    throw new Error(`assistant message 錯誤：${sdkMessage.error}`);
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

  const errorMessage =
    sdkMessage.errors.length > 0
      ? sdkMessage.errors.join(", ")
      : "Unknown error";

  yield {
    type: "text",
    content: "\n\n⚠️ 與 Claude 通訊時發生錯誤，請稍後再試",
  };
  throw new Error(errorMessage);
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

  yield { type: "text", content: `\n\n⚠️ ${result.userMessage}` };
  throw new Error(`auth_status 錯誤：${sdkMessage.error}`);
}

/** 分派 SDKMessage 至對應的處理器，回傳 NormalizedEvent iterable */
function* dispatchSDKMessage(
  sdkMessage: SDKMessage,
  state: QueryState,
): Generator<NormalizedEvent> {
  if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
    yield* handleSystemInit(sdkMessage as SDKSystemMessage, state);
    return;
  }

  if (sdkMessage.type === "system" && sdkMessage.subtype === "api_retry") {
    yield* handleApiRetry(sdkMessage as SDKAPIRetryMessage);
    return;
  }

  switch (sdkMessage.type) {
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

  // 取得 pod commandId（僅 normal mode 有 commandId，run mode 無）
  // commandId 需從外部傳入；暫時以 null 處理（ctx 未傳 pod 物件）
  const commandId: string | null = null;
  const prompt = buildPrompt(message, commandId, resumeSessionId);

  // 組裝 SDK Options（將 ClaudeOptions 展開至 SDK 的 Options 格式）
  const sdkOptions: Options & { abortController: AbortController } = {
    cwd: workspacePath,
    settingSources: options.settingSources,
    permissionMode: options.permissionMode,
    includePartialMessages: options.includePartialMessages,
    pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
    allowedTools: options.allowedTools,
    model: options.model,
    abortController: new AbortController(),
  };

  // 將 ctx.abortSignal 橋接到 SDK 的 abortController
  if (abortSignal.aborted) {
    sdkOptions.abortController.abort();
  } else {
    const onAbort = (): void => sdkOptions.abortController.abort();
    abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  if (options.systemPrompt) {
    sdkOptions.systemPrompt = options.systemPrompt;
  }
  if (options.mcpServers) {
    sdkOptions.mcpServers = options.mcpServers;
  }
  if (options.plugins) {
    sdkOptions.plugins = options.plugins;
  }
  if (resumeSessionId) {
    sdkOptions.resume = resumeSessionId;
  }

  const state: QueryState = {
    sessionId: null,
    fullContent: "",
    activeTools: new Map(),
  };

  logger.log(
    "Chat",
    "Update",
    `[runClaudeQuery] Pod ${podId} 開始查詢，model=${options.model}，resume=${resumeSessionId ?? "null"}，runContext=${runContext?.runId ?? "null"}`,
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
