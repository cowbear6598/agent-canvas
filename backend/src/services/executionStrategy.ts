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
 * Run mode 的執行策略：狀態寫入 runExecutionService、訊息寫入 runStore、使用 RUN 事件。
 */
export class ChatExecutionStrategy {
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

  getRunContext(): RunContext | undefined {
    return this.runContext;
  }
}
