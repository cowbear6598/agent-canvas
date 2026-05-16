import type { PersistedMessage } from "../types/persistence.js";
import type { RunContext } from "../types/run.js";
import type { ContentBlock } from "../types/index.js";
import type { SystemMessageMetadata } from "../types/message.js";
import { runStore } from "./runStore.js";
import { runExecutionService } from "./workflow/runExecutionService.js";
import { injectRunUserMessage } from "../utils/runChatHelpers.js";
import { createChatEmitStrategy } from "./chatEmitStrategy.js";

/**
 * 事件發送策略介面，負責 Run mode 的 WebSocket 事件發送。
 */
export interface ChatEmitStrategy {
  emitText(params: {
    canvasId: string;
    podId: string;
    messageId: string;
    content: string;
  }): void;
  emitToolUse(params: {
    canvasId: string;
    podId: string;
    messageId: string;
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
  }): void;
  emitToolResult(params: {
    canvasId: string;
    podId: string;
    messageId: string;
    toolUseId: string;
    toolName: string;
    output: string;
  }): void;
  emitComplete(params: {
    canvasId: string;
    podId: string;
    messageId: string;
    fullContent: string;
  }): void;
  emitSystemMessage(params: {
    canvasId: string;
    podId: string;
    messageId: string;
    content: string;
    metadata: SystemMessageMetadata;
  }): void;
}

/**
 * Chat 執行階段的策略介面，統一管理 Run mode 的執行行為。
 * 狀態寫入 runExecutionService、訊息寫入 runStore、使用 RUN 事件。
 */
export interface ExecutionStrategy {
  /**
   * 取得 Claude session ID（runPodInstance.sessionId）。
   */
  getSessionId(podId: string): string | undefined;

  /**
   * 取得 activeQueries 的查詢 key。
   *
   * 回傳 `${runId}:${podId}`，允許同一 pod 在不同 Run 中並行執行查詢，
   * 避免不同 Run 的查詢 key 互相覆蓋。
   */
  getQueryKey(podId: string): string;

  /**
   * 建立對應的事件發送策略（使用 RUN 事件）。
   */
  createEmitStrategy(): ChatEmitStrategy;

  /**
   * 儲存訊息到持久層（runStore.upsertRunMessage）。
   */
  persistMessage(podId: string, message: PersistedMessage): void;

  /**
   * 注入使用者訊息（存 DB + 廣播前端，不改 pod 全域狀態）。
   */
  addUserMessage(
    podId: string,
    content: string | ContentBlock[],
  ): Promise<void>;

  /**
   * 檢查 Pod 是否正在忙碌中。固定回傳 false（由 Run 排程自行管理）。
   */
  isBusy(podId: string): boolean;

  /**
   * 串流正常完成時的收尾處理：unregisterActiveStream + runStore 寫入 session ID 到 instance。
   */
  onStreamComplete(podId: string, sessionId: string | undefined): void;

  /**
   * 串流開始時的前置處理：向 runExecutionService 註冊 active stream。
   */
  onStreamStart(podId: string): void;

  /**
   * 串流被使用者中斷時的收尾處理：unregisterActiveStream + errorPodInstance。
   */
  onStreamAbort(podId: string, reason: string): void;

  /**
   * 串流發生非中斷錯誤時的收尾處理：unregisterActiveStream（錯誤由上層透過 WorkflowStatusDelegate 處理）。
   */
  onStreamError(podId: string): void;

  /**
   * 回傳 Run 模式的執行上下文；非 Run 模式回傳 undefined。
   */
  getRunContext(): RunContext | undefined;
}

/**
 * Chat ExecutionStrategy 的唯一實作（Run mode）。
 * 狀態寫入 runExecutionService、訊息寫入 runStore、使用 RUN 事件。
 */
export class ChatExecutionStrategy implements ExecutionStrategy {
  constructor(
    private readonly canvasId: string,
    private readonly runContext: RunContext,
  ) {}

  getSessionId(podId: string): string | undefined {
    const instance = runStore.getPodInstance(this.runContext.runId, podId);
    return instance?.sessionId ?? undefined;
  }

  getQueryKey(podId: string): string {
    return `${this.runContext.runId}:${podId}`;
  }

  createEmitStrategy(): ChatEmitStrategy {
    return createChatEmitStrategy(this.runContext.runId);
  }

  persistMessage(podId: string, message: PersistedMessage): void {
    runStore.upsertRunMessage(this.runContext.runId, podId, message);
  }

  async addUserMessage(
    podId: string,
    content: string | ContentBlock[],
  ): Promise<void> {
    await injectRunUserMessage(this.runContext, podId, content);
  }

  isBusy(_podId: string): boolean {
    // Run mode 不排隊，固定回傳 false
    return false;
  }

  onStreamComplete(podId: string, sessionId: string | undefined): void {
    runExecutionService.unregisterActiveStream(this.runContext.runId, podId);
    if (sessionId) {
      const instance = runStore.getPodInstance(this.runContext.runId, podId);
      if (instance) {
        runStore.updatePodInstanceSessionId(instance.id, sessionId);
      }
    }
  }

  onStreamStart(podId: string): void {
    runExecutionService.registerActiveStream(this.runContext.runId, podId);
  }

  onStreamAbort(podId: string, reason: string): void {
    runExecutionService.unregisterActiveStream(this.runContext.runId, podId);
    runExecutionService.errorPodInstance(this.runContext, podId, reason);
  }

  onStreamError(podId: string): void {
    runExecutionService.unregisterActiveStream(this.runContext.runId, podId);
  }

  getRunContext(): RunContext {
    return this.runContext;
  }
}
