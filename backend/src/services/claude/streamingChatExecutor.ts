import {v4 as uuidv4} from 'uuid';

import {WebSocketResponseEvents} from '../../schemas';
import {isAbortError} from '../../utils/errorHelpers.js';
import type {
    ContentBlock,
    Message,
    PersistedSubMessage,
} from '../../types';

import {claudeService} from './claudeService.js';
import type {StreamEvent} from './types.js';
import {
    buildPersistedMessage,
    createFlushCurrentSubMessage,
    createSubMessageState,
    processTextEvent,
    processToolResultEvent,
    processToolUseEvent,
} from './streamEventProcessor.js';
import {messageStore} from '../messageStore.js';
import {podStore} from '../podStore.js';
import {runStore} from '../runStore.js';
import {runExecutionService} from '../workflow/runExecutionService.js';
import {socketService} from '../socketService.js';
import {logger} from '../../utils/logger.js';
import type { RunContext } from '../../types/run.js';

interface TextEmitParams {
    canvasId: string;
    podId: string;
    messageId: string;
    content: string;
}

interface ToolUseEmitParams {
    canvasId: string;
    podId: string;
    messageId: string;
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
}

interface ToolResultEmitParams {
    canvasId: string;
    podId: string;
    messageId: string;
    toolUseId: string;
    toolName: string;
    output: string;
}

interface CompleteEmitParams {
    canvasId: string;
    podId: string;
    messageId: string;
    fullContent: string;
}

interface ChatEmitStrategy {
    emitText(params: TextEmitParams): void;
    emitToolUse(params: ToolUseEmitParams): void;
    emitToolResult(params: ToolResultEmitParams): void;
    emitComplete(params: CompleteEmitParams): void;
}

function createNormalEmitStrategy(): ChatEmitStrategy {
    return {
        emitText({canvasId, podId, messageId, content}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE, {
                canvasId,
                podId,
                messageId,
                content,
                isPartial: true,
                role: 'assistant',
            });
        },
        emitToolUse({canvasId, podId, messageId, toolUseId, toolName, input}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_TOOL_USE, {
                canvasId,
                podId,
                messageId,
                toolUseId,
                toolName,
                input,
            });
        },
        emitToolResult({canvasId, podId, messageId, toolUseId, toolName, output}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_TOOL_RESULT, {
                canvasId,
                podId,
                messageId,
                toolUseId,
                toolName,
                output,
            });
        },
        emitComplete({canvasId, podId, messageId, fullContent}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_COMPLETE, {
                canvasId,
                podId,
                messageId,
                fullContent,
            });
        },
    };
}

function createRunEmitStrategy(runId: string): ChatEmitStrategy {
    return {
        emitText({canvasId, podId, messageId, content}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_MESSAGE, {
                runId,
                canvasId,
                podId,
                messageId,
                content,
                isPartial: true,
                role: 'assistant',
            });
        },
        emitToolUse({canvasId, podId, messageId, toolUseId, toolName, input}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CHAT_TOOL_USE, {
                runId,
                canvasId,
                podId,
                messageId,
                toolUseId,
                toolName,
                input,
            });
        },
        emitToolResult({canvasId, podId, messageId, toolUseId, toolName, output}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CHAT_TOOL_RESULT, {
                runId,
                canvasId,
                podId,
                messageId,
                toolUseId,
                toolName,
                output,
            });
        },
        emitComplete({canvasId, podId, messageId, fullContent}): void {
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CHAT_COMPLETE, {
                runId,
                canvasId,
                podId,
                messageId,
                fullContent,
            });
        },
    };
}

export interface StreamingChatExecutorOptions {
    canvasId: string;
    podId: string;
    message: string | ContentBlock[];
    abortable: boolean;
    runContext?: RunContext;
}

export interface StreamingChatExecutorCallbacks {
    onComplete?: (canvasId: string, podId: string) => void | Promise<void>;
    onError?: (canvasId: string, podId: string, error: Error) => void | Promise<void>;
    onAborted?: (canvasId: string, podId: string, messageId: string) => void | Promise<void>;
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
    emitStrategy: ChatEmitStrategy;
    runContext?: RunContext;
}

type TextStreamEvent = Extract<StreamEvent, {type: 'text'}>;
type ToolUseStreamEvent = Extract<StreamEvent, {type: 'tool_use'}>;
type ToolResultStreamEvent = Extract<StreamEvent, {type: 'tool_result'}>;
type CompleteStreamEvent = Extract<StreamEvent, {type: 'complete'}>;
type ErrorStreamEvent = Extract<StreamEvent, {type: 'error'}>;

function handleTextEvent(event: TextStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, streamState, subMessageState, persistStreamingMessage, emitStrategy} = context;

    streamState.accumulatedContent = processTextEvent(event.content, streamState.accumulatedContent, subMessageState);

    emitStrategy.emitText({canvasId, podId, messageId, content: streamState.accumulatedContent});

    persistStreamingMessage();
}

function handleToolUseEvent(event: ToolUseStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, subMessageState, flushCurrentSubMessage, persistStreamingMessage, emitStrategy} = context;

    processToolUseEvent(event.toolUseId, event.toolName, event.input, subMessageState, flushCurrentSubMessage);

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

function handleToolResultEvent(event: ToolResultStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, subMessageState, persistStreamingMessage, emitStrategy} = context;

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

function handleCompleteEvent(_event: CompleteStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, streamState, flushCurrentSubMessage, emitStrategy} = context;

    flushCurrentSubMessage();

    emitStrategy.emitComplete({canvasId, podId, messageId, fullContent: streamState.accumulatedContent});
}

function handleErrorEvent(_event: ErrorStreamEvent, context: StreamContext): void {
    const {canvasId, podId} = context;
    logger.error('Chat', 'Error', `Pod ${podStore.getById(canvasId, podId)?.name ?? podId} streaming 過程發生錯誤`);
}

type StreamEventHandlerMap = {
    [K in StreamEvent['type']]: (event: Extract<StreamEvent, {type: K}>, context: StreamContext) => void;
};

const streamEventHandlers: StreamEventHandlerMap = {
    text: handleTextEvent,
    tool_use: handleToolUseEvent,
    tool_result: handleToolResultEvent,
    complete: handleCompleteEvent,
    error: handleErrorEvent,
};

function createStreamingCallback(context: StreamContext): (event: StreamEvent) => void {
    return (event: StreamEvent) => {
        const handler = streamEventHandlers[event.type] as (event: StreamEvent, context: StreamContext) => void;
        handler(event, context);
    };
}

async function handleStreamAbort(
    context: StreamContext,
    callbacks?: StreamingChatExecutorCallbacks
): Promise<StreamingChatExecutorResult> {
    const {canvasId, podId, messageId, streamState, flushCurrentSubMessage, persistStreamingMessage, runContext} = context;

    flushCurrentSubMessage();

    const hasAssistantContent = streamState.accumulatedContent.length > 0 || streamState.subMessages.length > 0;
    if (hasAssistantContent) {
        persistStreamingMessage();
    }

    if (runContext) {
        runExecutionService.unregisterActiveStream(runContext.runId, podId);
        runExecutionService.errorPodInstance(runContext, podId, '使用者中斷執行');
    } else {
        podStore.setStatus(canvasId, podId, 'idle');
    }

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
    callbacks?: StreamingChatExecutorCallbacks
): Promise<never> {
    const {canvasId, podId, runContext} = context;

    if (!runContext) {
        podStore.setStatus(canvasId, podId, 'idle');
    }

    if (callbacks?.onError) {
        await callbacks.onError(canvasId, podId, error as Error);
    }

    throw error;
}

function setupStreamContext(options: StreamingChatExecutorOptions): StreamContext {
    const {canvasId, podId, runContext} = options;

    const messageId = uuidv4();
    const subMessageState = createSubMessageState();
    const streamState: MutableStreamState = {accumulatedContent: '', subMessages: subMessageState.subMessages};
    const flushCurrentSubMessage = createFlushCurrentSubMessage(messageId, subMessageState);

    const persistStreamingMessage = (): void => {
        const persistedMsg = buildPersistedMessage(messageId, streamState.accumulatedContent, subMessageState);
        if (runContext) {
            runStore.upsertRunMessage(runContext.runId, podId, persistedMsg);
        } else {
            messageStore.upsertMessage(canvasId, podId, persistedMsg);
        }
    };

    const emitStrategy = runContext
        ? createRunEmitStrategy(runContext.runId)
        : createNormalEmitStrategy();

    return {
        canvasId,
        podId,
        messageId,
        streamState,
        subMessageState,
        flushCurrentSubMessage,
        persistStreamingMessage,
        emitStrategy,
        runContext,
    };
}

async function finalizeAfterStream(
    context: StreamContext,
    resultMessage: Message,
    runInstance: Awaited<ReturnType<typeof runStore.getPodInstance>> | undefined
): Promise<void> {
    const {canvasId, podId, streamState, persistStreamingMessage, runContext} = context;

    const hasAssistantContent = streamState.accumulatedContent.length > 0 || streamState.subMessages.length > 0;
    if (hasAssistantContent) {
        persistStreamingMessage();
    }

    if (runContext) {
        runExecutionService.unregisterActiveStream(runContext.runId, podId);
        // 串流完成後，將最新的 sessionId 寫回 run instance
        if (resultMessage.sessionId && runInstance) {
            runStore.updatePodInstanceClaudeSessionId(runInstance.id, resultMessage.sessionId);
        }
    } else {
        podStore.setStatus(canvasId, podId, 'idle');
    }
}

/**
 * run mode 與非 run mode 的差異點超過閾值，加此說明：
 * - 有 runContext → 使用 run-specific session、key、store，不改 pod 全域狀態
 * - 無 runContext → 維持原有行為
 */
export async function executeStreamingChat(
    options: StreamingChatExecutorOptions,
    callbacks?: StreamingChatExecutorCallbacks
): Promise<StreamingChatExecutorResult> {
    const {podId, message, abortable, runContext} = options;

    const streamContext = setupStreamContext(options);
    const {canvasId, messageId, streamState} = streamContext;
    const streamingCallback = createStreamingCallback(streamContext);

    // run mode：從 instance 取得 session，並以 runId:podId 作為 query key
    let runInstance: Awaited<ReturnType<typeof runStore.getPodInstance>> | undefined;
    if (runContext) {
        runInstance = runStore.getPodInstance(runContext.runId, podId);
        runExecutionService.registerActiveStream(runContext.runId, podId);
    }

    try {
        const runOptions = runContext ? {
            sessionId: runInstance?.claudeSessionId ?? undefined,
            queryKey: `${runContext.runId}:${podId}`,
            runContext,
        } : undefined;

        const resultMessage = await claudeService.sendMessage(podId, message, streamingCallback, runOptions);

        await finalizeAfterStream(streamContext, resultMessage, runInstance);

        if (callbacks?.onComplete) {
            await callbacks.onComplete(canvasId, podId);
        }

        const hasAssistantContent = streamState.accumulatedContent.length > 0 || streamState.subMessages.length > 0;

        return {
            messageId,
            content: streamState.accumulatedContent,
            hasContent: hasAssistantContent,
            aborted: false,
        };
    } catch (error) {
        if (runContext) {
            runExecutionService.unregisterActiveStream(runContext.runId, podId);
        }

        if (isAbortError(error) && abortable) {
            return handleStreamAbort(streamContext, callbacks);
        }

        return handleStreamError(streamContext, error, callbacks);
    }
}
