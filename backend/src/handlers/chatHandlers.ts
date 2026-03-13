import {WebSocketResponseEvents} from '../schemas';
import type {
    Pod,
} from '../types';
import { isPodBusy } from '../types/index.js';
import type {ChatSendPayload, ChatHistoryPayload, ChatAbortPayload} from '../schemas';
import {podStore} from '../services/podStore.js';
import {messageStore} from '../services/messageStore.js';
import {claudeService} from '../services/claude/claudeService.js';
import {emitError, emitSuccess} from '../utils/websocketResponse.js';
import {onChatComplete, onChatAborted, onRunChatComplete} from '../utils/chatCallbacks.js';
import {validatePod, withCanvasId} from '../utils/handlerHelpers.js';
import {executeStreamingChat} from '../services/claude/streamingChatExecutor.js';
import {injectUserMessage} from '../utils/chatHelpers.js';
import {injectRunUserMessage} from '../utils/runChatHelpers.js';
import {runExecutionService} from '../services/workflow/runExecutionService.js';
import {extractDisplayContent} from '../utils/chatHelpers.js';

function validateIntegrationBindings(
    connectionId: string,
    pod: Pod,
    requestId: string
): boolean {
    if (pod.integrationBindings?.length) {
        emitError(connectionId, WebSocketResponseEvents.POD_ERROR, `Pod「${pod.name}」已連接外部服務，無法手動發送訊息`, requestId, pod.id, 'INTEGRATION_BOUND');
        return false;
    }
    return true;
}

function validatePodNotBusy(
    connectionId: string,
    pod: Pod,
    requestId: string
): boolean {
    if (isPodBusy(pod.status)) {
        emitError(
            connectionId,
            WebSocketResponseEvents.POD_ERROR,
            `Pod ${pod.id} 目前正在 ${pod.status}，請稍後再試`,
            requestId,
            pod.id,
            'POD_BUSY'
        );
        return false;
    }
    return true;
}


export const handleChatSend = withCanvasId<ChatSendPayload>(
    WebSocketResponseEvents.POD_ERROR,
    async (connectionId: string, canvasId: string, payload: ChatSendPayload, requestId: string): Promise<void> => {
        const {podId, message} = payload;

        const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_ERROR, requestId);
        if (!pod) return;

        if (!validateIntegrationBindings(connectionId, pod, requestId)) return;

        const podName = pod.name;

        if (pod.multiInstance === true) {
            const triggerMessage = extractDisplayContent(message);
            const runContext = await runExecutionService.createRun(canvasId, podId, triggerMessage);
            runExecutionService.startPodInstance(runContext, podId);
            await injectRunUserMessage(runContext, podId, message);

            await executeStreamingChat(
                {canvasId, podId, message, abortable: true, runContext},
                {
                    onComplete: (_cid, _pid) => onRunChatComplete(runContext, canvasId, podId),
                    onAborted: (abortedCanvasId, abortedPodId, messageId) => onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
                }
            );
            return;
        }

        if (!validatePodNotBusy(connectionId, pod, requestId)) return;

        await injectUserMessage({ canvasId, podId, content: message });

        await executeStreamingChat(
            {canvasId, podId, message, abortable: true},
            {
                onComplete: onChatComplete,
                onAborted: (abortedCanvasId, abortedPodId, messageId) => onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
            }
        );
    }
);

export const handleChatAbort = withCanvasId<ChatAbortPayload>(
    WebSocketResponseEvents.POD_ERROR,
    async (connectionId: string, canvasId: string, payload: ChatAbortPayload, requestId: string): Promise<void> => {
        const {podId} = payload;

        const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_ERROR, requestId);
        if (!pod) return;

        if (pod.status !== 'chatting') {
            emitError(
                connectionId,
                WebSocketResponseEvents.POD_ERROR,
                `Pod ${podId} 目前不在對話中，無法中斷`,
                requestId,
                podId,
                'POD_NOT_CHATTING'
            );
            return;
        }

        const aborted = claudeService.abortQuery(podId);
        if (!aborted) {
            // abort 失敗但 pod 狀態是 chatting，重設為 idle 避免卡死
            podStore.setStatus(canvasId, podId, 'idle');
            emitError(
                connectionId,
                WebSocketResponseEvents.POD_ERROR,
                `找不到 Pod ${podId} 的活躍查詢`,
                requestId,
                podId,
                'NO_ACTIVE_QUERY'
            );
            return;
        }
    }
);

export const handleChatHistory = withCanvasId<ChatHistoryPayload>(
    WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT,
    async (connectionId: string, canvasId: string, payload: ChatHistoryPayload, requestId: string): Promise<void> => {
        const {podId} = payload;

        const pod = podStore.getById(canvasId, podId);
        if (!pod) {
            emitSuccess(connectionId, WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT, {
                requestId,
                success: false,
                error: `找不到 Pod：${podId}`,
            });
            return;
        }

        const messages = messageStore.getMessages(podId);
        emitSuccess(connectionId, WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT, {
            requestId,
            success: true,
            messages: messages.map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                subMessages: message.subMessages,
            })),
        });
    }
);
