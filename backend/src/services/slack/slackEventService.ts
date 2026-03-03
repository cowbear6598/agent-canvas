import {v4 as uuidv4} from 'uuid';
import type {Pod} from '../../types/index.js';
import type {SlackMessage} from '../../types/index.js';
import {WebSocketResponseEvents} from '../../schemas/events.js';
import {podStore} from '../podStore.js';
import {messageStore} from '../messageStore.js';
import {socketService} from '../socketService.js';
import {slackAppStore} from './slackAppStore.js';
import {slackConnectionManager} from './slackConnectionManager.js';
import {connectionStore} from '../connectionStore.js';
import {executeStreamingChat} from '../claude/streamingChatExecutor.js';
import {logger} from '../../utils/logger.js';

interface AppMentionEvent {
    type: 'app_mention';
    channel: string;
    user?: string;
    text: string;
    thread_ts?: string;
    event_ts: string;
}

const BUSY_STATUSES = new Set(['chatting', 'summarizing'] as const);
const MAX_WORKFLOW_CHAIN_SIZE = 50;

class SlackEventService {
    // 忙碌回覆冷卻時間（毫秒）
    private static readonly BUSY_REPLY_COOLDOWN_MS = 30_000;
    // 記錄每個頻道最後一次忙碌回覆的時間
    private busyReplyCooldowns = new Map<string, number>();

    async handleAppMention(slackAppId: string, event: AppMentionEvent): Promise<void> {
        const {channel, user, text, thread_ts, event_ts} = event;

        const slackApp = slackAppStore.getById(slackAppId);
        const botUserId = slackApp?.botUserId ?? '';
        const cleanedText = text.replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, '').trim();

        const userName = user ?? 'unknown';

        const message: SlackMessage = {
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

        if (this.isSlackChannelBusy(slackAppId, channel)) {
            if (this.shouldSendBusyReply(channel)) {
                await slackConnectionManager.sendMessage(slackAppId, channel, '目前忙碌中，請稍後再試');
            }
            return;
        }

        for (const {canvasId, pod} of boundPods) {
            if (BUSY_STATUSES.has(pod.status as 'chatting' | 'summarizing')) {
                continue;
            }

            if (pod.status === 'error') {
                podStore.setStatus(canvasId, pod.id, 'idle');
            }

            await this.injectSlackMessage(canvasId, pod.id, message);
        }
    }

    isSlackChannelBusy(slackAppId: string, channelId: string): boolean {
        const allBoundPods = podStore.findBySlackApp(slackAppId);
        const channelPods = allBoundPods.filter(({pod}) => pod.slackBinding?.slackChannelId === channelId);

        for (const {canvasId, pod} of channelPods) {
            if (BUSY_STATUSES.has(pod.status as 'chatting' | 'summarizing')) return true;
            if (this.isWorkflowChainBusy(canvasId, pod.id)) return true;
        }

        return false;
    }

    private shouldSendBusyReply(channelId: string): boolean {
        const lastReplyTime = this.busyReplyCooldowns.get(channelId);
        const now = Date.now();
        if (lastReplyTime && now - lastReplyTime < SlackEventService.BUSY_REPLY_COOLDOWN_MS) {
            return false;
        }
        this.busyReplyCooldowns.set(channelId, now);
        return true;
    }

    private getAdjacentPodIds(canvasId: string, podId: string): string[] {
        const downstream = connectionStore.findBySourcePodId(canvasId, podId).map(c => c.targetPodId);
        const upstream = connectionStore.findByTargetPodId(canvasId, podId).map(c => c.sourcePodId);
        return [...downstream, ...upstream];
    }

    // BFS 雙向遍歷 Workflow 鏈，對每個非起始節點執行 predicate
    private traverseWorkflowChain(canvasId: string, startPodId: string, predicate: (podId: string) => boolean): boolean {
        const visited = new Set<string>([startPodId]);
        const queue = this.getAdjacentPodIds(canvasId, startPodId).filter(id => !visited.has(id));
        queue.forEach(id => visited.add(id));

        while (queue.length > 0) {
            if (visited.size > MAX_WORKFLOW_CHAIN_SIZE) {
                logger.warn('Slack', 'Warn', `Workflow 鏈遍歷超過 ${MAX_WORKFLOW_CHAIN_SIZE} 個節點，中止遍歷`);
                return false;
            }

            const currentId = queue.shift()!;
            if (predicate(currentId)) return true;

            for (const adjacentId of this.getAdjacentPodIds(canvasId, currentId)) {
                if (!visited.has(adjacentId)) {
                    visited.add(adjacentId);
                    queue.push(adjacentId);
                }
            }
        }
        return false;
    }

    private isWorkflowChainBusy(canvasId: string, podId: string): boolean {
        return this.traverseWorkflowChain(canvasId, podId, (currentId) => {
            const pod = podStore.getById(canvasId, currentId);
            return !!pod && BUSY_STATUSES.has(pod.status as 'chatting' | 'summarizing');
        });
    }

    async injectSlackMessage(canvasId: string, podId: string, message: SlackMessage): Promise<void> {
        // 二次確認 Pod 狀態，防止並發 Slack 事件穿透
        const currentPod = podStore.getById(canvasId, podId);
        if (currentPod && BUSY_STATUSES.has(currentPod.status as 'chatting' | 'summarizing')) {
            logger.log('Slack', 'Complete', `Pod「${currentPod.name}」已在忙碌中，跳過注入`);
            return;
        }

        const podName = currentPod?.name ?? podId;

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
            {}
        );
    }

    findBoundPods(slackAppId: string, channelId: string): Array<{canvasId: string; pod: Pod}> {
        return podStore.findBySlackApp(slackAppId).filter(
            ({pod}) => pod.slackBinding?.slackChannelId === channelId
        );
    }
}

export const slackEventService = new SlackEventService();
