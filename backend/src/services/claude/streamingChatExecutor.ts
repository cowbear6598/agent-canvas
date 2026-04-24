import { v4 as uuidv4 } from "uuid";

import { isAbortError } from "../../utils/errorHelpers.js";
import type { ContentBlock, PersistedSubMessage } from "../../types";

import { abortRegistry } from "../provider/abortRegistry.js";
import type { StreamEvent } from "./types.js";
import {
  buildPersistedMessage,
  createFlushCurrentSubMessage,
  createSubMessageState,
  processTextEvent,
  processToolResultEvent,
  processToolUseEvent,
} from "./streamEventProcessor.js";
import { podStore } from "../podStore.js";
import { logger } from "../../utils/logger.js";
import type { ExecutionStrategy } from "../executionStrategy.js";
import { getProvider } from "../provider/index.js";
import type { NormalizedEvent } from "../provider/types.js";
import { runStore } from "../runStore.js";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import { config } from "../../config/index.js";

export interface StreamingChatExecutorOptions {
  canvasId: string;
  podId: string;
  message: string | ContentBlock[];
  abortable: boolean;
  strategy: ExecutionStrategy;
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

interface MutableStreamState {
  accumulatedContent: string;
  subMessages: PersistedSubMessage[];
}

interface StreamContext {
  canvasId: string;
  podId: string;
  messageId: string;
  streamState: MutableStreamState;
  subMessageState: ReturnType<typeof createSubMessageState>;
  flushCurrentSubMessage: () => void;
  persistStreamingMessage: () => void;
  emitStrategy: ReturnType<ExecutionStrategy["createEmitStrategy"]>;
  strategy: ExecutionStrategy;
}

type TextStreamEvent = Extract<StreamEvent, { type: "text" }>;
type ToolUseStreamEvent = Extract<StreamEvent, { type: "tool_use" }>;
type ToolResultStreamEvent = Extract<StreamEvent, { type: "tool_result" }>;
type CompleteStreamEvent = Extract<StreamEvent, { type: "complete" }>;
type ErrorStreamEvent = Extract<StreamEvent, { type: "error" }>;

function handleTextEvent(event: TextStreamEvent, context: StreamContext): void {
  const {
    canvasId,
    podId,
    messageId,
    streamState,
    subMessageState,
    persistStreamingMessage,
    emitStrategy,
  } = context;

  streamState.accumulatedContent = processTextEvent(
    event.content,
    streamState.accumulatedContent,
    subMessageState,
  );

  emitStrategy.emitText({
    canvasId,
    podId,
    messageId,
    content: streamState.accumulatedContent,
  });

  persistStreamingMessage();
}

function handleToolUseEvent(
  event: ToolUseStreamEvent,
  context: StreamContext,
): void {
  const {
    canvasId,
    podId,
    messageId,
    subMessageState,
    flushCurrentSubMessage,
    persistStreamingMessage,
    emitStrategy,
  } = context;

  processToolUseEvent(
    event.toolUseId,
    event.toolName,
    event.input,
    subMessageState,
    flushCurrentSubMessage,
  );

  emitStrategy.emitToolUse({
    canvasId,
    podId,
    messageId,
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    input: event.input,
  });

  persistStreamingMessage();
}

function handleToolResultEvent(
  event: ToolResultStreamEvent,
  context: StreamContext,
): void {
  const {
    canvasId,
    podId,
    messageId,
    subMessageState,
    persistStreamingMessage,
    emitStrategy,
  } = context;

  processToolResultEvent(event.toolUseId, event.output, subMessageState);

  emitStrategy.emitToolResult({
    canvasId,
    podId,
    messageId,
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    output: event.output,
  });

  persistStreamingMessage();
}

function handleCompleteEvent(
  _event: CompleteStreamEvent,
  context: StreamContext,
): void {
  const {
    canvasId,
    podId,
    messageId,
    streamState,
    flushCurrentSubMessage,
    emitStrategy,
  } = context;

  flushCurrentSubMessage();

  emitStrategy.emitComplete({
    canvasId,
    podId,
    messageId,
    fullContent: streamState.accumulatedContent,
  });
}

function handleErrorEvent(
  _event: ErrorStreamEvent,
  context: StreamContext,
): void {
  const { canvasId, podId } = context;
  logger.error(
    "Chat",
    "Error",
    `Pod ${podStore.getById(canvasId, podId)?.name ?? podId} streaming 過程發生錯誤`,
  );
}

type StreamEventHandlerMap = {
  [K in StreamEvent["type"]]: (
    event: Extract<StreamEvent, { type: K }>,
    context: StreamContext,
  ) => void;
};

const streamEventHandlers: StreamEventHandlerMap = {
  text: handleTextEvent,
  tool_use: handleToolUseEvent,
  tool_result: handleToolResultEvent,
  complete: handleCompleteEvent,
  error: handleErrorEvent,
};

function createStreamingCallback(
  context: StreamContext,
): (event: StreamEvent) => void {
  return (event: StreamEvent) => {
    const handler = streamEventHandlers[event.type] as (
      event: StreamEvent,
      context: StreamContext,
    ) => void;
    handler(event, context);
  };
}

async function handleStreamAbort(
  context: StreamContext,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  const {
    canvasId,
    podId,
    messageId,
    streamState,
    flushCurrentSubMessage,
    persistStreamingMessage,
    strategy,
  } = context;

  flushCurrentSubMessage();

  const hasAssistantContent =
    streamState.accumulatedContent.length > 0 ||
    streamState.subMessages.length > 0;
  if (hasAssistantContent) {
    persistStreamingMessage();
  }

  strategy.onStreamAbort(podId, "使用者中斷執行");

  if (callbacks?.onAborted) {
    await callbacks.onAborted(canvasId, podId, messageId);
  }

  return {
    messageId,
    content: streamState.accumulatedContent,
    hasContent: hasAssistantContent,
    aborted: true,
  };
}

async function handleStreamError(
  context: StreamContext,
  error: unknown,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<never> {
  const { canvasId, podId, strategy } = context;

  strategy.onStreamError(podId);

  if (callbacks?.onError) {
    await callbacks.onError(canvasId, podId, error as Error);
  }

  throw error;
}

function setupStreamContext(
  options: StreamingChatExecutorOptions,
): StreamContext {
  const { canvasId, podId, strategy } = options;

  const messageId = uuidv4();
  const subMessageState = createSubMessageState();
  const streamState: MutableStreamState = {
    accumulatedContent: "",
    subMessages: subMessageState.subMessages,
  };
  const flushCurrentSubMessage = createFlushCurrentSubMessage(
    messageId,
    subMessageState,
  );

  const persistStreamingMessage = (): void => {
    const persistedMsg = buildPersistedMessage(
      messageId,
      streamState.accumulatedContent,
      subMessageState,
    );
    strategy.persistMessage(podId, persistedMsg);
  };

  const emitStrategy = strategy.createEmitStrategy();

  return {
    canvasId,
    podId,
    messageId,
    streamState,
    subMessageState,
    flushCurrentSubMessage,
    persistStreamingMessage,
    emitStrategy,
    strategy,
  };
}

async function finalizeAfterStream(
  context: StreamContext,
  sessionId: string | undefined,
): Promise<void> {
  const { streamState, persistStreamingMessage, podId, strategy } = context;

  const hasAssistantContent =
    streamState.accumulatedContent.length > 0 ||
    streamState.subMessages.length > 0;
  if (hasAssistantContent) {
    persistStreamingMessage();
  }

  strategy.onStreamComplete(podId, sessionId);
}

/**
 * 統一處理串流執行過程中的錯誤：依錯誤類型分流處理。
 */
async function handleExecutionError(
  error: unknown,
  streamContext: StreamContext,
  abortable: boolean,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  if (isAbortError(error) && abortable) {
    return handleStreamAbort(streamContext, callbacks);
  }

  return handleStreamError(streamContext, error, callbacks);
}

/**
 * 將 NormalizedEvent 轉換為 StreamEvent，供 streamingCallback 消費。
 * `thinking` 暫走 text 路徑（前端不區分），`session_started` 回傳 null（由呼叫端自行暫存）。
 */
function normalizedEventToStreamEvent(ev: NormalizedEvent): StreamEvent | null {
  switch (ev.type) {
    case "text":
      return { type: "text", content: ev.content };
    case "thinking":
      // 暫時也走 text，前端目前不區分思考過程
      return { type: "text", content: ev.content };
    case "tool_call_start":
      return {
        type: "tool_use",
        toolUseId: ev.toolUseId,
        toolName: ev.toolName,
        input: ev.input,
      };
    case "tool_call_result":
      return {
        type: "tool_result",
        toolUseId: ev.toolUseId,
        toolName: ev.toolName,
        output: ev.output,
      };
    case "turn_complete":
      return { type: "complete" };
    case "error":
      return { type: "error", error: ev.message };
    case "session_started":
      // 由呼叫端自行暫存，不直接轉成 StreamEvent
      return null;
  }
}

/**
 * 解析查詢的工作目錄（workspacePath）。
 *
 * Phase 4 暫時 inline 實作（Phase 5 會抽到 backend/src/services/runtime/workspacePath.ts）：
 *   - Run mode 且 instance 有 worktreePath → 使用 worktreePath
 *   - 否則 → 使用 pod.workspacePath
 *
 * 路徑安全性驗證：worktreePath 必須在 config.repositoriesRoot 內。
 */
function resolveWorkspacePath(
  pod: import("../../types/pod.js").Pod,
  runContext?: import("../../types/run.js").RunContext,
): string {
  if (runContext) {
    const instance = runStore.getPodInstance(runContext.runId, pod.id);
    if (instance?.worktreePath) {
      if (
        !isPathWithinDirectory(instance.worktreePath, config.repositoriesRoot)
      ) {
        logger.error(
          "Chat",
          "Check",
          `[executeStreamingChat] worktreePath 不在合法範圍內：${instance.worktreePath}`,
        );
        throw new Error("Run Instance 的工作目錄路徑不合法");
      }
      return instance.worktreePath;
    }
  }
  return pod.workspacePath;
}

/**
 * 統一的串流聊天執行器，透過 ExecutionStrategy 區分 Normal mode 與 Run mode 的差異。
 *
 * Phase 5A 更新：
 *   - 移除 if (provider === "codex") 分流與 executeCodexStream / withCodexAbort
 *   - Claude 與 Codex 統一走 provider.buildOptions + provider.chat(ctx) 單一路徑
 *   - claudeService.sendMessage 已不再被呼叫（Phase 5B 才刪除 claudeService 本體）
 */
export async function executeStreamingChat(
  options: StreamingChatExecutorOptions,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  const { podId, message, abortable, strategy } = options;

  // 設定串流上下文
  const streamContext = setupStreamContext(options);
  const { canvasId, messageId, streamState } = streamContext;
  const streamingCallback = createStreamingCallback(streamContext);

  // 查詢 Pod 與 Provider
  const podResult = podStore.getByIdGlobal(podId);
  if (!podResult) {
    throw new Error(`找不到 Pod ${podId}`);
  }

  const { pod } = podResult;
  const providerName = pod.provider ?? "claude";
  const provider = getProvider(providerName);

  const sessionId = strategy.getSessionId(podId);
  const queryKey = strategy.getQueryKey(podId);
  const runContext = strategy.getRunContext();

  // 串流開始前置處理（Run mode 需在此註冊 active stream）
  strategy.onStreamStart(podId);

  try {
    // abortRegistry 建立 controller，供外部 abort 呼叫（透過 registry 觸發 signal）
    const abortController = abortRegistry.register(queryKey);

    // 解析工作目錄
    const workspacePath = resolveWorkspacePath(pod, runContext);

    // 建構 Provider 執行時選項
    const providerOptions = await provider.buildOptions(pod, runContext);

    // 組裝 ChatRequestContext
    const ctx = {
      podId,
      message,
      workspacePath,
      resumeSessionId: sessionId ?? null,
      abortSignal: abortController.signal,
      runContext,
      options: providerOptions,
    };

    let capturedSessionId: string | undefined;

    try {
      // 消費 provider.chat(ctx) 的 NormalizedEvent 串流（Claude 與 Codex 共用）
      for await (const ev of provider.chat(ctx)) {
        // session_started：捕捉 sessionId，留到 finalizeAfterStream 使用
        if (ev.type === "session_started") {
          capturedSessionId = ev.sessionId;
          continue;
        }

        const streamEvent = normalizedEventToStreamEvent(ev);
        if (streamEvent === null) continue;

        streamingCallback(streamEvent);

        // error 事件：以 ⚠️ 文字通知前端
        // fatal=true → 拋出例外終止串流；fatal=false → 僅警告，繼續消費
        if (ev.type === "error") {
          streamingCallback({
            type: "text",
            content: `\n\n⚠️ ${ev.message}`,
          });
          if (ev.fatal) {
            throw new Error(ev.message);
          }
          // 非 fatal 錯誤：不拋出，讓串流繼續
          continue;
        }
      }
    } finally {
      // 無論串流正常或異常結束，都清理 abortRegistry entry 防 Memory Leak
      abortRegistry.unregister(queryKey);
    }

    // 串流正常結束後收尾處理（含 session ID 持久化）
    await finalizeAfterStream(streamContext, capturedSessionId);

    if (callbacks?.onComplete) {
      await callbacks.onComplete(canvasId, podId);
    }

    const hasAssistantContent =
      streamState.accumulatedContent.length > 0 ||
      streamState.subMessages.length > 0;

    return {
      messageId,
      content: streamState.accumulatedContent,
      hasContent: hasAssistantContent,
      aborted: false,
    };
  } catch (error) {
    return handleExecutionError(error, streamContext, abortable, callbacks);
  }
}
