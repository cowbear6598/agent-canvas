import type { PersistedSubMessage, SystemMessageMetadata } from "../../types";
import { logger } from "../../utils/logger.js";
import type { ChatExecutionStrategy } from "../executionStrategy.js";
import { consumeGoalRuntimeToolResult } from "../goalRuntime.js";
import { podStore } from "../podStore.js";
import { appendSystemMessage } from "../transcriptSystemMessage.js";
import type { NormalizedEvent, ProviderName } from "../provider/types.js";
import { deriveRunResponseSummary } from "../runResponseSummary.js";
import {
  buildProviderErrorSystemMessage,
  shouldLogProviderRawContent,
} from "./streamProviderErrorMessage.js";
import {
  createThrottledPersist,
  type ThrottleContext,
} from "./streamThrottle.js";
import type { StreamEvent } from "./types.js";
import {
  buildPersistedMessage,
  createFlushCurrentSubMessage,
  createSubMessageState,
  processToolResultEvent,
  processToolUseEvent,
} from "./streamEventProcessor.js";

interface MutableStreamState {
  accumulatedContent: string;
  subMessages: PersistedSubMessage[];
}

interface StreamingLifecycleCoordinatorOptions {
  canvasId: string;
  podId: string;
  messageId: string;
  strategy: ChatExecutionStrategy;
  throttleMs: number;
}

interface StreamLifecycleContext {
  canvasId: string;
  podId: string;
  providerName: ProviderName;
  messageId: string;
  streamState: MutableStreamState;
  subMessageState: ReturnType<typeof createSubMessageState>;
  flushCurrentSubMessage: () => void;
  persistStreamingMessage: () => void;
  persistThrottled: () => void;
  throttleContext: ThrottleContext;
  emitStrategy: ReturnType<ChatExecutionStrategy["createEmitStrategy"]>;
  strategy: ChatExecutionStrategy;
}

type TextStreamEvent = Extract<StreamEvent, { type: "text" }>;
type ToolUseStreamEvent = Extract<StreamEvent, { type: "tool_use" }>;
type ToolResultStreamEvent = Extract<StreamEvent, { type: "tool_result" }>;
type CompleteStreamEvent = Extract<StreamEvent, { type: "complete" }>;

function hasAssistantContent(state: MutableStreamState): boolean {
  return state.accumulatedContent.length > 0 || state.subMessages.length > 0;
}

function clearPendingPersistTimer(context: StreamLifecycleContext): void {
  if (context.throttleContext.pendingTimer !== null) {
    clearTimeout(context.throttleContext.pendingTimer);
    context.throttleContext.pendingTimer = null;
  }
}

function flushPendingAssistantMessage(context: StreamLifecycleContext): void {
  clearPendingPersistTimer(context);
  context.flushCurrentSubMessage();

  if (hasAssistantContent(context.streamState)) {
    context.persistStreamingMessage();
  }
}

function handleTextEvent(
  event: TextStreamEvent,
  context: StreamLifecycleContext,
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

  subMessageState.currentSubContent += event.content;
  streamState.accumulatedContent += event.content;

  emitStrategy.emitText({
    canvasId,
    podId,
    messageId,
    content: streamState.accumulatedContent,
    delta: event.content,
  });

  persistThrottled();
}

function handleToolUseEvent(
  event: ToolUseStreamEvent,
  context: StreamLifecycleContext,
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
  context: StreamLifecycleContext,
): void {
  const {
    canvasId,
    podId,
    messageId,
    subMessageState,
    persistThrottled,
    emitStrategy,
  } = context;

  processToolResultEvent(
    event.toolUseId,
    event.output,
    event.toolName,
    subMessageState,
  );

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
  context: StreamLifecycleContext,
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

function dispatchStreamEvent(
  event: StreamEvent,
  context: StreamLifecycleContext,
): void {
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
}

function normalizedEventToStreamEvent(ev: NormalizedEvent): StreamEvent | null {
  switch (ev.type) {
    case "text":
      return { type: "text", content: ev.content };
    case "thinking":
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
    case "session_started":
      return null;
  }
}

function handleProviderErrorEvent(
  event: Extract<NormalizedEvent, { type: "error" }>,
  context: StreamLifecycleContext,
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

export class StreamingLifecycleCoordinator {
  private readonly context: StreamLifecycleContext;
  private capturedSessionIdValue: string | undefined;
  private hadFatalProviderErrorValue = false;

  constructor(options: StreamingLifecycleCoordinatorOptions) {
    const { canvasId, podId, messageId, strategy, throttleMs } = options;
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

    this.context = {
      canvasId,
      podId,
      providerName: "claude",
      messageId,
      streamState,
      subMessageState,
      flushCurrentSubMessage,
      persistStreamingMessage,
      persistThrottled,
      throttleContext,
      emitStrategy,
      strategy,
    };
  }

  get messageId(): string {
    return this.context.messageId;
  }

  get canvasId(): string {
    return this.context.canvasId;
  }

  get podId(): string {
    return this.context.podId;
  }

  get streamState(): MutableStreamState {
    return this.context.streamState;
  }

  get capturedSessionId(): string | undefined {
    return this.capturedSessionIdValue;
  }

  get hadFatalProviderError(): boolean {
    return this.hadFatalProviderErrorValue;
  }

  get providerName(): ProviderName {
    return this.context.providerName;
  }

  setProviderName(providerName: ProviderName): void {
    this.context.providerName = providerName;
  }

  hasAssistantContent(): boolean {
    return hasAssistantContent(this.context.streamState);
  }

  processNormalizedEvent(ev: NormalizedEvent): { aborted: boolean } {
    if (ev.type === "session_started") {
      this.capturedSessionIdValue = ev.sessionId;
      return { aborted: false };
    }

    if (ev.type === "error") {
      const result = handleProviderErrorEvent(ev, this.context);
      if (result.aborted) {
        this.hadFatalProviderErrorValue = true;
      }
      return result;
    }

    if (ev.type === "tool_call_result") {
      const runContext = this.context.strategy.getRunContext();
      const pod = podStore.getByIdGlobal(this.context.podId)?.pod;
      if (pod) {
        consumeGoalRuntimeToolResult(runContext, pod, ev.toolName, ev.output);
      }
    }

    const streamEvent = normalizedEventToStreamEvent(ev);
    if (streamEvent !== null) {
      dispatchStreamEvent(streamEvent, this.context);
    }
    return { aborted: false };
  }

  finalizeAfterStream(): void {
    const { podId, streamState, strategy } = this.context;

    clearPendingPersistTimer(this.context);

    if (hasAssistantContent(streamState)) {
      this.context.persistStreamingMessage();
      strategy.updateLastResponseSummary(
        podId,
        deriveRunResponseSummary(streamState.accumulatedContent),
      );
    }

    strategy.onStreamComplete(podId, this.capturedSessionIdValue);
  }

  abortStream(reason: string): void {
    flushPendingAssistantMessage(this.context);
    this.context.strategy.onStreamAbort(this.context.podId, reason);
  }

  errorStream(): void {
    this.context.strategy.onStreamError(this.context.podId);
  }

  appendSystemMessage(params: {
    content: string;
    metadata: SystemMessageMetadata;
  }): void {
    appendSystemMessage({
      canvasId: this.context.canvasId,
      podId: this.context.podId,
      content: params.content,
      metadata: params.metadata,
      strategy: this.context.strategy,
      emitStrategy: this.context.emitStrategy,
    });
  }
}

export function createStreamingLifecycleCoordinator(
  options: StreamingLifecycleCoordinatorOptions,
): StreamingLifecycleCoordinator {
  return new StreamingLifecycleCoordinator(options);
}
