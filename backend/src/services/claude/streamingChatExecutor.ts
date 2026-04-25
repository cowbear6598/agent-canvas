import { v4 as uuidv4 } from "uuid";

import { isAbortError } from "../../utils/errorHelpers.js";
import type { ContentBlock, PersistedSubMessage } from "../../types";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";

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
import { resolvePodCwd } from "../shared/podPathResolver.js";

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
type ErrorStreamEvent = Extract<StreamEvent, { type: "error" }>;

function handleTextEvent(
  event: TextStreamEvent,
  context: StreamContext,
  _streamingCallback: (event: StreamEvent) => void,
): void {
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
  _streamingCallback: (event: StreamEvent) => void,
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
  _streamingCallback: (event: StreamEvent) => void,
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

// `_event`、`_streamingCallback` 參數未使用，遵守 no-unused-vars 規則保留 `_` 前綴
function handleCompleteEvent(
  _event: CompleteStreamEvent,
  context: StreamContext,
  _streamingCallback: (event: StreamEvent) => void,
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

/**
 * 可直接顯示給使用者的錯誤代碼白名單。
 * 白名單內的 code 代表「可恢復的使用者操作錯誤」，訊息已在產生端組裝成使用者友善格式，
 * 可直接推送給前端；不在白名單內的 code 一律以通用警告文字取代，避免洩漏系統內部細節。
 */
const RECOVERABLE_CODES = new Set(["COMMAND_NOT_FOUND"]);

/** 訊息長度上限，避免惡意長訊息灌版 */
const MAX_USER_FACING_MSG_LENGTH = 500;

function handleErrorEvent(
  event: ErrorStreamEvent,
  context: StreamContext,
  streamingCallback: (event: StreamEvent) => void,
): void {
  const { canvasId, podId } = context;

  // 原始錯誤訊息記入 server log，不暴露給前端
  logger.error(
    "Chat",
    "Error",
    `Provider 串流錯誤（podId=${podId}, canvasId=${canvasId}, fatal=${event.fatal}, code=${event.code ?? "無"}）：${event.error}`,
  );

  // 判斷是否為可直接顯示給使用者的可恢復錯誤
  const isRecoverable =
    event.code !== undefined && RECOVERABLE_CODES.has(event.code);

  let displayMessage: string;
  if (isRecoverable) {
    // 白名單內的 code：使用產生端組裝的使用者友善訊息，並限制長度防止灌版
    const truncated =
      event.error.length > MAX_USER_FACING_MSG_LENGTH
        ? event.error.slice(0, MAX_USER_FACING_MSG_LENGTH) + "…"
        : event.error;
    displayMessage = `\n\n⚠️ ${truncated}`;
  } else {
    // 無 code 或不在白名單：使用通用警告，不洩漏原始訊息
    displayMessage = event.fatal
      ? "\n\n⚠️ 發生嚴重錯誤，對話已中斷"
      : "\n\n⚠️ 發生錯誤，請稍後再試";
  }

  streamingCallback({ type: "text", content: displayMessage });

  if (event.fatal) {
    throw new Error("串流處理發生嚴重錯誤");
  }
}

type StreamEventHandlerMap = {
  [K in StreamEvent["type"]]: (
    event: Extract<StreamEvent, { type: K }>,
    context: StreamContext,
    streamingCallback: (event: StreamEvent) => void,
  ) => void;
};

/**
 * 建立串流事件回呼（streamingCallback）。
 * callback 作為閉包傳入 handleErrorEvent，解決 callback 依賴 context 的初始化順序問題，
 * 不再需要把 callback 回寫至 context 欄位。
 */
function createStreamingCallback(
  context: StreamContext,
): (event: StreamEvent) => void {
  // 分派表：各 event handler 接受 streamingCallback 以便 handleErrorEvent 推送警告文字
  const handlers: StreamEventHandlerMap = {
    text: handleTextEvent,
    tool_use: handleToolUseEvent,
    tool_result: handleToolResultEvent,
    complete: handleCompleteEvent,
    error: handleErrorEvent,
  };

  const callback = (event: StreamEvent): void => {
    const handler = handlers[event.type] as (
      event: StreamEvent,
      context: StreamContext,
      cb: (e: StreamEvent) => void,
    ) => void;
    handler(event, context, callback);
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

  // 節流狀態獨立封裝為 ThrottleContext（不使用 getter/setter proxy，直接傳遞物件參照）
  const throttleContext: ThrottleContext = {
    lastPersistAt: 0,
    pendingTimer: null,
  };

  /**
   * 節流版 persistStreamingMessage：
   * - 距上次寫入 >= THROTTLE_MS 時立即寫入
   * - 否則排程 setTimeout 到下個窗口開頭寫入最後一次 payload
   * - 同一窗口內多次呼叫只排一個 timer，並使用最新 payload（閉包自動取最新 streamState）
   */
  const persistThrottled = (): void => {
    const now = Date.now();
    if (now - throttleContext.lastPersistAt >= THROTTLE_MS) {
      // 窗口已過，立即寫入並更新時間戳
      throttleContext.lastPersistAt = now;
      persistStreamingMessage();
    } else if (throttleContext.pendingTimer === null) {
      // 窗口內尚無待排程 timer，新增一個；不重複排程
      const delay = THROTTLE_MS - (now - throttleContext.lastPersistAt);
      throttleContext.pendingTimer = setTimeout(() => {
        throttleContext.pendingTimer = null;
        throttleContext.lastPersistAt = Date.now();
        persistStreamingMessage();
      }, delay);
    }
    // 已有 pending timer：payload 由閉包保持最新，不需重排
  };

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
      return {
        type: "error",
        error: ev.message,
        fatal: ev.fatal,
        code: ev.code,
      };
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
 * 邏輯：
 *   - Run mode 且 instance 有 worktreePath → 使用 worktreePath（驗證在 repositoriesRoot 內）
 *   - 非 Run mode → 委由 resolvePodCwd(pod) 統一解析：
 *     - 有 repositoryId → 使用 repositoriesRoot / repositoryId（驗證路徑在 repositoriesRoot 內）
 *     - 否則 → 使用 pod.workspacePath（驗證在 canvasRoot 內）
 *
 * 路徑驗證失敗時直接拋錯，由上層回報錯誤給前端，不做 silent fallback。
 */
function resolveWorkspacePath(pod: Pod, runContext?: RunContext): string {
  // Run mode worktree 分支：沿用原本邏輯，驗證 worktreePath 在 repositoriesRoot 內
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

  // 非 Run mode：cwd 由 resolvePodCwd 統一解析，
  // repositoryId 路徑與 workspacePath 兩條分支皆由 helper 處理（含路徑安全驗證）。
  return resolvePodCwd(pod);
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
    // message 已由上層 handler 展開 Command 內容（或為原始訊息，若無 Command）
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
