import {v4 as uuidv4} from 'uuid';

import {WebSocketResponseEvents} from '../../schemas';
import {isAbortError} from '../../utils/errorHelpers.js';
import type {
    ContentBlock,
    PodChatCompletePayload,
    PodChatMessagePayload,
    PodChatToolResultPayload,
    PodChatToolUsePayload,
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
import type { RunMessagePayload, RunChatCompletePayload } from '../../types/run.js';

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

interface StreamContext {
    canvasId: string;
    podId: string;
    messageId: string;
    contentBuffer: { value: string };
    subMessageState: ReturnType<typeof createSubMessageState>;
    flushCurrentSubMessage: () => void;
    persistStreamingMessage: () => void;
    runContext?: RunContext;
}

type TextStreamEvent = Extract<StreamEvent, {type: 'text'}>;
type ToolUseStreamEvent = Extract<StreamEvent, {type: 'tool_use'}>;
type ToolResultStreamEvent = Extract<StreamEvent, {type: 'tool_result'}>;
type CompleteStreamEvent = Extract<StreamEvent, {type: 'complete'}>;
type ErrorStreamEvent = Extract<StreamEvent, {type: 'error'}>;

function handleTextEvent(event: TextStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, contentBuffer, subMessageState, persistStreamingMessage, runContext} = context;

    contentBuffer.value = processTextEvent(event.content, contentBuffer.value, subMessageState);

    if (runContext) {
        const runTextPayload: RunMessagePayload = {
            runId: runContext.runId,
            canvasId,
            podId,
            messageId,
            content: contentBuffer.value,
            isPartial: true,
            role: 'assistant',
        };
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_MESSAGE, runTextPayload);
    } else {
        const textPayload: PodChatMessagePayload = {
            canvasId,
            podId,
            messageId,
            content: contentBuffer.value,
            isPartial: true,
            role: 'assistant',
        };
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE, textPayload);
    }

    persistStreamingMessage();
}

function handleToolUseEvent(event: ToolUseStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, subMessageState, flushCurrentSubMessage, persistStreamingMessage, runContext} = context;

    processToolUseEvent(event.toolUseId, event.toolName, event.input, subMessageState, flushCurrentSubMessage);

    if (runContext) {
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CHAT_TOOL_USE, {
            runId: runContext.runId,
            canvasId,
            podId,
            messageId,
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            input: event.input,
        });
    } else {
        const toolUsePayload: PodChatToolUsePayload = {
            canvasId,
            podId,
            messageId,
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            input: event.input,
        };
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_TOOL_USE, toolUsePayload);
    }

    persistStreamingMessage();
}

function handleToolResultEvent(event: ToolResultStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, subMessageState, persistStreamingMessage, runContext} = context;

    processToolResultEvent(event.toolUseId, event.output, subMessageState);

    if (runContext) {
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CHAT_TOOL_RESULT, {
            runId: runContext.runId,
            canvasId,
            podId,
            messageId,
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            output: event.output,
        });
    } else {
        const toolResultPayload: PodChatToolResultPayload = {
            canvasId,
            podId,
            messageId,
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            output: event.output,
        };
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_TOOL_RESULT, toolResultPayload);
    }

    persistStreamingMessage();
}

function handleCompleteEvent(_event: CompleteStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, contentBuffer, flushCurrentSubMessage, runContext} = context;

    flushCurrentSubMessage();

    if (runContext) {
        const runCompletePayload: RunChatCompletePayload = {
            runId: runContext.runId,
            canvasId,
            podId,
            messageId,
            fullContent: contentBuffer.value,
        };
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CHAT_COMPLETE, runCompletePayload);
    } else {
        const completePayload: PodChatCompletePayload = {
            canvasId,
            podId,
            messageId,
            fullContent: contentBuffer.value,
        };
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_COMPLETE, completePayload);
    }
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
    const {canvasId, podId, messageId, contentBuffer, subMessageState, flushCurrentSubMessage, persistStreamingMessage, runContext} = context;

    flushCurrentSubMessage();

    const hasAssistantContent = contentBuffer.value.length > 0 || subMessageState.subMessages.length > 0;
    if (hasAssistantContent) {
        persistStreamingMessage();
    }

    if (runContext) {
        runExecutionService.unregisterActiveStream(runContext.runId, podId);
    } else {
        podStore.setStatus(canvasId, podId, 'idle');
    }

    if (callbacks?.onAborted) {
        await callbacks.onAborted(canvasId, podId, messageId);
    }

    return {
        messageId,
        content: contentBuffer.value,
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

/**
 * run mode 與非 run mode 的差異點超過閾值，加此說明：
 * - 有 runContext → 使用 run-specific session、key、store，不改 pod 全域狀態
 * - 無 runContext → 維持原有行為
 */
export async function executeStreamingChat(
    options: StreamingChatExecutorOptions,
    callbacks?: StreamingChatExecutorCallbacks
): Promise<StreamingChatExecutorResult> {
    const {canvasId, podId, message, abortable, runContext} = options;

    const messageId = uuidv4();
    const contentBuffer = {value: ''};
    const subMessageState = createSubMessageState();
    const flushCurrentSubMessage = createFlushCurrentSubMessage(messageId, subMessageState);

    const persistStreamingMessage = (): void => {
        const persistedMsg = buildPersistedMessage(messageId, contentBuffer.value, subMessageState);
        if (runContext) {
            runStore.upsertRunMessage(runContext.runId, podId, persistedMsg);
        } else {
            messageStore.upsertMessage(canvasId, podId, persistedMsg);
        }
    };

    const streamContext: StreamContext = {
        canvasId,
        podId,
        messageId,
        contentBuffer,
        subMessageState,
        flushCurrentSubMessage,
        persistStreamingMessage,
        runContext,
    };

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
        } : undefined;

        const resultMessage = await claudeService.sendMessage(podId, message, streamingCallback, runOptions);

        const hasAssistantContent = contentBuffer.value.length > 0 || subMessageState.subMessages.length > 0;
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

        if (callbacks?.onComplete) {
            await callbacks.onComplete(canvasId, podId);
        }

        return {
            messageId,
            content: contentBuffer.value,
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
