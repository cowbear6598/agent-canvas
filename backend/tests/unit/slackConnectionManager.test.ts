import {describe, it, expect, beforeEach, vi, afterEach} from 'vitest';

// 用於追蹤最新的 MockApp 實例
// 使用 module-level 變數搭配 function 建構式，在 bun vitest 環境下可正常共享
let _lastAppInstance: any = null;

vi.mock('@slack/bolt', () => {
    // 必須使用 function 關鍵字而非箭頭函式，才能讓 Reflect.construct 正確呼叫
    function MockApp(this: any) {
        this.start = vi.fn().mockResolvedValue(undefined);
        this.stop = vi.fn().mockResolvedValue(undefined);
        this.client = {
            auth: {
                test: vi.fn().mockResolvedValue({user_id: 'U123456'}),
            },
            conversations: {
                list: vi.fn().mockResolvedValue({
                    channels: [
                        {id: 'C001', name: 'general', is_member: true},
                        {id: 'C002', name: 'random', is_member: true},
                        {id: 'C003', name: 'private', is_member: false},
                    ],
                    response_metadata: {next_cursor: ''},
                }),
            },
            chat: {
                postMessage: vi.fn().mockResolvedValue({ok: true}),
            },
        };
        this.event = vi.fn();
        _lastAppInstance = this;
    }
    return {App: vi.fn().mockImplementation(MockApp)};
});

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../../src/services/socketService.js', () => ({
    socketService: {
        emitToAll: vi.fn(),
    },
}));

vi.mock('../../src/services/slack/slackAppStore.js', () => ({
    slackAppStore: {
        getById: vi.fn().mockReturnValue({
            id: 'app-001',
            name: 'test',
            botToken: 'xoxb-test',
            appToken: 'xapp-test',
            connectionStatus: 'connected' as const,
            channels: [],
            botUserId: 'U123456',
        }),
        updateStatus: vi.fn(),
        updateBotUserId: vi.fn(),
        updateChannels: vi.fn(),
    },
}));

import {App} from '@slack/bolt';
import {SlackConnectionManager} from '../../src/services/slack/slackConnectionManager.js';
import {slackAppStore} from '../../src/services/slack/slackAppStore.js';
import {socketService} from '../../src/services/socketService.js';
import type {SlackApp} from '../../src/types/index.js';

function getLastAppInstance(): any {
    return _lastAppInstance;
}

function createMockSlackApp(overrides: Partial<SlackApp> = {}): SlackApp {
    return {
        id: 'app-001',
        name: '測試 Slack App',
        botToken: 'xoxb-test-token',
        appToken: 'xapp-test-token',
        connectionStatus: 'disconnected',
        channels: [],
        botUserId: '',
        ...overrides,
    };
}

describe('SlackConnectionManager', () => {
    let manager: SlackConnectionManager;

    beforeEach(() => {
        // 每個測試使用獨立的 manager 實例，避免 singleton 污染
        manager = new SlackConnectionManager();
        _lastAppInstance = null;
        vi.mocked(App).mockClear();
        vi.mocked(slackAppStore.updateStatus).mockClear();
        vi.mocked(slackAppStore.updateBotUserId).mockClear();
        vi.mocked(slackAppStore.updateChannels).mockClear();
        vi.mocked(socketService.emitToAll).mockClear();
        vi.mocked(slackAppStore.getById).mockClear().mockReturnValue({
            id: 'app-001',
            name: 'test',
            botToken: 'xoxb-test',
            appToken: 'xapp-test',
            connectionStatus: 'connected' as const,
            channels: [],
            botUserId: 'U123456',
        });
    });

    afterEach(async () => {
        await manager.destroyAll();
    });

    describe('connect', () => {
        it('成功建立 Bolt App 實例並啟動連線', async () => {
            const slackApp = createMockSlackApp();

            await manager.connect(slackApp);

            expect(App).toHaveBeenCalledWith({
                token: slackApp.botToken,
                socketMode: true,
                appToken: slackApp.appToken,
            });
            expect(getLastAppInstance().start).toHaveBeenCalled();
        });

        it('連線成功後更新狀態為 connected', async () => {
            const slackApp = createMockSlackApp();

            await manager.connect(slackApp);

            expect(slackAppStore.updateStatus).toHaveBeenCalledWith(slackApp.id, 'connecting');
            expect(slackAppStore.updateStatus).toHaveBeenCalledWith(slackApp.id, 'connected');
        });

        it('連線成功後呼叫 auth.test 取得 botUserId', async () => {
            const slackApp = createMockSlackApp();

            await manager.connect(slackApp);

            expect(getLastAppInstance().client.auth.test).toHaveBeenCalled();
            expect(slackAppStore.updateBotUserId).toHaveBeenCalledWith(slackApp.id, 'U123456');
        });

        it('連線成功後取得並更新頻道清單', async () => {
            const slackApp = createMockSlackApp();

            await manager.connect(slackApp);

            expect(getLastAppInstance().client.conversations.list).toHaveBeenCalled();
            // 只有 is_member: true 的頻道才會被加入
            expect(slackAppStore.updateChannels).toHaveBeenCalledWith(slackApp.id, [
                {id: 'C001', name: 'general'},
                {id: 'C002', name: 'random'},
            ]);
        });

        it('相同 id 不重複建立 Bolt App 實例', async () => {
            const slackApp = createMockSlackApp();

            await manager.connect(slackApp);
            await manager.connect(slackApp);

            expect(App).toHaveBeenCalledTimes(1);
        });

        it('廣播 SLACK_CONNECTION_STATUS_CHANGED 事件', async () => {
            const slackApp = createMockSlackApp();

            await manager.connect(slackApp);

            expect(socketService.emitToAll).toHaveBeenCalledWith(
                'slack:connection:status:changed',
                expect.objectContaining({slackAppId: slackApp.id}),
            );
        });

        it('連線失敗時更新狀態為 error', async () => {
            const slackApp = createMockSlackApp();

            // 建立一個 start 會失敗的 MockApp
            function FailMockApp(this: any) {
                this.start = vi.fn().mockRejectedValue(new Error('連線失敗'));
                this.stop = vi.fn().mockResolvedValue(undefined);
                this.client = {
                    auth: {test: vi.fn()},
                    conversations: {list: vi.fn()},
                    chat: {postMessage: vi.fn()},
                };
                this.event = vi.fn();
                _lastAppInstance = this;
            }
            vi.mocked(App).mockImplementationOnce(FailMockApp as any);

            await manager.connect(slackApp);

            expect(slackAppStore.updateStatus).toHaveBeenCalledWith(slackApp.id, 'error');
        });
    });

    describe('disconnect', () => {
        it('斷開連線後更新狀態為 disconnected', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);
            const inst = getLastAppInstance();

            vi.mocked(slackAppStore.updateStatus).mockClear();
            vi.mocked(socketService.emitToAll).mockClear();

            await manager.disconnect(slackApp.id);

            expect(inst.stop).toHaveBeenCalled();
            expect(slackAppStore.updateStatus).toHaveBeenCalledWith(slackApp.id, 'disconnected');
        });

        it('斷開不存在的連線不拋出錯誤', async () => {
            await expect(manager.disconnect('nonexistent')).resolves.not.toThrow();
        });

        it('斷開後廣播連線狀態變更', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);

            vi.mocked(socketService.emitToAll).mockClear();

            await manager.disconnect(slackApp.id);

            expect(socketService.emitToAll).toHaveBeenCalledWith(
                'slack:connection:status:changed',
                expect.objectContaining({slackAppId: slackApp.id}),
            );
        });
    });

    describe('sendMessage', () => {
        it('成功發送訊息', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);

            const result = await manager.sendMessage(slackApp.id, 'C001', '測試訊息');

            expect(result.success).toBe(true);
            expect(getLastAppInstance().client.chat.postMessage).toHaveBeenCalledWith({
                channel: 'C001',
                text: '測試訊息',
                thread_ts: undefined,
            });
        });

        it('帶有 threadTs 發送訊息', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);

            await manager.sendMessage(slackApp.id, 'C001', '回覆訊息', '1234567890.000001');

            expect(getLastAppInstance().client.chat.postMessage).toHaveBeenCalledWith({
                channel: 'C001',
                text: '回覆訊息',
                thread_ts: '1234567890.000001',
            });
        });

        it('尚未連線時回傳錯誤', async () => {
            const result = await manager.sendMessage('nonexistent', 'C001', '訊息');

            expect(result.success).toBe(false);
            expect(result.error).toContain('尚未連線');
        });

        it('API 呼叫失敗時回傳錯誤', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);

            getLastAppInstance().client.chat.postMessage.mockRejectedValueOnce(new Error('API 錯誤'));

            const result = await manager.sendMessage(slackApp.id, 'C001', '訊息');

            expect(result.success).toBe(false);
        });
    });

    describe('destroyAll', () => {
        it('銷毀所有連線並清理資源', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);
            const inst = getLastAppInstance();

            await manager.destroyAll();

            expect(inst.stop).toHaveBeenCalled();
            expect(manager.getBoltApp(slackApp.id)).toBeUndefined();
        });

        it('destroyAll 後重新 connect 可以建立新連線', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);
            await manager.destroyAll();

            _lastAppInstance = null;
            vi.mocked(App).mockClear();
            await manager.connect(slackApp);

            expect(App).toHaveBeenCalledTimes(1);
            expect(manager.getBoltApp(slackApp.id)).toBeDefined();
        });
    });

    describe('getBoltApp', () => {
        it('連線後可取得 Bolt App 實例', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);

            const app = manager.getBoltApp(slackApp.id);

            expect(app).toBeDefined();
        });

        it('未連線時回傳 undefined', () => {
            expect(manager.getBoltApp('nonexistent')).toBeUndefined();
        });
    });

    describe('handleReconnect', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('自動重連 backoff 間隔遞增', async () => {
            const slackApp = createMockSlackApp();
            const managerAny = manager as any;

            // 直接設定 reconnectAttempts 模擬已失敗次數
            managerAny.reconnectAttempts.set(slackApp.id, 0);
            managerAny.handleReconnect(slackApp.id);

            // attempt=0 時 delay 為 1000ms，推進 999ms 不應觸發 connect
            await vi.advanceTimersByTimeAsync(999);
            expect(App).toHaveBeenCalledTimes(0);

            // 推進剩餘 1ms，觸發第 1 次重連
            await vi.advanceTimersByTimeAsync(1);
            expect(App).toHaveBeenCalledTimes(1);

            // 重連成功後 reconnectAttempts 被設為 0，驗證第 2 次 delay 仍從 1000ms 開始
            managerAny.reconnectAttempts.set(slackApp.id, 1);
            managerAny.boltApps.delete(slackApp.id);
            managerAny.handleReconnect(slackApp.id);

            await vi.advanceTimersByTimeAsync(1999);
            expect(App).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(App).toHaveBeenCalledTimes(2);

            // 第 3 次 delay 為 4000ms
            managerAny.reconnectAttempts.set(slackApp.id, 2);
            managerAny.boltApps.delete(slackApp.id);
            managerAny.handleReconnect(slackApp.id);

            await vi.advanceTimersByTimeAsync(3999);
            expect(App).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(1);
            expect(App).toHaveBeenCalledTimes(3);
        });

        it('重連成功後 backoff 重置', async () => {
            const slackApp = createMockSlackApp();
            const managerAny = manager as any;

            // 模擬已重連失敗 3 次
            managerAny.reconnectAttempts.set(slackApp.id, 3);
            managerAny.handleReconnect(slackApp.id);

            // attempt=3 時 delay 為 8000ms
            await vi.advanceTimersByTimeAsync(8000);
            // 重連成功，reconnectAttempts 應被設為 0
            expect(managerAny.reconnectAttempts.get(slackApp.id)).toBe(0);

            // 刪除 boltApp 模擬下一次健康檢查失敗，驗證 delay 從 1000ms 重新開始
            managerAny.boltApps.delete(slackApp.id);
            managerAny.handleReconnect(slackApp.id);

            await vi.advanceTimersByTimeAsync(999);
            expect(App).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(App).toHaveBeenCalledTimes(2);
        });

        it('超過 MAX_RECONNECT_ATTEMPTS(10) 次後停止重連', async () => {
            const slackApp = createMockSlackApp();
            const managerAny = manager as any;

            // 設定已達上限
            managerAny.reconnectAttempts.set(slackApp.id, 10);
            managerAny.handleReconnect(slackApp.id);

            // 推進足夠時間，確認不會再觸發 connect
            await vi.advanceTimersByTimeAsync(60000);
            expect(App).toHaveBeenCalledTimes(0);
            expect(slackAppStore.updateStatus).toHaveBeenCalledWith(slackApp.id, 'error');
        });
    });

    describe('startHealthCheck', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('健康檢查偵測到斷線後觸發重連', async () => {
            const slackApp = createMockSlackApp();
            // 使用真實 timer 完成 connect
            vi.useRealTimers();
            await manager.connect(slackApp);
            vi.useFakeTimers();

            const inst = getLastAppInstance();
            // 讓 auth.test 拋出錯誤，模擬連線中斷
            inst.client.auth.test.mockRejectedValue(new Error('連線中斷'));

            manager.startHealthCheck();

            // 推進 30000ms 觸發健康檢查
            await vi.advanceTimersByTimeAsync(30000);

            // boltApps 中的 app 應被移除
            expect(manager.getBoltApp(slackApp.id)).toBeUndefined();
            // 重連邏輯應被觸發（updateStatus 應被呼叫為 connecting）
            expect(slackAppStore.updateStatus).toHaveBeenCalledWith(slackApp.id, 'connecting');
        });

        it('startHealthCheck 不重複啟動', async () => {
            const managerAny = manager as any;

            manager.startHealthCheck();
            const firstInterval = managerAny.healthCheckInterval;

            manager.startHealthCheck();
            const secondInterval = managerAny.healthCheckInterval;

            expect(firstInterval).toBe(secondInterval);
        });
    });

    describe('refreshChannels', () => {
        it('refreshChannels 成功後回傳頻道清單', async () => {
            const slackApp = createMockSlackApp();
            await manager.connect(slackApp);

            vi.mocked(slackAppStore.updateChannels).mockClear();

            const result = await manager.refreshChannels(slackApp.id);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toEqual([
                    {id: 'C001', name: 'general'},
                    {id: 'C002', name: 'random'},
                ]);
            }
        });

        it('refreshChannels 尚未連線時回傳錯誤', async () => {
            const result = await manager.refreshChannels('nonexistent');

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toContain('尚未連線');
            }
        });
    });
});
