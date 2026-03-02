import path from 'path';
import {v4 as uuidv4} from 'uuid';
import type {SlackApp, SlackAppConnectionStatus, SlackChannel, PersistedSlackApp} from '../../types/index.js';
import {Result, ok, err} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {WriteQueue} from '../../utils/writeQueue.js';
import {persistenceService} from '../persistence/index.js';

const SLACK_APPS_FILE = 'slack-apps.json';

class SlackAppStore {
    private apps: Map<string, SlackApp> = new Map();
    private writeQueue = new WriteQueue('Slack', 'SlackAppStore');
    private dataDir: string | null = null;

    create(name: string, botToken: string, appToken: string): Result<SlackApp> {
        for (const app of this.apps.values()) {
            if (app.botToken === botToken) {
                return err('已存在使用相同 Bot Token 的 Slack App');
            }
        }

        const id = uuidv4();
        const slackApp: SlackApp = {
            id,
            name,
            botToken,
            appToken,
            connectionStatus: 'disconnected',
            channels: [],
            botUserId: '',
        };

        this.apps.set(id, slackApp);
        this.saveToDiskAsync();

        return ok(slackApp);
    }

    list(): SlackApp[] {
        return Array.from(this.apps.values());
    }

    getById(id: string): SlackApp | undefined {
        return this.apps.get(id);
    }

    getByBotToken(botToken: string): SlackApp | undefined {
        for (const app of this.apps.values()) {
            if (app.botToken === botToken) {
                return app;
            }
        }
        return undefined;
    }

    private updateApp(id: string, updates: Partial<SlackApp>): void {
        const app = this.apps.get(id);
        if (!app) {
            return;
        }

        this.apps.set(id, {...app, ...updates});
    }

    updateStatus(id: string, status: SlackAppConnectionStatus): void {
        this.updateApp(id, {connectionStatus: status});
    }

    updateChannels(id: string, channels: SlackChannel[]): void {
        this.updateApp(id, {channels});
    }

    updateBotUserId(id: string, botUserId: string): void {
        this.updateApp(id, {botUserId});
    }

    delete(id: string): boolean {
        if (!this.apps.delete(id)) {
            return false;
        }

        this.saveToDiskAsync();
        return true;
    }

    async loadFromDisk(dataDir: string): Promise<Result<void>> {
        this.dataDir = dataDir;
        const filePath = path.join(dataDir, SLACK_APPS_FILE);

        this.apps.clear();

        const result = await persistenceService.readJson<PersistedSlackApp[]>(filePath);
        if (!result.success) {
            return err(result.error ?? '讀取 Slack App 資料失敗');
        }

        const persistedApps = result.data ?? [];

        if (persistedApps.length === 0) {
            logger.log('Slack', 'Load', '[SlackAppStore] 尚無已儲存的 Slack App 資料');
            return ok(undefined);
        }

        for (const persisted of persistedApps) {
            const app: SlackApp = {
                id: persisted.id,
                name: persisted.name,
                botToken: persisted.botToken,
                appToken: persisted.appToken,
                botUserId: persisted.botUserId,
                connectionStatus: 'disconnected',
                channels: [],
            };
            this.apps.set(app.id, app);
        }

        logger.log('Slack', 'Load', `[SlackAppStore] 已載入 ${this.apps.size} 個 Slack App`);
        return ok(undefined);
    }

    saveToDiskAsync(): void {
        if (!this.dataDir) {
            return;
        }

        const dataDir = this.dataDir;
        this.writeQueue.enqueue('slack-apps', async () => {
            const filePath = path.join(dataDir, SLACK_APPS_FILE);
            const persistedApps: PersistedSlackApp[] = Array.from(this.apps.values()).map((app) => ({
                id: app.id,
                name: app.name,
                botToken: app.botToken,
                appToken: app.appToken,
                botUserId: app.botUserId,
            }));

            const result = await persistenceService.writeJson(filePath, persistedApps);
            if (!result.success) {
                logger.error('Slack', 'Error', `[SlackAppStore] 儲存 Slack App 資料失敗: ${result.error}`);
            }
        });
    }

    flushWrites(): Promise<void> {
        return this.writeQueue.flush('slack-apps');
    }
}

export const slackAppStore = new SlackAppStore();
