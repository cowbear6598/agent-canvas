import {mkdir, rm} from 'fs/promises';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';
import {slackAppStore} from '../../src/services/slack/slackAppStore.js';

const __dirname = import.meta.dir ?? dirname(fileURLToPath(import.meta.url));

describe('SlackAppStore', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = join(__dirname, `temp-slack-${Date.now()}`);
        await mkdir(tempDir, {recursive: true});

        // 重置 store 內部狀態（透過 loadFromDisk 空目錄）
        await slackAppStore.loadFromDisk(tempDir);
    });

    afterEach(async () => {
        await rm(tempDir, {recursive: true, force: true});
    });

    describe('create', () => {
        it('成功建立新的 Slack App', () => {
            const result = slackAppStore.create('測試 App', 'xoxb-test-token', 'test-signing-secret');

            expect(result.success).toBe(true);
            expect(result.data?.name).toBe('測試 App');
            expect(result.data?.botToken).toBe('xoxb-test-token');
            expect(result.data?.signingSecret).toBe('test-signing-secret');
            expect(result.data?.connectionStatus).toBe('disconnected');
            expect(result.data?.channels).toEqual([]);
            expect(result.data?.botUserId).toBe('');
            expect(result.data?.id).toBeTruthy();
        });

        it('重複 botToken 時回傳錯誤', () => {
            slackAppStore.create('App 1', 'xoxb-duplicate', 'secret-1');
            const result = slackAppStore.create('App 2', 'xoxb-duplicate', 'secret-2');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Bot Token');
        });

        it('不同 botToken 可建立多個 App', () => {
            slackAppStore.create('App 1', 'xoxb-token-1', 'secret-1');
            slackAppStore.create('App 2', 'xoxb-token-2', 'secret-2');

            expect(slackAppStore.list().length).toBe(2);
        });
    });

    describe('list', () => {
        it('無 App 時回傳空陣列', () => {
            expect(slackAppStore.list()).toEqual([]);
        });

        it('回傳所有 App', () => {
            slackAppStore.create('App 1', 'xoxb-token-1', 'secret-1');
            slackAppStore.create('App 2', 'xoxb-token-2', 'secret-2');

            expect(slackAppStore.list().length).toBe(2);
        });
    });

    describe('getById', () => {
        it('找到存在的 App', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const found = slackAppStore.getById(created.data!.id);

            expect(found).toBeDefined();
            expect(found?.id).toBe(created.data!.id);
        });

        it('不存在時回傳 undefined', () => {
            expect(slackAppStore.getById('nonexistent')).toBeUndefined();
        });
    });

    describe('getByBotToken', () => {
        it('以 botToken 找到對應 App', () => {
            slackAppStore.create('App', 'xoxb-find-me', 'secret');
            const found = slackAppStore.getByBotToken('xoxb-find-me');

            expect(found).toBeDefined();
            expect(found?.botToken).toBe('xoxb-find-me');
        });

        it('不存在時回傳 undefined', () => {
            expect(slackAppStore.getByBotToken('xoxb-nonexistent')).toBeUndefined();
        });
    });

    describe('updateStatus', () => {
        it('更新連線狀態', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;

            slackAppStore.updateStatus(id, 'connected');

            expect(slackAppStore.getById(id)?.connectionStatus).toBe('connected');
        });

        it('不存在的 App 不會拋出錯誤', () => {
            expect(() => slackAppStore.updateStatus('nonexistent', 'connected')).not.toThrow();
        });
    });

    describe('updateChannels', () => {
        it('更新頻道快取', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;
            const channels = [{id: 'C001', name: 'general'}];

            slackAppStore.updateChannels(id, channels);

            expect(slackAppStore.getById(id)?.channels).toEqual(channels);
        });
    });

    describe('updateBotUserId', () => {
        it('更新 Bot User ID', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;

            slackAppStore.updateBotUserId(id, 'U123456');

            expect(slackAppStore.getById(id)?.botUserId).toBe('U123456');
        });
    });

    describe('delete', () => {
        it('成功刪除存在的 App', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;

            const result = slackAppStore.delete(id);

            expect(result).toBe(true);
            expect(slackAppStore.getById(id)).toBeUndefined();
        });

        it('不存在的 App 回傳 false', () => {
            expect(slackAppStore.delete('nonexistent')).toBe(false);
        });
    });

    describe('loadFromDisk token 格式驗證', () => {
        it('botToken 非 xoxb- 開頭時略過該筆資料', async () => {
            const created = slackAppStore.create('App', 'xoxb-valid', 'valid-secret');
            const id = created.data!.id;

            await slackAppStore.flushWrites();

            const {persistenceService} = await import('../../src/services/persistence/index.js');
            const {join} = await import('path');
            const filePath = join(tempDir, 'slack-apps.json');
            const readResult = await persistenceService.readJson<any[]>(filePath);
            const apps = readResult.data ?? [];
            apps.push({id: 'bad-bot-id', name: 'Bad Bot', botToken: 'invalid-token', signingSecret: 'some-secret', botUserId: ''});
            await persistenceService.writeJson(filePath, apps);

            await slackAppStore.loadFromDisk(tempDir);

            expect(slackAppStore.getById(id)).toBeDefined();
            expect(slackAppStore.getById('bad-bot-id')).toBeUndefined();
        });

        it('signingSecret 不存在時略過該筆資料', async () => {
            const created = slackAppStore.create('App', 'xoxb-valid', 'valid-secret');
            const id = created.data!.id;

            await slackAppStore.flushWrites();

            const {persistenceService} = await import('../../src/services/persistence/index.js');
            const {join} = await import('path');
            const filePath = join(tempDir, 'slack-apps.json');
            const readResult = await persistenceService.readJson<any[]>(filePath);
            const apps = readResult.data ?? [];
            apps.push({id: 'bad-secret-id', name: 'Bad Secret', botToken: 'xoxb-ok', signingSecret: '', botUserId: ''});
            await persistenceService.writeJson(filePath, apps);

            await slackAppStore.loadFromDisk(tempDir);

            expect(slackAppStore.getById(id)).toBeDefined();
            expect(slackAppStore.getById('bad-secret-id')).toBeUndefined();
        });
    });

    describe('loadFromDisk / saveToDiskAsync', () => {
        it('持久化後重新載入可還原資料', async () => {
            const created = slackAppStore.create('持久化 App', 'xoxb-persist', 'persist-secret');
            const id = created.data!.id;

            await slackAppStore.flushWrites();

            await slackAppStore.loadFromDisk(tempDir);

            const found = slackAppStore.getById(id);
            expect(found).toBeDefined();
            expect(found?.name).toBe('持久化 App');
            expect(found?.botToken).toBe('xoxb-persist');
            expect(found?.signingSecret).toBe('persist-secret');
            expect(found?.connectionStatus).toBe('disconnected');
            expect(found?.channels).toEqual([]);
        });

        it('不持久化 connectionStatus 和 channels（runtime 狀態）', async () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;

            slackAppStore.updateStatus(id, 'connected');
            slackAppStore.updateChannels(id, [{id: 'C001', name: 'general'}]);

            await slackAppStore.flushWrites();

            await slackAppStore.loadFromDisk(tempDir);

            const found = slackAppStore.getById(id);
            expect(found?.connectionStatus).toBe('disconnected');
            expect(found?.channels).toEqual([]);
        });
    });
});
