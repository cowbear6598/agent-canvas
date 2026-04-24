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
import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
} from "../provider/types.js";
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

/** 判斷串流狀態中是否已累積任何 assistant 內容（文字或 tool use 子訊息） */
function hasAssistantContent(state: MutableStreamState): boolean {
  return state.accumulatedContent.length > 0 || state.subMessages.length > 0;
}

/** 串流期間 throttle 節流的時間窗口（毫秒）：200ms 上限延遲對 UX 可接受 */
const THROTTLE_MS = 200;

interface StreamContext {
  canvasId: string;
  podId: string;
  /** Pod 顯示名稱，setupStreamContext 先以 podId 填入，executeStreamingChat 取得 pod 後覆寫為 pod.name */
  podName: string;
  messageId: string;
  streamState: MutableStreamState;
  subMessageState: ReturnType<typeof createSubMessageState>;
  flushCurrentSubMessage: () => void;
  /** 直接寫入 DB（僅供 finalize / abort 呼叫，確保最終落盤） */
  persistStreamingMessage: () => void;
  /** 串流中節流版本的 persistStreamingMessage，避免 DB write lock 競爭 */
  persistThrottled: () => void;
  /** 節流 timer handle，供 finalize / abort 清除待排程的舊 timer */
  pendingTimer: ReturnType<typeof setTimeout> | null;
  /** 上次實際寫入 DB 的時間戳（ms），初始值 0 */
  lastPersistAt: number;
  emitStrategy: ReturnType<ExecutionStrategy["createEmitStrategy"]>;
  strategy: ExecutionStrategy;
  /**
   * 串流事件回呼，供 handleErrorEvent 在記錄 log 後推送通用警告文字給前端。
   * 由 createStreamingCallback 建立後回寫至此欄位（因 callback 依賴 context，
   * 需在 context 建立後才能設定，初始值以 no-op 佔位）。
   */
  streamingCallback: (event: StreamEvent) => void;
  /**
   * 串流期間捕捉到的 session ID（session_started 事件寫入）。
   * 由 processNormalizedEvent 在收到 session_started 時寫入，
   * 供 finalizeAfterStream 持久化 session。
   */
  capturedSessionId: string | undefined;
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
    persistThrottled,
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

  persistThrottled();
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
    persistThrottled,
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

  persistThrottled();
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
    persistThrottled,
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

  persistThrottled();
}

// `_event` 參數未使用，遵守 no-unused-vars 規則保留 `_` 前綴
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
  event: ErrorStreamEvent,
  context: StreamContext,
): void {
  const { canvasId, podId, streamingCallback } = context;

  // 原始錯誤訊息記入 server log，不暴露給前端
  logger.error(
    "Chat",
    "Error",
    `Provider 串流錯誤（podId=${podId}, canvasId=${canvasId}, fatal=${event.fatal}）：${event.error}`,
  );

  // 前端僅收到通用警告，不含原始訊息
  const genericMessage = event.fatal
    ? "\n\n⚠️ 發生嚴重錯誤，對話已中斷"
    : "\n\n⚠️ 發生錯誤，請稍後再試";
  streamingCallback({ type: "text", content: genericMessage });

  if (event.fatal) {
    throw new Error("串流處理發生嚴重錯誤");
  }
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
  const callback = (event: StreamEvent): void => {
    const handler = streamEventHandlers[event.type] as (
      event: StreamEvent,
      context: StreamContext,
    ) => void;
    handler(event, context);
  };
  // 回寫至 context，供 handleErrorEvent 推送通用警告文字給前端
  context.streamingCallback = callback;
  return callback;
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

  // 清除節流 timer，避免最終 persist 後又被舊 timer 覆寫
  if (context.pendingTimer !== null) {
    clearTimeout(context.pendingTimer);
    context.pendingTimer = null;
  }

  flushCurrentSubMessage();

  if (hasAssistantContent(streamState)) {
    // abort 路徑直接呼叫 persistStreamingMessage（非節流版），確保最終狀態落盤
    persistStreamingMessage();
  }

  strategy.onStreamAbort(podId, "使用者中斷執行");

  if (callbacks?.onAborted) {
    await callbacks.onAborted(canvasId, podId, messageId);
  }

  return {
    messageId,
    content: streamState.accumulatedContent,
    hasContent: hasAssistantContent(streamState),
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

  // 節流狀態（封閉於 context，避免跨串流共享）
  const throttleState = {
    lastPersistAt: 0,
    pendingTimer: null as ReturnType<typeof setTimeout> | null,
  };

  /**
   * 節流版 persistStreamingMessage：
   * - 距上次寫入 >= THROTTLE_MS 時立即寫入
   * - 否則排程 setTimeout 到下個窗口開頭寫入最後一次 payload
   * - 同一窗口內多次呼叫只排一個 timer，並使用最新 payload（閉包自動取最新 streamState）
   */
  const persistThrottled = (): void => {
    const now = Date.now();
    if (now - throttleState.lastPersistAt >= THROTTLE_MS) {
      // 窗口已過，立即寫入並更新時間戳
      throttleState.lastPersistAt = now;
      persistStreamingMessage();
    } else if (throttleState.pendingTimer === null) {
      // 窗口內尚無待排程 timer，新增一個；不重複排程
      const delay = THROTTLE_MS - (now - throttleState.lastPersistAt);
      throttleState.pendingTimer = setTimeout(() => {
        throttleState.pendingTimer = null;
        throttleState.lastPersistAt = Date.now();
        persistStreamingMessage();
      }, delay);
    }
    // 已有 pending timer：payload 由閉包保持最新，不需重排
  };

  // 將 throttleState 的可變欄位映射到 context（讓 abort / finalize 能清除 timer）
  const context: StreamContext = {
    canvasId,
    podId,
    // pod.name 尚未取得，先以 podId 填入；executeStreamingChat 取得 pod 後會覆寫
    podName: podId,
    messageId,
    streamState,
    subMessageState,
    flushCurrentSubMessage,
    persistStreamingMessage,
    persistThrottled,
    get pendingTimer() {
      return throttleState.pendingTimer;
    },
    set pendingTimer(v) {
      throttleState.pendingTimer = v;
    },
    get lastPersistAt() {
      return throttleState.lastPersistAt;
    },
    set lastPersistAt(v) {
      throttleState.lastPersistAt = v;
    },
    emitStrategy,
    strategy,
    // createStreamingCallback 建立後會回寫此欄位；初始值以 no-op 佔位，避免型別錯誤
    streamingCallback: () => undefined,
    // session_started 事件由 processNormalizedEvent 寫入；初始值 undefined
    capturedSessionId: undefined,
  };

  return context;
}

async function finalizeAfterStream(
  context: StreamContext,
  sessionId: string | undefined,
): Promise<void> {
  const { streamState, persistStreamingMessage, podId, strategy } = context;

  // 清除節流 timer，避免最終 persist 後又被舊 timer 覆寫
  if (context.pendingTimer !== null) {
    clearTimeout(context.pendingTimer);
    context.pendingTimer = null;
  }

  if (hasAssistantContent(streamState)) {
    // finalize 路徑直接呼叫 persistStreamingMessage（非節流版），確保最終狀態落盤
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
      return { type: "error", error: ev.message, fatal: ev.fatal };
    case "session_started":
      // 由呼叫端自行暫存，不直接轉成 StreamEvent
      return null;
  }
}

/**
 * 處理單一正規化串流事件：
 *   - session_started → 寫入 streamContext.capturedSessionId，供 finalizeAfterStream 持久化
 *   - 其餘事件 → 轉換為 StreamEvent 後交由 streamingCallback 分派給對應 handler
 *
 * 此函式為 module-scope 純函式（無 side effect 以外的回傳值），
 * 由 executeStreamingChat 的 for-await 迴圈逐事件呼叫。
 */
function processNormalizedEvent(
  ev: NormalizedEvent,
  streamContext: StreamContext,
  streamingCallback: (event: StreamEvent) => void,
): void {
  if (ev.type === "session_started") {
    streamContext.capturedSessionId = ev.sessionId;
    return;
  }

  const streamEvent = normalizedEventToStreamEvent(ev);
  if (streamEvent === null) return;

  streamingCallback(streamEvent);
}

/**
 * 解析查詢的工作目錄（workspacePath）。
 *
 * TODO: 考慮抽成獨立模組（backend/src/services/workspace/workspacePath.ts）
 *       目前因尚未決定拆分時機而保留 inline。
 *       再次 refactor 時重新評估是否值得獨立封裝。
 *
 * 邏輯：
 *   - Run mode 且 instance 有 worktreePath → 使用 worktreePath
 *   - 否則 → 使用 pod.workspacePath
 *
 * 路徑安全性驗證：worktreePath 與 pod.workspacePath 均必須在 config.repositoriesRoot 內。
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
          `[resolveWorkspacePath] 工作目錄安全驗證失敗：worktreePath="${instance.worktreePath}" 不在允許範圍 repositoriesRoot="${config.repositoriesRoot}" 內（podId=${pod.id}, runId=${runContext.runId}）`,
        );
        throw new Error("工作目錄驗證失敗");
      }
      return instance.worktreePath;
    }
  }

  // 驗證 pod.workspacePath 必須在 appDataRoot 內，防止 Path Traversal
  // 注意：Pod 一般工作區在 canvasRoot（canvasRoot 是 appDataRoot 的子目錄），
  // Run mode worktree 則在 repositoriesRoot，兩者皆在 appDataRoot 之下。
  if (!isPathWithinDirectory(pod.workspacePath, config.appDataRoot)) {
    logger.error("Chat", "Check", "Pod workspacePath 不在 appDataRoot 內", {
      podId: pod.id,
      workspacePath: pod.workspacePath,
      appDataRoot: config.appDataRoot,
    });
    throw new Error("工作目錄驗證失敗");
  }

  return pod.workspacePath;
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
 *   走進 finalizeAfterStream 把半成品 sessionId 寫入 DB，導致下次 resume 失敗。
 */
async function runProviderStream(
  provider: AgentProvider,
  ctxWithoutSignal: Omit<ChatRequestContext, "abortSignal">,
  queryKey: string,
  abortable: boolean,
  streamContext: StreamContext,
  streamingCallback: (event: StreamEvent) => void,
): Promise<{ aborted: boolean }> {
  // abortRegistry 建立 controller，供外部 abort 呼叫（透過 registry 觸發 signal）
  const abortController = abortRegistry.register(queryKey);
  const ctx: ChatRequestContext = {
    ...ctxWithoutSignal,
    abortSignal: abortController.signal,
  };

  try {
    // 消費 provider.chat(ctx) 的 NormalizedEvent 串流（Claude 與 Codex 共用）
    for await (const ev of provider.chat(ctx)) {
      processNormalizedEvent(ev, streamContext, streamingCallback);
    }
  } finally {
    // 無論串流正常或異常結束，都清理 abortRegistry entry 防 Memory Leak
    abortRegistry.unregister(queryKey);
  }

  if (abortController.signal.aborted && abortable) {
    return { aborted: true };
  }
  return { aborted: false };
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
    // 不將 podId 暴露給 client，改記入 server log 供除錯追查
    logger.error(
      "Chat",
      "Check",
      `[executeStreamingChat] 找不到 Pod（podId=${podId}, canvasId=${options.canvasId}）`,
    );
    throw new Error("找不到 Pod");
  }

  const { pod } = podResult;
  // 取得 pod.name 後立即寫入 streamContext，讓後續 handler（例如 handleErrorEvent）直接從 context 讀取
  streamContext.podName = pod.name;
  const providerName = pod.provider ?? "claude";
  const provider = getProvider(providerName);

  const sessionId = strategy.getSessionId(podId);
  const queryKey = strategy.getQueryKey(podId);
  const runContext = strategy.getRunContext();

  // 串流開始前置處理（Run mode 需在此註冊 active stream）
  strategy.onStreamStart(podId);

  try {
    // 解析工作目錄
    const workspacePath = resolveWorkspacePath(pod, runContext);

    // 建構 Provider 執行時選項
    const providerOptions = await provider.buildOptions(pod, runContext);

    // 組裝 ChatRequestContext（不含 abortSignal，由 runProviderStream 內部注入）
    const ctxWithoutSignal: Omit<ChatRequestContext, "abortSignal"> = {
      podId,
      message,
      workspacePath,
      resumeSessionId: sessionId ?? null,
      runContext,
      options: providerOptions,
    };

    const result = await runProviderStream(
      provider,
      ctxWithoutSignal,
      queryKey,
      abortable,
      streamContext,
      streamingCallback,
    );

    if (result.aborted) {
      return handleStreamAbort(streamContext, callbacks);
    }

    // 串流正常結束後收尾處理（含 session ID 持久化）
    await finalizeAfterStream(streamContext, streamContext.capturedSessionId);

    if (callbacks?.onComplete) {
      await callbacks.onComplete(canvasId, podId);
    }

    return {
      messageId,
      content: streamState.accumulatedContent,
      hasContent: hasAssistantContent(streamState),
      aborted: false,
    };
  } catch (error) {
    return handleExecutionError(error, streamContext, abortable, callbacks);
  }
}
