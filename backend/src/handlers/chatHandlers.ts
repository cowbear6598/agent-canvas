import {v4 as uuidv4} from 'uuid';
import {WebSocketResponseEvents} from '../schemas';
import type {
    PodChatAbortedPayload,
    ContentBlock,
} from '../types';
import type {ChatSendPayload, ChatHistoryPayload, ChatAbortPayload} from '../schemas';
import {podStore} from '../services/podStore.js';
import {messageStore} from '../services/messageStore.js';
import {claudeService} from '../services/claude/claudeService.js';
import {socketService} from '../services/socketService.js';
import {workflowExecutionService} from '../services/workflow/index.js';
import {autoClearService} from '../services/autoClear/index.js';
import {emitError} from '../utils/websocketResponse.js';
import {logger} from '../utils/logger.js';
import {fireAndForget} from '../utils/operationHelpers.js';
import {validatePod, withCanvasId} from '../utils/handlerHelpers.js';
import {executeStreamingChat} from '../services/claude/streamingChatExecutor.js';

function extractDisplayContent(message: string | ContentBlock[]): string {
    if (typeof message === 'string') return message;

    return message
        .map((block) => block.type === 'text' ? block.text : '[image]')
        .join('');
}

export const handleChatSend = withCanvasId<ChatSendPayload>(
    WebSocketResponseEvents.POD_ERROR,
    async (connectionId: string, canvasId: string, payload: ChatSendPayload, requestId: string): Promise<void> => {
        const {podId, message} = payload;

        const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_ERROR, requestId);
        if (!pod) return;

        if (pod.slackBinding) {
            emitError(connectionId, WebSocketResponseEvents.POD_ERROR, `Pod「${pod.name}」已連接 Slack，無法手動發送訊息`, requestId, podId, 'SLACK_BOUND');
            return;
        }

        if (pod.status === 'chatting' || pod.status === 'summarizing') {
            emitError(
                connectionId,
                WebSocketResponseEvents.POD_ERROR,
                `Pod ${podId} 目前正在 ${pod.status}，請稍後再試`,
                requestId,
                podId,
                'POD_BUSY'
            );
            return;
        }

        podStore.setStatus(canvasId, podId, 'chatting');

        const userDisplayContent = extractDisplayContent(message);

        await messageStore.addMessage(canvasId, podId, 'user', userDisplayContent);

        socketService.emitToCanvas(
            canvasId,
            WebSocketResponseEvents.POD_CHAT_USER_MESSAGE,
            {
                canvasId,
                podId,
                messageId: uuidv4(),
                content: userDisplayContent,
                timestamp: new Date().toISOString(),
            }
        );

        await executeStreamingChat(
            {canvasId, podId, message, abortable: true},
            {
                onComplete: async (canvasId, podId) => {
                    fireAndForget(
                        autoClearService.onPodComplete(canvasId, podId),
                        'AutoClear',
                        `檢查 Pod「${podId}」自動清除失敗`
                    );
                    fireAndForget(
                        workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId),
                        'Workflow',
                        `檢查 Pod「${podId}」自動觸發 Workflow 失敗`
                    );
                },
                onAborted: async (canvasId, podId, messageId) => {
                    const abortedPayload: PodChatAbortedPayload = {canvasId, podId, messageId};
                    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_ABORTED, abortedPayload);
                    logger.log('Chat', 'Abort', `Pod「${pod.name}」對話已中斷`);
                },
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
            socketService.emitToConnection(connectionId, WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT, {
                requestId,
                success: false,
                error: `找不到 Pod：${podId}`,
            });
            return;
        }

        const messages = messageStore.getMessages(podId);
        socketService.emitToConnection(connectionId, WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT, {
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
