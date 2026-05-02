import { v4 as uuidv4 } from "uuid";

import {
  isAbortError,
  InvalidWorkspaceError,
  ProviderNotFoundError,
} from "../../utils/errorHelpers.js";
import type { ContentBlock, PersistedSubMessage } from "../../types";
import type { Pod } from "../../types/pod.js";

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
  ProviderName,
  ProviderSystemMessage,
} from "../provider/types.js";
import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/index.js";
import { createI18nError } from "../../utils/i18nError.js";
import { appendSystemMessage } from "../transcriptSystemMessage.js";
import { resolveExecutionPaths } from "../runtime/executionPaths.js";

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

function hasAssistantContent(state: MutableStreamState): boolean {
  return state.accumulatedContent.length > 0 || state.subMessages.length > 0;
}

/**
 * 串流節流窗口（ms）。
 * 每秒最多 5 次 DB 寫入，平衡 UX 即時性（使用者感受 < 200ms 延遲）與 DB 寫入頻率，
 * 避免高頻串流時造成 SQLite write lock 競爭。
 */
const THROTTLE_MS = 200;

/**
 * 節流持久化的可變狀態，從 StreamContext 中獨立出來，
 * 避免與串流事件狀態混雜，也不需要 getter/setter proxy 橋接。
 */
interface ThrottleContext {
  /** 節流 timer handle，供 finalize / abort 清除待排程的舊 timer */
  pendingTimer: ReturnType<typeof setTimeout> | null;
  /** 上次實際寫入 DB 的時間戳（ms），初始值 0 */
  lastPersistAt: number;
}

/**
 * 串流事件狀態 + 執行策略兩類關注點的集合體。
 * streamingCallback 不存放於此，改以傳參方式注入各使用方，避免初始化順序問題。
 */
interface StreamContext {
  canvasId: string;
  podId: string;
  providerName: ProviderName;
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
  /** 節流狀態，供 finalize / abort 清除 timer */
  throttleContext: ThrottleContext;
  emitStrategy: ReturnType<ExecutionStrategy["createEmitStrategy"]>;
  strategy: ExecutionStrategy;
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

function flushPendingAssistantMessage(context: StreamContext): void {
  const {
    streamState,
    flushCurrentSubMessage,
    persistStreamingMessage,
    throttleContext,
  } = context;

  if (throttleContext.pendingTimer !== null) {
    clearTimeout(throttleContext.pendingTimer);
    throttleContext.pendingTimer = null;
  }

  flushCurrentSubMessage();

  if (hasAssistantContent(streamState)) {
    persistStreamingMessage();
  }
}

function buildProviderErrorSystemMessage(
  event: Extract<NormalizedEvent, { type: "error" }>,
  providerName: ProviderName,
): ProviderSystemMessage {
  if (event.systemMessage) {
    return event.systemMessage;
  }

  return {
    role: "system",
    content: event.message,
    metadata: {
      provider: providerName,
      code: event.code ?? null,
      severity: event.fatal ? "fatal" : "error",
      rawContent: event.message,
    },
  };
}

const DETAILED_PROVIDER_ERROR_CODES = new Set([
  "STREAM_ERROR",
  "EXIT_CODE",
  "RESULT_ERROR",
]);

function shouldLogProviderRawContent(code: string | null): boolean {
  return code === null || DETAILED_PROVIDER_ERROR_CODES.has(code);
}

/**
 * 將 provider 串流錯誤事件寫入 transcript system message。
 *
 * 回傳值：
 *   - `aborted=true` 代表 fatal event，呼叫端應中止 event 處理迴圈，
 *     但**不**透過 throw — 改由 caller 走正常 finalize 收尾路徑，
 *     避免錯誤冒泡到 wsMiddleware 觸發前端全域 toast。
 *   - `aborted=false` 代表非 fatal，呼叫端應繼續處理後續事件。
 */
function handleProviderErrorEvent(
  event: Extract<NormalizedEvent, { type: "error" }>,
  context: StreamContext,
): { aborted: boolean } {
  const { canvasId, podId, providerName, strategy } = context;
  const systemMessage = buildProviderErrorSystemMessage(event, providerName);
  const code = systemMessage.metadata.code ?? null;
  const shouldLogRaw = shouldLogProviderRawContent(code);

  if (shouldLogRaw) {
    logger.error(
      "Chat",
      "Error",
      `Provider 串流錯誤（podId=${podId}, canvasId=${canvasId}, provider=${providerName}, fatal=${event.fatal}, code=${code ?? "無"}）：${systemMessage.metadata.rawContent}`,
    );
  } else {
    logger.error(
      "Chat",
      "Error",
      `Provider 串流錯誤（podId=${podId}, canvasId=${canvasId}, provider=${providerName}, fatal=${event.fatal}, code=${code ?? "無"}）`,
    );
  }

  flushPendingAssistantMessage(context);
  // 傳入已建立的 emitStrategy（來自 StreamContext），避免重複呼叫 createEmitStrategy()
  appendSystemMessage({
    canvasId,
    podId,
    content: systemMessage.content,
    metadata: systemMessage.metadata,
    strategy,
    emitStrategy: context.emitStrategy,
  });

  return { aborted: event.fatal === true };
}

/**
 * 建立串流事件回呼（streamingCallback）。
 * 不需要 callback 的 handler 直接接受 (event, context)；
 * handleErrorEvent 以 callback 閉包方式傳入，保持初始化順序安全。
 */
function createStreamingCallback(
  context: StreamContext,
): (event: StreamEvent) => void {
  const callback = (event: StreamEvent): void => {
    switch (event.type) {
      case "text":
        handleTextEvent(event, context);
        break;
      case "tool_use":
        handleToolUseEvent(event, context);
        break;
      case "tool_result":
        handleToolResultEvent(event, context);
        break;
      case "complete":
        handleCompleteEvent(event, context);
        break;
    }
  };
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
    throttleContext,
  } = context;

  // 清除節流 timer，避免最終 persist 後又被舊 timer 覆寫
  if (throttleContext.pendingTimer !== null) {
    clearTimeout(throttleContext.pendingTimer);
    throttleContext.pendingTimer = null;
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

/**
 * 嘗試將錯誤對應到具體的 WebSocket 錯誤碼、i18n key，以及對外顯示的固定中文訊息。
 *
 * - InvalidWorkspaceError（路徑穿越 / 工作目錄非法）→ { code: "INVALID_PATH", ... }
 * - ProviderNotFoundError（Provider 不存在 / buildOptions 失敗）→ { code: "PROVIDER_NOT_FOUND", ... }
 * - 其他無法分類的錯誤 → null（由呼叫端決定如何處理）
 *
 * content 為對外顯示的固定中文訊息，不透傳 error.message 以避免洩漏內部細節。
 * 改用 instanceof 而非硬編碼字串比對，避免訊息修改導致分類失效。
 */
function classifyKnownError(error: unknown): {
  code: string;
  i18nKey: string;
  /** 對外顯示的固定中文訊息，不含原始 error.message */
  content: string;
} | null {
  if (error instanceof InvalidWorkspaceError) {
    return {
      code: "INVALID_PATH",
      i18nKey: "errors.invalidWorkspacePath",
      content: "工作目錄路徑無效或存取遭拒，請確認 Pod 設定後重試。",
    };
  }
  if (error instanceof ProviderNotFoundError) {
    return {
      code: "PROVIDER_NOT_FOUND",
      i18nKey: "errors.providerNotFound",
      content: "找不到對應的 AI Provider，請確認 Pod 設定後重試。",
    };
  }
  return null;
}

async function handleStreamError(
  context: StreamContext,
  error: unknown,
  callbacks?: StreamingChatExecutorCallbacks,
): Promise<StreamingChatExecutorResult> {
  const { canvasId, podId, messageId, streamState, strategy } = context;

  const classified = classifyKnownError(error);

  if (classified) {
    // 已知的業務錯誤（路徑穿越、Provider 不可用）：發送具體錯誤給前端，不再拋出
    strategy.onStreamError(podId);

    // 原始 error.message 只進 logger，不洩漏給前端
    logger.error(
      "Chat",
      "Error",
      `[handleStreamError] 已知業務錯誤（podId=${podId}, canvasId=${canvasId}, code=${classified.code}）：${error instanceof Error ? error.message : String(error)}`,
    );

    // 傳入已建立的 emitStrategy（來自 StreamContext），避免重複呼叫 createEmitStrategy()
    appendSystemMessage({
      canvasId,
      podId,
      // 對外顯示固定中文訊息，不含 error.message 以避免洩漏內部細節
      content: classified.content,
      metadata: {
        provider: context.providerName,
        code: classified.code,
        severity: "fatal",
        // rawContent 僅供內部除錯用，不顯示於前端 UI
        rawContent: error instanceof Error ? error.message : String(error),
      },
      strategy,
      emitStrategy: context.emitStrategy,
    });

    return {
      messageId,
      content: streamState.accumulatedContent,
      hasContent: hasAssistantContent(streamState),
      aborted: false,
    };
  }

  // 未分類錯誤（串流中斷、AbortError、其他預期外錯誤）：維持既有行為，向上拋出
  strategy.onStreamError(podId);

  if (callbacks?.onError) {
    await callbacks.onError(canvasId, podId, error as Error);
  }

  throw error;
}

/**
 * 建立節流持久化函式與對應的 ThrottleContext。
 *
 * - 距上次寫入 >= throttleMs 時立即寫入
 * - 否則排程 setTimeout 到下個窗口開頭寫入最後一次 payload
 * - 同一窗口內多次呼叫只排一個 timer，並使用最新 payload（閉包自動取最新 streamState）
 */
function createThrottledPersist(
  persistFn: () => void,
  throttleMs: number,
): { persistThrottled: () => void; throttleContext: ThrottleContext } {
  const throttleContext: ThrottleContext = {
    lastPersistAt: 0,
    pendingTimer: null,
  };

  const persistThrottled = (): void => {
    const now = Date.now();
    if (now - throttleContext.lastPersistAt >= throttleMs) {
      throttleContext.lastPersistAt = now;
      persistFn();
    } else if (throttleContext.pendingTimer === null) {
      const delay = throttleMs - (now - throttleContext.lastPersistAt);
      throttleContext.pendingTimer = setTimeout(() => {
        throttleContext.pendingTimer = null;
        // lastPersistAt 在呼叫 persistFn 之前更新，防止下一個事件誤判窗口已過造成雙寫
        throttleContext.lastPersistAt = Date.now();
        persistFn();
      }, delay);
    }
  };

  return { persistThrottled, throttleContext };
}

/** createPersistenceContext 的回傳結構，包含 persistence/throttle 所需的所有元件 */
interface PersistenceContext {
  persistStreamingMessage: () => void;
  persistThrottled: () => void;
  throttleContext: ThrottleContext;
}

/**
 * 負責建立 persistStreamingMessage closure 並組合節流機制，
 * 回傳整合後的 persistence/throttle 元件。
 * setupStreamContext 透過此函式取得 persist 相關元件，不直接接觸細節。
 */
function createPersistenceContext(
  messageId: string,
  subMessageState: ReturnType<typeof createSubMessageState>,
  streamState: MutableStreamState,
  strategy: StreamingChatExecutorOptions["strategy"],
  podId: string,
  throttleMs: number,
): PersistenceContext {
  const persistStreamingMessage = (): void => {
    const persistedMsg = buildPersistedMessage(
      messageId,
      streamState.accumulatedContent,
      subMessageState,
    );
    strategy.persistMessage(podId, persistedMsg);
  };

  const { persistThrottled, throttleContext } = createThrottledPersist(
    persistStreamingMessage,
    throttleMs,
  );

  return { persistStreamingMessage, persistThrottled, throttleContext };
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

  const emitStrategy = strategy.createEmitStrategy();

  // 由 createPersistenceContext 負責建立 persist closure 與 throttle 元件
  const { persistStreamingMessage, persistThrottled, throttleContext } =
    createPersistenceContext(
      messageId,
      subMessageState,
      streamState,
      strategy,
      podId,
      THROTTLE_MS,
    );

  const context: StreamContext = {
    canvasId,
    podId,
    providerName: "claude",
    // pod.name 尚未取得，先以 podId 填入；executeStreamingChat 取得 pod 後會覆寫
    podName: podId,
    messageId,
    streamState,
    subMessageState,
    flushCurrentSubMessage,
    persistStreamingMessage,
    persistThrottled,
    throttleContext,
    emitStrategy,
    strategy,
    // session_started 事件由 processNormalizedEvent 寫入；初始值 undefined
    capturedSessionId: undefined,
  };

  return context;
}

async function finalizeAfterStream(
  context: StreamContext,
  sessionId: string | undefined,
): Promise<void> {
  const {
    streamState,
    persistStreamingMessage,
    podId,
    strategy,
    throttleContext,
  } = context;

  // 清除節流 timer，避免最終 persist 後又被舊 timer 覆寫
  if (throttleContext.pendingTimer !== null) {
    clearTimeout(throttleContext.pendingTimer);
    throttleContext.pendingTimer = null;
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
 * `thinking` 暫走 text 路徑（前端不區分）。
 * `session_started` 回傳 null（由呼叫端寫入 capturedSessionId，不直接轉 StreamEvent）。
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
      return null;
    case "session_started":
      return null;
  }
}

/**
 * 處理單一正規化串流事件：
 *   - session_started → 寫入 streamContext.capturedSessionId，供 finalizeAfterStream 持久化
 *   - error → 直接落成 transcript system message；fatal=true 時回傳 aborted=true 通知呼叫端中止
 *   - 其餘事件 → 透過 normalizedEventToStreamEvent 轉換後交由 streamingCallback 分派
 *
 * 回傳值 `aborted=true` 代表收到 fatal error，由呼叫端 break 出迴圈走正常 finalize 路徑，
 * 不再 throw 出 generator/executor，避免錯誤冒泡到 wsMiddleware 觸發前端全域 toast。
 */
function processNormalizedEvent(
  ev: NormalizedEvent,
  streamContext: StreamContext,
  streamingCallback: (event: StreamEvent) => void,
): { aborted: boolean } {
  if (ev.type === "session_started") {
    streamContext.capturedSessionId = ev.sessionId;
    return { aborted: false };
  }

  if (ev.type === "error") {
    return handleProviderErrorEvent(ev, streamContext);
  }

  const streamEvent = normalizedEventToStreamEvent(ev);
  if (streamEvent !== null) {
    streamingCallback(streamEvent);
  }
  return { aborted: false };
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
      const result = processNormalizedEvent(
        ev,
        streamContext,
        streamingCallback,
      );
      if (result.aborted) {
        // fatal error event：transcript system message 已寫入，
        // 中止迴圈但不 throw，由呼叫端走正常 finalize 收尾。
        break;
      }
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
 * 同時將 pod 資訊寫入 streamContext，讓後續 handler 直接從 context 讀取。
 * resolveWorkspacePath 與 provider.buildOptions 可能拋出錯誤，由呼叫端的 try-catch 統一交給 handleExecutionError。
 */
async function resolveExecutionDependencies(
  options: StreamingChatExecutorOptions,
  streamContext: StreamContext,
  pod: Pod,
): Promise<ExecutionDependencies> {
  const { podId, message, strategy } = options;

  // 取得 pod.name 後立即寫入 streamContext，讓後續 handler（例如 handleErrorEvent）直接從 context 讀取
  streamContext.podName = pod.name;
  const providerName = pod.provider ?? "claude";
  streamContext.providerName = providerName;
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
    message,
    workspacePath: executionPaths.workspacePath,
    sandboxHomePath: executionPaths.sandboxHomePath,
    resumeSessionId: sessionId ?? null,
    runContext,
    options: providerOptions,
  };

  return { provider, queryKey, ctxWithoutSignal };
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
  const { abortable, strategy } = options;

  // 設定串流上下文
  const streamContext = setupStreamContext(options);
  const { canvasId, podId, messageId, streamState } = streamContext;
  const streamingCallback = createStreamingCallback(streamContext);

  // Pod 不存在：直接 early return（不需要 onStreamStart / try-catch）
  const podResult = podStore.getByIdGlobal(podId);
  if (!podResult) {
    emitPodNotFoundError(canvasId, podId);
    return { messageId, content: "", hasContent: false, aborted: false };
  }

  // 串流開始前置處理（Run mode 需在此註冊 active stream）
  strategy.onStreamStart(podId);

  try {
    // 查詢期：解析執行所需的所有依賴（pod 已確認存在，此處執行 provider/session/ctxWithoutSignal 組裝）
    // resolveWorkspacePath 與 provider.buildOptions 可能拋出錯誤，由外層 catch 統一交給 handleExecutionError
    const depsResult = await resolveExecutionDependencies(
      options,
      streamContext,
      podResult.pod,
    );

    const { provider, queryKey, ctxWithoutSignal } = depsResult;

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
