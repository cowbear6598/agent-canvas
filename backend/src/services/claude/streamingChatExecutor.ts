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
    createSubMessageAccumulator,
    createSubMessageState,
    processTextEvent,
    processToolResultEvent,
    processToolUseEvent,
} from './streamEventProcessor.js';
import {messageStore} from '../messageStore.js';
import {podStore} from '../podStore.js';
import {socketService} from '../socketService.js';
import {logger} from '../../utils/logger.js';

export interface StreamingChatExecutorOptions {
    canvasId: string;
    podId: string;
    message: string | ContentBlock[];
    abortable: boolean;
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
    contentBuffer: {value: string};
    subMessageState: ReturnType<typeof createSubMessageState>;
    flushCurrentSubMessage: () => void;
    persistStreamingMessage: () => void;
}

type TextStreamEvent = Extract<StreamEvent, {type: 'text'}>;
type ToolUseStreamEvent = Extract<StreamEvent, {type: 'tool_use'}>;
type ToolResultStreamEvent = Extract<StreamEvent, {type: 'tool_result'}>;
type CompleteStreamEvent = Extract<StreamEvent, {type: 'complete'}>;
type ErrorStreamEvent = Extract<StreamEvent, {type: 'error'}>;

function handleTextEvent(event: TextStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, contentBuffer, subMessageState, persistStreamingMessage} = context;

    processTextEvent(event.content, contentBuffer, subMessageState);

    const textPayload: PodChatMessagePayload = {
        canvasId,
        podId,
        messageId,
        content: contentBuffer.value,
        isPartial: true,
        role: 'assistant',
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE, textPayload);

    persistStreamingMessage();
}

function handleToolUseEvent(event: ToolUseStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, subMessageState, flushCurrentSubMessage, persistStreamingMessage} = context;

    processToolUseEvent(event.toolUseId, event.toolName, event.input, subMessageState, flushCurrentSubMessage);

    const toolUsePayload: PodChatToolUsePayload = {
        canvasId,
        podId,
        messageId,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_TOOL_USE, toolUsePayload);

    persistStreamingMessage();
}

function handleToolResultEvent(event: ToolResultStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, subMessageState, persistStreamingMessage} = context;

    processToolResultEvent(event.toolUseId, event.output, subMessageState);

    const toolResultPayload: PodChatToolResultPayload = {
        canvasId,
        podId,
        messageId,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        output: event.output,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_TOOL_RESULT, toolResultPayload);

    persistStreamingMessage();
}

function handleCompleteEvent(_event: CompleteStreamEvent, context: StreamContext): void {
    const {canvasId, podId, messageId, contentBuffer, flushCurrentSubMessage} = context;

    flushCurrentSubMessage();

    const completePayload: PodChatCompletePayload = {
        canvasId,
        podId,
        messageId,
        fullContent: contentBuffer.value,
    };
    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_COMPLETE, completePayload);
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
    const {canvasId, podId, messageId, contentBuffer, subMessageState, flushCurrentSubMessage, persistStreamingMessage} = context;

    flushCurrentSubMessage();

    const hasAssistantContent = contentBuffer.value || subMessageState.subMessages.length > 0;
    if (hasAssistantContent) {
        persistStreamingMessage();
        await messageStore.flushWrites(podId);
    }

    podStore.setStatus(canvasId, podId, 'idle');

    if (callbacks?.onAborted) {
        await callbacks.onAborted(canvasId, podId, messageId);
    }

    return {
        messageId,
        content: contentBuffer.value,
        hasContent: !!hasAssistantContent,
        aborted: true,
    };
}

async function handleStreamError(
    context: StreamContext,
    error: unknown,
    callbacks?: StreamingChatExecutorCallbacks
): Promise<never> {
    const {canvasId, podId} = context;

    podStore.setStatus(canvasId, podId, 'idle');

    if (callbacks?.onError) {
        await callbacks.onError(canvasId, podId, error as Error);
    }

    throw error;
}

export async function executeStreamingChat(
    options: StreamingChatExecutorOptions,
    callbacks?: StreamingChatExecutorCallbacks
): Promise<StreamingChatExecutorResult> {
    const {canvasId, podId, message, abortable} = options;

    const messageId = uuidv4();
    const contentBuffer = {value: ''};
    const subMessageState = createSubMessageState();
    const flushCurrentSubMessage = createSubMessageAccumulator(messageId, subMessageState);

    const persistStreamingMessage = (): void => {
        const persistedMsg = buildPersistedMessage(messageId, contentBuffer.value, subMessageState);
        messageStore.upsertMessage(canvasId, podId, persistedMsg);
    };

    const streamContext: StreamContext = {
        canvasId,
        podId,
        messageId,
        contentBuffer,
        subMessageState,
        flushCurrentSubMessage,
        persistStreamingMessage,
    };

    const streamingCallback = createStreamingCallback(streamContext);

    try {
        await claudeService.sendMessage(podId, message, streamingCallback);

        const hasAssistantContent = contentBuffer.value || subMessageState.subMessages.length > 0;
        if (hasAssistantContent) {
            persistStreamingMessage();
        }

        podStore.setStatus(canvasId, podId, 'idle');

        // 先設定 idle 讓前端即時收到狀態，磁碟寫入在背景完成
        if (hasAssistantContent) {
            messageStore.flushWrites(podId).catch((error) => {
                const pod = podStore.getById(canvasId, podId);
                logger.error('Chat', 'Error', `[StreamingChatExecutor] Pod「${pod?.name ?? podId}」訊息寫入失敗`, error);
            });
        }

        if (callbacks?.onComplete) {
            await callbacks.onComplete(canvasId, podId);
        }

        return {
            messageId,
            content: contentBuffer.value,
            hasContent: !!hasAssistantContent,
            aborted: false,
        };
    } catch (error) {
        if (isAbortError(error) && abortable) {
            return handleStreamAbort(streamContext, callbacks);
        }

        return handleStreamError(streamContext, error, callbacks);
    }
}
