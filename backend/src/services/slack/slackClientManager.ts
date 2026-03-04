import {WebClient} from '@slack/web-api';
import type {SlackApp, SlackChannel} from '../../types/index.js';
import {Result, ok, err} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {getErrorMessage} from '../../utils/errorHelpers.js';
import {slackAppStore} from './slackAppStore.js';
import {socketService} from '../socketService.js';
import {WebSocketResponseEvents} from '../../schemas/events.js';

const SLACK_CHANNEL_LIST_PAGE_SIZE = 200;

class SlackClientManager {
    private clients: Map<string, WebClient> = new Map();

    async initialize(slackApp: SlackApp): Promise<void> {
        const client = new WebClient(slackApp.botToken);

        try {
            const authResult = await client.auth.test();
            if (authResult.user_id) {
                slackAppStore.updateBotUserId(slackApp.id, authResult.user_id as string);
            }
        } catch (error) {
            logger.error('Slack', 'Error', `Slack App ${slackApp.id} 初始化失敗：${getErrorMessage(error)}`);
            slackAppStore.updateStatus(slackApp.id, 'error');
            this.broadcastConnectionStatus(slackApp.id);
            return;
        }

        this.clients.set(slackApp.id, client);

        try {
            await this.fetchChannels(slackApp, client);
        } catch (error) {
            logger.warn('Slack', 'Warn', `Slack App ${slackApp.id} 取得頻道失敗，繼續初始化：${getErrorMessage(error)}`);
        }

        slackAppStore.updateStatus(slackApp.id, 'connected');
        this.broadcastConnectionStatus(slackApp.id);

        logger.log('Slack', 'Complete', `Slack App ${slackApp.id} 初始化成功`);
    }

    remove(slackAppId: string): void {
        this.clients.delete(slackAppId);
        slackAppStore.updateStatus(slackAppId, 'disconnected');
        this.broadcastConnectionStatus(slackAppId);
        logger.log('Slack', 'Complete', `Slack App ${slackAppId} 已移除`);
    }

    async sendMessage(slackAppId: string, channelId: string, text: string, threadTs?: string): Promise<Result<void>> {
        const client = this.clients.get(slackAppId);
        if (!client) {
            return err(`Slack App ${slackAppId} 尚未初始化`);
        }

        try {
            await client.chat.postMessage({
                channel: channelId,
                text,
                thread_ts: threadTs,
            });
            return ok(undefined);
        } catch (error) {
            logger.error('Slack', 'Error', `發送訊息至頻道 ${channelId} 失敗：${getErrorMessage(error)}`);
            return err('發送訊息失敗');
        }
    }

    async refreshChannels(slackAppId: string): Promise<Result<SlackChannel[]>> {
        const client = this.clients.get(slackAppId);
        if (!client) {
            return err(`Slack App ${slackAppId} 尚未初始化`);
        }

        const slackApp = slackAppStore.getById(slackAppId);
        if (!slackApp) {
            return err(`找不到 Slack App ${slackAppId}`);
        }

        try {
            const channels = await this.fetchChannels(slackApp, client);
            return ok(channels);
        } catch (error) {
            return err(`取得頻道失敗：${getErrorMessage(error)}`);
        }
    }

    getClient(slackAppId: string): WebClient | undefined {
        return this.clients.get(slackAppId);
    }

    destroyAll(): void {
        this.clients.clear();
        logger.log('Slack', 'Complete', '已清除所有 Slack WebClient');
    }

    private async fetchChannels(slackApp: SlackApp, client: WebClient): Promise<SlackChannel[]> {
        const channels: SlackChannel[] = [];
        let cursor: string | undefined;

        do {
            const result = await client.conversations.list({
                types: 'public_channel,private_channel',
                cursor,
                limit: SLACK_CHANNEL_LIST_PAGE_SIZE,
            });

            const filteredChannels = (result.channels ?? [])
                .filter((ch) => ch.is_member && ch.id && ch.name)
                .map((ch) => ({id: ch.id as string, name: ch.name as string}));

            channels.push(...filteredChannels);
            cursor = result.response_metadata?.next_cursor || undefined;
        } while (cursor);

        slackAppStore.updateChannels(slackApp.id, channels);
        logger.log('Slack', 'Complete', `Slack App ${slackApp.id} 取得 ${channels.length} 個頻道`);

        return channels;
    }

    private broadcastConnectionStatus(slackAppId: string): void {
        const slackApp = slackAppStore.getById(slackAppId);
        if (!slackApp) {
            return;
        }

        socketService.emitToAll(WebSocketResponseEvents.SLACK_CONNECTION_STATUS_CHANGED, {
            slackAppId,
            connectionStatus: slackApp.connectionStatus,
            channels: slackApp.channels,
        });
    }
}

export const slackClientManager = new SlackClientManager();
