import {App} from '@slack/bolt';
import type {SlackApp, SlackChannel} from '../../types/index.js';
import {Result, ok, err} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {getErrorMessage} from '../../utils/errorHelpers.js';
import {slackAppStore} from './slackAppStore.js';
import {slackEventService} from './slackEventService.js';
import {socketService} from '../socketService.js';
import {WebSocketResponseEvents} from '../../schemas/events.js';

const MAX_RECONNECT_ATTEMPTS = 10;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const SLACK_CHANNEL_LIST_PAGE_SIZE = 200;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

class SlackConnectionManager {
    private boltApps: Map<string, App> = new Map();
    private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
    private reconnectTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private reconnectAttempts: Map<string, number> = new Map();

    async connect(slackApp: SlackApp): Promise<void> {
        if (this.boltApps.has(slackApp.id)) {
            logger.log('Slack', 'Complete', `Slack App ${slackApp.id} 已連線，略過重複連線`);
            return;
        }

        slackAppStore.updateStatus(slackApp.id, 'connecting');
        this.broadcastConnectionStatus(slackApp.id);

        let app: App;

        try {
            app = new App({
                token: slackApp.botToken,
                socketMode: true,
                appToken: slackApp.appToken,
            });

            await app.start();
        } catch (error) {
            logger.error('Slack', 'Error', `Slack App ${slackApp.id} 連線失敗`, error);
            slackAppStore.updateStatus(slackApp.id, 'error');
            this.broadcastConnectionStatus(slackApp.id);
            return;
        }

        slackAppStore.updateStatus(slackApp.id, 'connected');

        try {
            const authResult = await app.client.auth.test();
            if (authResult.user_id) {
                slackAppStore.updateBotUserId(slackApp.id, authResult.user_id as string);
            }
        } catch (error) {
            logger.error('Slack', 'Error', `Slack App ${slackApp.id} 取得 bot user id 失敗`, error);
        }

        this.boltApps.set(slackApp.id, app);
        this.reconnectAttempts.set(slackApp.id, 0);

        logger.log('Slack', 'Complete', `Slack App ${slackApp.id} 連線成功`);

        // 非關鍵操作：失敗不影響連線狀態
        await this.fetchChannels(slackApp, app);
        this.setupEventHandlers(app, slackApp);

        this.broadcastConnectionStatus(slackApp.id);
    }

    private setupEventHandlers(app: App, slackApp: SlackApp): void {
        app.event('app_mention', async ({event}) => {
            logger.log('Slack', 'Complete', `收到 app_mention 事件：channel=${event.channel}, event_ts=${event.event_ts}`);
            try {
                await slackEventService.handleAppMention(slackApp.id, event);
            } catch (error) {
                logger.error('Slack', 'Error', `處理 app_mention 事件失敗：channel=${event.channel}, event_ts=${event.event_ts}`, error);
            }
        });
    }

    async disconnect(slackAppId: string): Promise<void> {
        const app = this.boltApps.get(slackAppId);
        if (!app) {
            return;
        }

        try {
            await app.stop();
        } catch (error) {
            logger.error('Slack', 'Error', `Slack App ${slackAppId} 停止時發生錯誤`, error);
        }

        this.boltApps.delete(slackAppId);
        this.clearReconnectTimeout(slackAppId);

        slackAppStore.updateStatus(slackAppId, 'disconnected');
        this.broadcastConnectionStatus(slackAppId);

        logger.log('Slack', 'Complete', `Slack App ${slackAppId} 已斷線`);
    }

    private async fetchChannels(slackApp: SlackApp, app: App): Promise<SlackChannel[]> {
        const channels: SlackChannel[] = [];
        let cursor: string | undefined;

        try {
            do {
                const result = await app.client.conversations.list({
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
        } catch (error) {
            logger.error('Slack', 'Error', `Slack App ${slackApp.id} 取得頻道失敗`, error);
        }

        return channels;
    }

    async refreshChannels(slackAppId: string): Promise<Result<SlackChannel[]>> {
        const app = this.boltApps.get(slackAppId);
        if (!app) {
            return err(`Slack App ${slackAppId} 尚未連線`);
        }

        const slackApp = slackAppStore.getById(slackAppId);
        if (!slackApp) {
            return err(`找不到 Slack App ${slackAppId}`);
        }

        const channels = await this.fetchChannels(slackApp, app);
        return ok(channels);
    }

    async sendMessage(slackAppId: string, channelId: string, text: string, threadTs?: string): Promise<Result<void>> {
        const app = this.boltApps.get(slackAppId);
        if (!app) {
            return err(`Slack App ${slackAppId} 尚未連線`);
        }

        try {
            await app.client.chat.postMessage({
                channel: channelId,
                text,
                thread_ts: threadTs,
            });

            return ok(undefined);
        } catch (error) {
            logger.error('Slack', 'Error', `發送訊息至頻道 ${channelId} 失敗`, error);
            return err(`發送訊息失敗：${getErrorMessage(error)}`);
        }
    }

    startHealthCheck(): void {
        if (this.healthCheckInterval) {
            return;
        }

        this.healthCheckInterval = setInterval(async () => {
            const entries = Array.from(this.boltApps.entries());
            const results = await Promise.allSettled(
                entries.map(async ([_slackAppId, app]) => {
                    await app.client.auth.test();
                })
            );

            const entriesWithResults = entries.map((entry, index) => ({ entry, result: results[index] }));
            for (const { entry: [slackAppId], result } of entriesWithResults) {
                if (result.status === 'rejected') {
                    logger.warn('Slack', 'Error', `Slack App ${slackAppId} 健康檢查失敗，觸發重連`);
                    this.boltApps.delete(slackAppId);
                    this.handleReconnect(slackAppId);
                }
            }
        }, HEALTH_CHECK_INTERVAL_MS);

        logger.log('Slack', 'Complete', '健康檢查已啟動');
    }

    stopHealthCheck(): void {
        if (!this.healthCheckInterval) {
            return;
        }

        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
    }

    private handleReconnect(slackAppId: string): void {
        const attempts = this.reconnectAttempts.get(slackAppId) ?? 0;

        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
            logger.error('Slack', 'Error', `Slack App ${slackAppId} 重連失敗超過 ${MAX_RECONNECT_ATTEMPTS} 次，停止重連`);
            slackAppStore.updateStatus(slackAppId, 'error');
            this.broadcastConnectionStatus(slackAppId);
            return;
        }

        const delayMs = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempts), MAX_RETRY_DELAY_MS);

        logger.log('Slack', 'Complete', `Slack App ${slackAppId} 將在 ${delayMs}ms 後進行第 ${attempts + 1} 次重連`);

        slackAppStore.updateStatus(slackAppId, 'connecting');
        this.broadcastConnectionStatus(slackAppId);

        const timeout = setTimeout(async () => {
            this.reconnectTimeouts.delete(slackAppId);

            const slackApp = slackAppStore.getById(slackAppId);
            if (!slackApp) {
                logger.warn('Slack', 'Error', `重連時找不到 Slack App ${slackAppId}`);
                return;
            }

            try {
                await this.connect(slackApp);
                this.reconnectAttempts.set(slackAppId, 0);
                logger.log('Slack', 'Complete', `Slack App ${slackAppId} 重連成功`);
            } catch (error) {
                logger.error('Slack', 'Error', `Slack App ${slackAppId} 重連失敗`, error);
                const currentAttempts = this.reconnectAttempts.get(slackAppId) ?? 0;
                this.reconnectAttempts.set(slackAppId, currentAttempts + 1);
                this.handleReconnect(slackAppId);
            }
        }, delayMs);

        this.reconnectTimeouts.set(slackAppId, timeout);
    }

    async destroyAll(): Promise<void> {
        this.stopHealthCheck();

        for (const timeout of this.reconnectTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.reconnectTimeouts.clear();

        const disconnectPromises = Array.from(this.boltApps.entries()).map(async ([slackAppId, app]) => {
            try {
                await app.stop();
                logger.log('Slack', 'Complete', `Slack App ${slackAppId} 已停止`);
            } catch (error) {
                logger.error('Slack', 'Error', `Slack App ${slackAppId} 停止時發生錯誤`, error);
            }
        });

        await Promise.all(disconnectPromises);
        this.boltApps.clear();
        this.reconnectAttempts.clear();
    }

    getBoltApp(slackAppId: string): App | undefined {
        return this.boltApps.get(slackAppId);
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

    private clearReconnectTimeout(slackAppId: string): void {
        const timeout = this.reconnectTimeouts.get(slackAppId);
        if (timeout) {
            clearTimeout(timeout);
            this.reconnectTimeouts.delete(slackAppId);
        }
    }
}

export {SlackConnectionManager};
export const slackConnectionManager = new SlackConnectionManager();
