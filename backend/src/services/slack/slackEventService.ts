import {v4 as uuidv4} from 'uuid';
import type {Pod} from '../../types/index.js';

interface AppMentionEvent {
    type: 'app_mention';
    channel: string;
    user?: string;
    text: string;
    thread_ts?: string;
    event_ts: string;
}
import type {SlackQueueMessage} from '../../types/index.js';
import {WebSocketResponseEvents} from '../../schemas/events.js';
import {podStore} from '../podStore.js';
import {messageStore} from '../messageStore.js';
import {socketService} from '../socketService.js';
import {slackAppStore} from './slackAppStore.js';
import {slackMessageQueue} from './slackMessageQueue.js';
import {executeStreamingChat} from '../claude/streamingChatExecutor.js';
import {logger} from '../../utils/logger.js';

class SlackEventService {
    async handleAppMention(slackAppId: string, event: AppMentionEvent): Promise<void> {
        const {channel, user, text, thread_ts, event_ts} = event;

        const slackApp = slackAppStore.getById(slackAppId);
        const botUserId = slackApp?.botUserId ?? '';
        const cleanedText = text.replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, '').trim();

        const userName = user ?? 'unknown';

        const message: SlackQueueMessage = {
            id: uuidv4(),
            slackAppId,
            channelId: channel,
            userId: userName,
            userName,
            text: cleanedText,
            threadTs: thread_ts,
            eventTs: event_ts,
        };

        logger.log('Slack', 'Complete', `[SlackEventService] 收到 app_mention，頻道 ${channel}，Bot User ID: ${botUserId}`);

        const boundPods = this.findBoundPods(slackAppId, channel);
        if (boundPods.length === 0) {
            logger.log('Slack', 'Complete', `[SlackEventService] 找不到綁定 App ${slackAppId} 和頻道 ${channel} 的 Pod`);
            return;
        }

        for (const {canvasId, pod} of boundPods) {
            await this.routeMessageToPod(canvasId, pod.id, message);
        }
    }

    async routeMessageToPod(canvasId: string, podId: string, message: SlackQueueMessage): Promise<void> {
        const pod = podStore.getById(canvasId, podId);
        if (!pod) {
            logger.log('Slack', 'Error', `[SlackEventService] 找不到 Pod ${podId}，略過路由`);
            return;
        }

        if (pod.status === 'chatting' || pod.status === 'summarizing') {
            slackMessageQueue.enqueue(podId, message);
            socketService.emitToCanvas(canvasId, WebSocketResponseEvents.SLACK_MESSAGE_QUEUED, {
                canvasId,
                podId,
                message,
            });
            logger.log('Slack', 'Complete', `[SlackEventService] Pod「${pod.name}」正忙碌中，訊息已加入佇列`);
            return;
        }

        if (pod.status === 'error') {
            podStore.setStatus(canvasId, podId, 'idle');
            logger.log('Slack', 'Complete', `[SlackEventService] Pod「${pod.name}」狀態為 error，已重設為 idle`);
        }

        await this.injectSlackMessage(canvasId, podId, message);
    }

    async injectSlackMessage(canvasId: string, podId: string, message: SlackQueueMessage): Promise<void> {
        const pod = podStore.getById(canvasId, podId);
        const podName = pod?.name ?? podId;

        const formattedText = `[Slack: @${message.userName}] ${message.text}`;

        podStore.setStatus(canvasId, podId, 'chatting');

        await messageStore.addMessage(canvasId, podId, 'user', formattedText);

        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_USER_MESSAGE, {
            canvasId,
            podId,
            messageId: uuidv4(),
            content: formattedText,
            timestamp: new Date().toISOString(),
        });

        logger.log('Slack', 'Complete', `[SlackEventService] 注入 Slack 訊息至 Pod「${podName}」`);

        await executeStreamingChat(
            {canvasId, podId, message: formattedText, abortable: false},
            {
                onComplete: async (completedCanvasId, completedPodId) => {
                    await this.processNextQueueMessage(completedCanvasId, completedPodId);
                },
            }
        );
    }

    async processNextQueueMessage(canvasId: string, podId: string): Promise<void> {
        const nextMessage = slackMessageQueue.dequeue(podId);
        if (!nextMessage) {
            return;
        }

        await this.injectSlackMessage(canvasId, podId, nextMessage);
    }

    findBoundPods(slackAppId: string, channelId: string): Array<{canvasId: string; pod: Pod}> {
        return podStore.findBySlackApp(slackAppId).filter(
            ({pod}) => pod.slackBinding?.slackChannelId === channelId
        );
    }
}

export const slackEventService = new SlackEventService();
