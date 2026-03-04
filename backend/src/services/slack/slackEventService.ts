import {v4 as uuidv4} from 'uuid';
import type {Pod, SlackMessage, AppMentionEvent} from '../../types/index.js';
import {WebSocketResponseEvents} from '../../schemas/events.js';
import {podStore} from '../podStore.js';
import {messageStore} from '../messageStore.js';
import {socketService} from '../socketService.js';
import {slackAppStore} from './slackAppStore.js';
import {slackClientManager} from './slackClientManager.js';
import {connectionStore} from '../connectionStore.js';
import {executeStreamingChat} from '../claude/streamingChatExecutor.js';
import {logger} from '../../utils/logger.js';

const BUSY_STATUSES = new Set(['chatting', 'summarizing'] as const);
const MAX_WORKFLOW_CHAIN_SIZE = 50;
const MAX_SLACK_MESSAGE_LENGTH = 4000;

const INJECTION_PREFIX_PATTERN = /(^|\s)(System:|Human:|Assistant:)/g;

function escapeSlackInput(input: string): string {
    return input
        .replace(INJECTION_PREFIX_PATTERN, '$1\\$2')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/</g, '＜')
        .replace(/>/g, '＞');
}

class SlackEventService {
    private static readonly BUSY_REPLY_COOLDOWN_MS = 30_000;
    private busyReplyCooldowns = new Map<string, number>();

    async handleAppMention(slackAppId: string, event: AppMentionEvent): Promise<void> {
        const {channel, user, text, thread_ts, event_ts} = event;

        const slackApp = slackAppStore.getById(slackAppId);
        const botUserId = slackApp?.botUserId ?? '';
        const rawCleanedText = text.replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, '').trim();
        const cleanedText = rawCleanedText.length > MAX_SLACK_MESSAGE_LENGTH
            ? rawCleanedText.slice(0, MAX_SLACK_MESSAGE_LENGTH) + '\n...(訊息過長，已截斷)'
            : rawCleanedText;

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

        if (await this.handleBusyChannel(slackAppId, channel)) {
            return;
        }

        for (const {canvasId, pod} of boundPods) {
            await this.processBoundPod(canvasId, pod, message);
        }
    }

    private async handleBusyChannel(slackAppId: string, channel: string): Promise<boolean> {
        if (!this.isSlackChannelBusy(slackAppId, channel)) {
            return false;
        }
        if (this.shouldSendBusyReply(channel)) {
            await slackClientManager.sendMessage(slackAppId, channel, '目前忙碌中，請稍後再試');
        }
        return true;
    }

    private async processBoundPod(canvasId: string, pod: Pod, message: SlackMessage): Promise<void> {
        if (BUSY_STATUSES.has(pod.status as 'chatting' | 'summarizing')) return;

        if (pod.status === 'error') {
            podStore.setStatus(canvasId, pod.id, 'idle');
        }

        await this.injectSlackMessage(canvasId, pod.id, message);
    }

    isSlackChannelBusy(slackAppId: string, channelId: string): boolean {
        const allBoundPods = podStore.findBySlackApp(slackAppId);
        const channelPods = allBoundPods.filter(({pod}) => pod.slackBinding?.slackChannelId === channelId);

        return channelPods.some(({canvasId, pod}) =>
            BUSY_STATUSES.has(pod.status as 'chatting' | 'summarizing') || this.isWorkflowChainBusy(canvasId, pod.id));

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

    private processQueueItem(
        canvasId: string,
        currentId: string,
        visited: Set<string>,
        queue: string[],
        predicate: (podId: string) => boolean
    ): boolean {
        if (predicate(currentId)) return true;

        for (const adjacentId of this.getAdjacentPodIds(canvasId, currentId)) {
            if (!visited.has(adjacentId)) {
                visited.add(adjacentId);
                queue.push(adjacentId);
            }
        }
        return false;
    }

    private processBfsQueue(
        canvasId: string,
        queue: string[],
        visited: Set<string>,
        predicate: (podId: string) => boolean
    ): boolean {
        while (queue.length > 0) {
            if (visited.size > MAX_WORKFLOW_CHAIN_SIZE) {
                logger.warn('Slack', 'Warn', `Workflow 鏈超過最大限制 ${MAX_WORKFLOW_CHAIN_SIZE}，停止遍歷`);
                return false;
            }
            const currentId = queue.shift();
            if (!currentId) break;
            if (this.processQueueItem(canvasId, currentId, visited, queue, predicate)) return true;
        }
        return false;
    }

    // 需要雙向遍歷才能檢測到 Workflow 中間節點的狀態變化，單向遍歷會遺漏反向依賴
    private traverseWorkflowChain(canvasId: string, startPodId: string, predicate: (podId: string) => boolean): boolean {
        const visited = new Set<string>([startPodId]);
        const queue = this.getAdjacentPodIds(canvasId, startPodId).filter(id => !visited.has(id));
        queue.forEach(id => visited.add(id));
        return this.processBfsQueue(canvasId, queue, visited, predicate);
    }

    private isWorkflowChainBusy(canvasId: string, podId: string): boolean {
        return this.traverseWorkflowChain(canvasId, podId, (currentId) => {
            const pod = podStore.getById(canvasId, currentId);
            return pod !== undefined && BUSY_STATUSES.has(pod.status as 'chatting' | 'summarizing');
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

        const escapedUserName = escapeSlackInput(message.userName);
        const escapedText = escapeSlackInput(message.text);
        const formattedText = `[Slack: @${escapedUserName}] ${escapedText}`;

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
