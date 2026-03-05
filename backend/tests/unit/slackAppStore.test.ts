import {beforeEach, describe, expect, it} from 'vitest';
import {initTestDb} from '../../src/database/index.js';
import {resetStatements} from '../../src/database/statements.js';
import {slackAppStore} from '../../src/services/slack/slackAppStore.js';

describe('SlackAppStore', () => {
    beforeEach(() => {
        initTestDb();
        resetStatements();
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

        it('刪除後 runtimeState 也一併清除', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;
            slackAppStore.updateStatus(id, 'connected');

            slackAppStore.delete(id);

            expect(slackAppStore.getById(id)).toBeUndefined();
        });
    });

    describe('runtime 狀態（connectionStatus、channels）', () => {
        it('connectionStatus 和 channels 不寫入 DB，重啟後重置為預設值', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;

            slackAppStore.updateStatus(id, 'connected');
            slackAppStore.updateChannels(id, [{id: 'C001', name: 'general'}]);

            // 模擬重啟：重新初始化 DB 與 statements
            initTestDb();
            resetStatements();

            // 重新建立相同資料（SQLite in-memory 重新初始化後資料消失）
            const created2 = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id2 = created2.data!.id;

            const found = slackAppStore.getById(id2);
            expect(found?.connectionStatus).toBe('disconnected');
            expect(found?.channels).toEqual([]);
        });

        it('updateStatus 不影響 channels', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;
            const channels = [{id: 'C001', name: 'general'}];
            slackAppStore.updateChannels(id, channels);

            slackAppStore.updateStatus(id, 'error');

            expect(slackAppStore.getById(id)?.channels).toEqual(channels);
            expect(slackAppStore.getById(id)?.connectionStatus).toBe('error');
        });

        it('updateChannels 不影響 connectionStatus', () => {
            const created = slackAppStore.create('App', 'xoxb-token', 'secret');
            const id = created.data!.id;
            slackAppStore.updateStatus(id, 'connected');

            slackAppStore.updateChannels(id, [{id: 'C002', name: 'random'}]);

            expect(slackAppStore.getById(id)?.connectionStatus).toBe('connected');
            expect(slackAppStore.getById(id)?.channels).toEqual([{id: 'C002', name: 'random'}]);
        });
    });

});
