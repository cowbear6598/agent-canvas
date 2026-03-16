import type { Mock } from 'vitest';
import { createHmac } from 'crypto';

const { mockPostMessage } = vi.hoisted(() => ({
    mockPostMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@slack/web-api', () => ({
    WebClient: vi.fn().mockImplementation(() => ({
        auth: { test: vi.fn().mockResolvedValue({ user_id: 'U_BOT' }) },
        chat: { postMessage: mockPostMessage },
        conversations: {
            list: vi.fn().mockResolvedValue({ channels: [], response_metadata: { next_cursor: '' } }),
        },
    })),
}));

vi.mock('../../src/services/integration/integrationAppStore.js', () => ({
    integrationAppStore: {
        getByProviderAndConfigField: vi.fn(() => undefined),
        getById: vi.fn(() => undefined),
        list: vi.fn(() => []),
        updateStatus: vi.fn(),
        updateResources: vi.fn(),
        updateExtraJson: vi.fn(),
    },
}));

vi.mock('../../src/services/integration/integrationEventPipeline.js', () => ({
    integrationEventPipeline: {
        processEvent: vi.fn(() => Promise.resolve()),
        safeProcessEvent: vi.fn(),
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

import { WebClient } from '@slack/web-api';
import { slackProvider } from '../../src/services/integration/providers/slackProvider.js';
import { integrationAppStore } from '../../src/services/integration/integrationAppStore.js';
import type { IntegrationApp } from '../../src/services/integration/types.js';

function asMock(fn: unknown): Mock<any> {
    return fn as Mock<any>;
}

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
    return {
        id: 'app-slack-1',
        name: 'Test Slack App',
        provider: 'slack',
        config: {
            botToken: 'xoxb-test-token',
            signingSecret: 'a'.repeat(32),
        },
        connectionStatus: 'disconnected',
        resources: [],
        ...overrides,
    };
}

const SIGNING_SECRET = 'a'.repeat(32);

function buildSignedRequest(
    body: object,
    signingSecret: string,
    overrideTimestamp?: string,
    overrideSignature?: string,
): Request {
    const rawBody = JSON.stringify(body);
    const timestamp = overrideTimestamp ?? String(Math.floor(Date.now() / 1000));
    const baseString = `v0:${timestamp}:${rawBody}`;
    const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
    const signature = overrideSignature ?? `v0=${hmac}`;

    return new Request('http://localhost/slack/events', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-slack-request-timestamp': timestamp,
            'x-slack-signature': signature,
        },
        body: rawBody,
    });
}

describe('SlackProvider - handleWebhookRequest url_verification', () => {
    const signingSecret = SIGNING_SECRET;

    beforeEach(() => {
        vi.resetAllMocks();
        asMock(integrationAppStore.list).mockReturnValue([makeApp({ config: { botToken: 'xoxb-test', signingSecret } })]);
    });

    it('url_verification 請求正確回傳 challenge', async () => {
        const body = { type: 'url_verification', challenge: 'my-challenge-value' };
        const req = buildSignedRequest(body, signingSecret);

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(200);

        const json = await res.json() as { challenge: string };
        expect(json.challenge).toBe('my-challenge-value');
    });

    it('url_verification 缺少 challenge 回傳 400', async () => {
        const body = { type: 'url_verification' };
        const req = buildSignedRequest(body, signingSecret);

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(400);
    });
});

describe('SlackProvider - handleWebhookRequest event_callback', () => {
    const signingSecret = SIGNING_SECRET;

    beforeEach(() => {
        vi.resetAllMocks();
        asMock(integrationAppStore.list).mockReturnValue([makeApp({ config: { botToken: 'xoxb-test', signingSecret } })]);
    });

    it('event_callback 簽名驗證成功，觸發事件處理並回傳 200', async () => {
        const { integrationEventPipeline } = await import('../../src/services/integration/integrationEventPipeline.js');
        const body = {
            type: 'event_callback',
            event_id: 'Ev12345',
            event_time: Math.floor(Date.now() / 1000),
            api_app_id: 'A12345',
            event: {
                type: 'app_mention',
                channel: 'C12345',
                user: 'U12345',
                text: '<@U99999> hello',
                ts: '1234567890.123456',
                event_ts: '1234567890.123456',
            },
        };
        const req = buildSignedRequest(body, signingSecret);

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(200);
        expect(asMock(integrationEventPipeline.safeProcessEvent)).toHaveBeenCalled();
    });

    it('簽名驗證失敗回傳 403', async () => {
        const body = {
            type: 'event_callback',
            event_id: 'Ev12345',
            event_time: Math.floor(Date.now() / 1000),
            api_app_id: 'A12345',
            event: {
                type: 'app_mention',
                channel: 'C12345',
                user: 'U12345',
                text: 'hello',
                ts: '1234567890.123456',
                event_ts: '1234567890.123456',
            },
        };
        const req = buildSignedRequest(body, signingSecret, undefined, 'v0=invalidsignature');

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(403);
    });
});

describe('SlackProvider - handleWebhookRequest 防護機制', () => {
    const signingSecret = SIGNING_SECRET;

    beforeEach(() => {
        vi.resetAllMocks();
        asMock(integrationAppStore.list).mockReturnValue([makeApp({ config: { botToken: 'xoxb-test', signingSecret } })]);
    });

    it('缺少 x-slack-request-timestamp header 回傳 403', async () => {
        const req = new Request('http://localhost/slack/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-slack-signature': 'v0=somesig',
            },
            body: JSON.stringify({ type: 'event_callback' }),
        });

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(403);
    });

    it('缺少 x-slack-signature header 回傳 403', async () => {
        const req = new Request('http://localhost/slack/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
            },
            body: JSON.stringify({ type: 'event_callback' }),
        });

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(403);
    });

    it('Timestamp 過期（超過 5 分鐘）回傳 403', async () => {
        const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60);
        const body = { type: 'event_callback' };
        const req = buildSignedRequest(body, signingSecret, expiredTimestamp);

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(403);
    });

    it('Body 超過大小限制回傳 413', async () => {
        const req = new Request('http://localhost/slack/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
                'x-slack-signature': 'v0=somesig',
                'content-length': '2000000',
            },
            body: '{}',
        });

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(413);
    });

    it('無效 JSON body 回傳 400', async () => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const rawBody = 'not-json';
        const baseString = `v0:${timestamp}:${rawBody}`;
        const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');

        const req = new Request('http://localhost/slack/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-slack-request-timestamp': timestamp,
                'x-slack-signature': `v0=${hmac}`,
            },
            body: rawBody,
        });

        const res = await slackProvider.handleWebhookRequest(req);
        expect(res.status).toBe(400);
    });

    it('重複 event_id 被略過，回傳 200', async () => {
        const { integrationEventPipeline } = await import('../../src/services/integration/integrationEventPipeline.js');

        const body = {
            type: 'event_callback',
            event_id: 'Ev-dedup-unique-slack',
            event_time: Math.floor(Date.now() / 1000),
            api_app_id: 'A12345',
            event: {
                type: 'app_mention',
                channel: 'C12345',
                user: 'U12345',
                text: '<@U99999> hello',
                ts: '1234567890.123456',
                event_ts: '1234567890.123456',
            },
        };

        const req1 = buildSignedRequest(body, signingSecret);
        const req2 = buildSignedRequest(body, signingSecret);

        await slackProvider.handleWebhookRequest(req1);
        asMock(integrationEventPipeline.safeProcessEvent).mockClear();

        const res2 = await slackProvider.handleWebhookRequest(req2);
        expect(res2.status).toBe(200);
        expect(asMock(integrationEventPipeline.safeProcessEvent)).not.toHaveBeenCalled();
    });
});

describe('SlackProvider - validateCreate', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('新的 botToken 應通過驗證', () => {
        asMock(integrationAppStore.getByProviderAndConfigField).mockReturnValue(undefined);

        const result = slackProvider.validateCreate({ botToken: 'xoxb-new-token', signingSecret: 'a'.repeat(32) });
        expect(result.success).toBe(true);
    });

    it('已存在相同 botToken 應回傳錯誤', () => {
        asMock(integrationAppStore.getByProviderAndConfigField).mockReturnValue(makeApp());

        const result = slackProvider.validateCreate({ botToken: 'xoxb-test-token', signingSecret: 'a'.repeat(32) });
        expect(result.success).toBe(false);
        expect((result as { success: false; error: string }).error).toContain('已存在使用相同 Bot Token 的 Slack App');
    });

    it('botToken 型別不正確應回傳錯誤', () => {
        const result = slackProvider.validateCreate({ botToken: 12345 });
        expect(result.success).toBe(false);
    });
});

describe('SlackProvider - formatEventMessage', () => {
    it('正確格式化 app_mention 事件，移除 @mention', () => {
        const app = makeApp();
        const event = {
            type: 'app_mention',
            channel: 'C12345',
            user: 'U12345',
            text: '<@U99999> hello world',
            ts: '1234567890.123456',
            event_ts: '1234567890.123456',
        };

        const result = slackProvider.formatEventMessage(event, app);
        expect(result).not.toBeNull();
        expect(result?.text).toContain('[Slack: @U12345]');
        expect(result?.text).toContain('hello world');
        expect(result?.text).not.toContain('<@U99999>');
        expect(result?.resourceId).toBe('C12345');
        expect(result?.provider).toBe('slack');
    });

    it('user 不存在時使用 unknown', () => {
        const app = makeApp();
        const event = {
            type: 'app_mention',
            channel: 'C12345',
            text: '<@U99999> hello',
            ts: '1234567890.123456',
            event_ts: '1234567890.123456',
        };

        const result = slackProvider.formatEventMessage(event, app);
        expect(result?.text).toContain('[Slack: @unknown]');
    });

    it('訊息超過最大長度應被截斷', () => {
        const app = makeApp();
        const longText = '<@U99999> ' + 'a'.repeat(5000);
        const event = {
            type: 'app_mention',
            channel: 'C12345',
            user: 'U12345',
            text: longText,
            ts: '1234567890.123456',
            event_ts: '1234567890.123456',
        };

        const result = slackProvider.formatEventMessage(event, app);
        expect(result?.text).toContain('訊息過長，已截斷');
    });

    it('回傳的 NormalizedEvent 應包含 senderId、messageTs、threadTs', () => {
        const app = makeApp();
        const event = {
            type: 'app_mention',
            channel: 'C12345',
            user: 'U123',
            text: '<@U99999> hello',
            ts: '1234.5678',
            event_ts: '1234.5678',
            thread_ts: '1111.2222',
        };

        const result = slackProvider.formatEventMessage(event, app);
        expect(result?.senderId).toBe('U123');
        expect(result?.messageTs).toBe('1234.5678');
        expect(result?.threadTs).toBe('1111.2222');
    });

    it('event 無 thread_ts 時 threadTs 應為 undefined', () => {
        const app = makeApp();
        const event = {
            type: 'app_mention',
            channel: 'C12345',
            user: 'U123',
            text: '<@U99999> hello',
            ts: '1234.5678',
            event_ts: '1234.5678',
        };

        const result = slackProvider.formatEventMessage(event, app);
        expect(result?.threadTs).toBeUndefined();
        expect(result?.messageTs).toBe('1234.5678');
    });
});

describe('SlackProvider - 基本屬性', () => {
    it('name 應為 slack', () => {
        expect(slackProvider.name).toBe('slack');
    });

    it('displayName 應為 Slack', () => {
        expect(slackProvider.displayName).toBe('Slack');
    });

    it('webhookPath 應為 /slack/events', () => {
        expect(slackProvider.webhookPath).toBe('/slack/events');
    });

    it('createAppSchema 應驗證有效的 botToken 和 signingSecret', () => {
        const result = slackProvider.createAppSchema.safeParse({
            botToken: 'xoxb-valid-token',
            signingSecret: 'a'.repeat(32),
        });
        expect(result.success).toBe(true);
    });

    it('createAppSchema 應拒絕不以 xoxb- 開頭的 botToken', () => {
        const result = slackProvider.createAppSchema.safeParse({
            botToken: 'invalid-token',
            signingSecret: 'a'.repeat(32),
        });
        expect(result.success).toBe(false);
    });

    it('createAppSchema 應拒絕格式不正確的 signingSecret', () => {
        const result = slackProvider.createAppSchema.safeParse({
            botToken: 'xoxb-valid-token',
            signingSecret: 'short',
        });
        expect(result.success).toBe(false);
    });
});

describe('SlackProvider - sendMessage', () => {
    const APP_ID = 'app-sendmsg-1';

    beforeAll(() => {
        // 直接注入 mock client，避免依賴 initialize 流程
        const mockClient = {
            auth: { test: vi.fn().mockResolvedValue({ user_id: 'U_BOT' }) },
            chat: { postMessage: mockPostMessage },
            conversations: {
                list: vi.fn().mockResolvedValue({ channels: [], response_metadata: { next_cursor: '' } }),
            },
        };
        (slackProvider as unknown as { clients: Map<string, unknown> }).clients.set(APP_ID, mockClient);
    });

    beforeEach(() => {
        mockPostMessage.mockClear();
        mockPostMessage.mockResolvedValue({ ok: true });
    });

    it('有 senderId 時在 text 前加上 <@senderId>', async () => {
        await slackProvider.sendMessage(APP_ID, 'C123', 'hello', { senderId: 'U123' });

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: '<@U123> hello' })
        );
    });

    it('無 senderId 時 text 不變', async () => {
        await slackProvider.sendMessage(APP_ID, 'C123', 'hello');

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'hello' })
        );
    });

    it('有 threadTs 時帶入 thread_ts', async () => {
        await slackProvider.sendMessage(APP_ID, 'C123', 'hello', { threadTs: '1111.2222' });

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({ thread_ts: '1111.2222' })
        );
    });

    it('無 threadTs 但有 messageTs 時用 messageTs 作為 thread_ts', async () => {
        await slackProvider.sendMessage(APP_ID, 'C123', 'hello', { messageTs: '9999.8888' });

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({ thread_ts: '9999.8888' })
        );
    });

    it('threadTs 優先於 messageTs', async () => {
        await slackProvider.sendMessage(APP_ID, 'C123', 'hello', { threadTs: '1111.2222', messageTs: '9999.8888' });

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({ thread_ts: '1111.2222' })
        );
    });

    it('無 threadTs 也無 messageTs 時不帶入 thread_ts', async () => {
        await slackProvider.sendMessage(APP_ID, 'C123', 'hello');

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({ thread_ts: undefined })
        );
    });

    it('Client 不存在時回傳錯誤', async () => {
        const result = await slackProvider.sendMessage('non-existent-app', 'C123', 'hello');

        expect(result.success).toBe(false);
    });
});
