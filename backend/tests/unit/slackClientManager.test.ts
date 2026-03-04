import type {Mock} from 'vitest';

const mockAuthTest = vi.fn();
const mockConversationsList = vi.fn();
const mockChatPostMessage = vi.fn();

vi.mock('@slack/web-api', () => {
    function MockWebClient(this: any) {
        this.auth = {test: mockAuthTest};
        this.conversations = {list: mockConversationsList};
        this.chat = {postMessage: mockChatPostMessage};
    }
    return {WebClient: vi.fn().mockImplementation(MockWebClient)};
});

vi.mock('../../src/services/slack/slackAppStore.js', () => ({
    slackAppStore: {
        list: vi.fn(() => []),
        getById: vi.fn(),
        updateStatus: vi.fn(),
        updateBotUserId: vi.fn(),
        updateChannels: vi.fn(),
    },
}));

vi.mock('../../src/services/socketService.js', () => ({
    socketService: {
        emitToAll: vi.fn(),
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import {slackClientManager} from '../../src/services/slack/slackClientManager.js';
import {slackAppStore} from '../../src/services/slack/slackAppStore.js';

function asMock(fn: unknown): Mock<any> {
    return fn as Mock<any>;
}

function makeSlackApp(overrides: Partial<{id: string; botToken: string; signingSecret: string}> = {}) {
    return {
        id: overrides.id ?? 'app-1',
        name: 'Test App',
        botToken: overrides.botToken ?? 'xoxb-test',
        signingSecret: overrides.signingSecret ?? 'test-secret',
        connectionStatus: 'disconnected' as const,
        channels: [],
        botUserId: '',
    };
}

describe('SlackClientManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockAuthTest.mockResolvedValue({user_id: 'U_BOT'});
        mockConversationsList.mockResolvedValue({
            channels: [
                {id: 'C001', name: 'general', is_member: true},
                {id: 'C002', name: 'random', is_member: true},
            ],
            response_metadata: {next_cursor: ''},
        });
        mockChatPostMessage.mockResolvedValue({ok: true});

        const app = makeSlackApp();
        asMock(slackAppStore.getById).mockReturnValue(app);
    });

    afterEach(() => {
        slackClientManager.destroyAll();
    });

    describe('initialize', () => {
        it('成功初始化：呼叫 auth.test 並更新 botUserId', async () => {
            const app = makeSlackApp();

            await slackClientManager.initialize(app);

            expect(mockAuthTest).toHaveBeenCalled();
            expect(slackAppStore.updateBotUserId).toHaveBeenCalledWith('app-1', 'U_BOT');
        });

        it('成功初始化：取得頻道並更新狀態為 connected', async () => {
            const app = makeSlackApp();

            await slackClientManager.initialize(app);

            expect(slackAppStore.updateChannels).toHaveBeenCalledWith('app-1', [
                {id: 'C001', name: 'general'},
                {id: 'C002', name: 'random'},
            ]);
            expect(slackAppStore.updateStatus).toHaveBeenCalledWith('app-1', 'connected');
        });

        it('成功初始化後廣播狀態變更', async () => {
            const {socketService} = await import('../../src/services/socketService.js');
            const app = makeSlackApp();
            asMock(slackAppStore.getById).mockReturnValue({...app, connectionStatus: 'connected', channels: []});

            await slackClientManager.initialize(app);

            expect(socketService.emitToAll).toHaveBeenCalled();
        });

        it('auth.test 失敗時更新狀態為 error', async () => {
            const app = makeSlackApp();
            mockAuthTest.mockRejectedValue(new Error('auth 失敗'));

            await slackClientManager.initialize(app);

            expect(slackAppStore.updateStatus).toHaveBeenCalledWith('app-1', 'error');
        });
    });

    describe('sendMessage', () => {
        it('成功發送訊息', async () => {
            const app = makeSlackApp();
            await slackClientManager.initialize(app);

            const result = await slackClientManager.sendMessage('app-1', 'C001', '測試訊息');

            expect(result.success).toBe(true);
            expect(mockChatPostMessage).toHaveBeenCalledWith({
                channel: 'C001',
                text: '測試訊息',
                thread_ts: undefined,
            });
        });

        it('帶 threadTs 發送訊息', async () => {
            const app = makeSlackApp();
            await slackClientManager.initialize(app);

            await slackClientManager.sendMessage('app-1', 'C001', '回覆訊息', '111.222');

            expect(mockChatPostMessage).toHaveBeenCalledWith({
                channel: 'C001',
                text: '回覆訊息',
                thread_ts: '111.222',
            });
        });

        it('找不到 WebClient 時回傳錯誤', async () => {
            const result = await slackClientManager.sendMessage('nonexistent', 'C001', '訊息');

            expect(result.success).toBe(false);
            expect(result.error).toContain('尚未初始化');
        });

        it('API 失敗時回傳錯誤且不洩漏內部錯誤', async () => {
            const app = makeSlackApp();
            await slackClientManager.initialize(app);
            mockChatPostMessage.mockRejectedValue(new Error('Slack API 內部錯誤詳情'));

            const result = await slackClientManager.sendMessage('app-1', 'C001', '訊息');

            expect(result.success).toBe(false);
            expect(result.error).toBe('發送訊息失敗');
            expect(result.error).not.toContain('Slack API 內部錯誤詳情');
        });
    });

    describe('refreshChannels', () => {
        it('成功回傳頻道清單', async () => {
            const app = makeSlackApp();
            asMock(slackAppStore.getById).mockReturnValue(app);
            await slackClientManager.initialize(app);

            const result = await slackClientManager.refreshChannels('app-1');

            expect(result.success).toBe(true);
            expect(result.data).toHaveLength(2);
        });

        it('找不到 client 時回傳錯誤', async () => {
            const result = await slackClientManager.refreshChannels('nonexistent');

            expect(result.success).toBe(false);
            expect(result.error).toContain('尚未初始化');
        });

        it('找不到 SlackApp 時回傳錯誤', async () => {
            const app = makeSlackApp();
            await slackClientManager.initialize(app);

            asMock(slackAppStore.getById).mockReturnValue(undefined);

            const result = await slackClientManager.refreshChannels('app-1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('找不到');
        });

        it('分頁：第一次回傳 next_cursor，第二次無 cursor，合計頻道數量正確', async () => {
            const app = makeSlackApp();
            asMock(slackAppStore.getById).mockReturnValue(app);

            // 先 initialize 完成，再設定分頁 mock 供 refreshChannels 使用
            await slackClientManager.initialize(app);

            mockConversationsList
                .mockResolvedValueOnce({
                    channels: [
                        {id: 'C001', name: 'general', is_member: true},
                    ],
                    response_metadata: {next_cursor: 'cursor-token'},
                })
                .mockResolvedValueOnce({
                    channels: [
                        {id: 'C002', name: 'random', is_member: true},
                        {id: 'C003', name: 'dev', is_member: true},
                    ],
                    response_metadata: {next_cursor: ''},
                });

            const result = await slackClientManager.refreshChannels('app-1');

            expect(result.success).toBe(true);
            expect(result.data).toHaveLength(3);
        });

        it('fetchChannels 失敗時 refreshChannels 回傳 err', async () => {
            const app = makeSlackApp();
            asMock(slackAppStore.getById).mockReturnValue(app);
            await slackClientManager.initialize(app);

            mockConversationsList.mockRejectedValue(new Error('API 呼叫失敗'));

            const result = await slackClientManager.refreshChannels('app-1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('取得頻道失敗');
        });
    });

    describe('initialize - auth.test 無 user_id', () => {
        it('auth.test 回傳無 user_id 時不呼叫 updateBotUserId', async () => {
            mockAuthTest.mockResolvedValue({});
            const app = makeSlackApp();

            await slackClientManager.initialize(app);

            expect(slackAppStore.updateBotUserId).not.toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('remove 後 updateStatus 被呼叫且參數為 disconnected', async () => {
            const app = makeSlackApp();
            await slackClientManager.initialize(app);

            slackClientManager.remove('app-1');

            expect(slackAppStore.updateStatus).toHaveBeenCalledWith('app-1', 'disconnected');
        });

        it('remove 後廣播連線狀態變更', async () => {
            const {socketService} = await import('../../src/services/socketService.js');
            const app = makeSlackApp();
            asMock(slackAppStore.getById).mockReturnValue({...app, connectionStatus: 'disconnected', channels: []});
            await slackClientManager.initialize(app);

            slackClientManager.remove('app-1');

            expect(socketService.emitToAll).toHaveBeenCalled();
        });

        it('remove 後 sendMessage 回傳找不到 client 的錯誤', async () => {
            const app = makeSlackApp();
            await slackClientManager.initialize(app);

            slackClientManager.remove('app-1');

            const result = await slackClientManager.sendMessage('app-1', 'C001', '訊息');

            expect(result.success).toBe(false);
            expect(result.error).toContain('尚未初始化');
        });
    });

    describe('destroyAll', () => {
        it('清除所有 WebClient 後 sendMessage 回傳錯誤', async () => {
            const app1 = makeSlackApp({id: 'app-destroy-1', botToken: 'xoxb-1'});
            const app2 = makeSlackApp({id: 'app-destroy-2', botToken: 'xoxb-2'});

            await slackClientManager.initialize(app1);
            await slackClientManager.initialize(app2);

            slackClientManager.destroyAll();

            const result1 = await slackClientManager.sendMessage('app-destroy-1', 'C001', '訊息');
            const result2 = await slackClientManager.sendMessage('app-destroy-2', 'C001', '訊息');

            expect(result1.success).toBe(false);
            expect(result2.success).toBe(false);
        });
    });
});
