import {createHmac} from 'crypto';
import type {Mock} from 'vitest';

vi.mock('../../src/services/slack/slackAppStore.js', () => ({
    slackAppStore: {
        list: vi.fn(() => []),
        getById: vi.fn(),
    },
}));

vi.mock('../../src/services/slack/slackEventService.js', () => ({
    slackEventService: {
        handleAppMention: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import {handleSlackWebhook} from '../../src/services/slack/slackWebhookHandler.js';
import {slackAppStore} from '../../src/services/slack/slackAppStore.js';
import {slackEventService} from '../../src/services/slack/slackEventService.js';

function asMock(fn: unknown): Mock<any> {
    return fn as Mock<any>;
}

const TEST_SIGNING_SECRET = 'test-signing-secret';

function buildSignature(signingSecret: string, timestamp: string, body: string): string {
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
    return `v0=${hmac}`;
}

function makeTimestamp(offsetMs = 0): string {
    return String(Math.floor((Date.now() + offsetMs) / 1000));
}

function makeRequest(body: unknown, overrides: {timestamp?: string; signature?: string; signingSecret?: string} = {}): Request {
    const rawBody = JSON.stringify(body);
    const timestamp = overrides.timestamp ?? makeTimestamp();
    const secret = overrides.signingSecret ?? TEST_SIGNING_SECRET;
    const signature = overrides.signature ?? buildSignature(secret, timestamp, rawBody);

    return new Request('http://localhost/slack/events', {
        method: 'POST',
        body: rawBody,
        headers: {
            'content-type': 'application/json',
            'x-slack-request-timestamp': timestamp,
            'x-slack-signature': signature,
        },
    });
}

function makeApp(overrides: {id?: string; signingSecret?: string} = {}) {
    return {
        id: overrides.id ?? 'app-1',
        name: 'Test App',
        botToken: 'xoxb-test',
        signingSecret: overrides.signingSecret ?? TEST_SIGNING_SECRET,
        connectionStatus: 'connected' as const,
        channels: [],
        botUserId: 'U_BOT',
    };
}

function makeEventPayload(overrides: Partial<{event_id: string; api_app_id: string; eventType: string}> = {}) {
    return {
        type: 'event_callback',
        event_id: overrides.event_id ?? `evt-${Date.now()}-${Math.random()}`,
        event_time: Math.floor(Date.now() / 1000),
        api_app_id: overrides.api_app_id ?? 'A123',
        event: {
            type: overrides.eventType ?? 'app_mention',
            channel: 'C123',
            user: 'U456',
            text: 'hello',
            ts: '111.222',
            event_ts: '111.222',
        },
    };
}

describe('SlackWebhookHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Body Size 限制', () => {
        it('Content-Length 超過 1MB 回傳 413', async () => {
            const req = new Request('http://localhost/slack/events', {
                method: 'POST',
                body: 'x',
                headers: {
                    'content-type': 'application/json',
                    'content-length': '1000001',
                    'x-slack-request-timestamp': makeTimestamp(),
                    'x-slack-signature': 'v0=anything',
                },
            });

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(413);
        });
    });

    describe('URL Verification', () => {
        it('通過簽名驗證後回傳 challenge', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const body = {type: 'url_verification', challenge: 'abc123', token: 'tok'};
            const req = makeRequest(body);

            const res = await handleSlackWebhook(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.challenge).toBe('abc123');
        });

        it('url_verification 簽名不合法回傳 403', async () => {
            const app = makeApp({signingSecret: 'wrong-secret'});
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const body = {type: 'url_verification', challenge: 'abc123', token: 'tok'};
            const req = makeRequest(body);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });

        it('url_verification 缺少 challenge 回傳 400', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const body = {type: 'url_verification', token: 'tok'};
            const req = makeRequest(body);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(400);
        });
    });

    describe('Signing Secret 驗證', () => {
        it('合法簽名回傳 200', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const payload = makeEventPayload();
            const req = makeRequest(payload);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(200);
        });

        it('簽名不合法回傳 403', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const payload = makeEventPayload();
            const req = makeRequest(payload, {signature: 'v0=invalidsignature'});

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });

        it('timestamp 超過 5 分鐘回傳 403', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const oldTimestamp = makeTimestamp(-6 * 60 * 1000);
            const payload = makeEventPayload();
            const rawBody = JSON.stringify(payload);
            const signature = buildSignature(TEST_SIGNING_SECRET, oldTimestamp, rawBody);

            const req = new Request('http://localhost/slack/events', {
                method: 'POST',
                body: rawBody,
                headers: {
                    'content-type': 'application/json',
                    'x-slack-request-timestamp': oldTimestamp,
                    'x-slack-signature': signature,
                },
            });

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });

        it('timestamp 在未來超過 5 分鐘回傳 403', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const futureTimestamp = makeTimestamp(6 * 60 * 1000);
            const payload = makeEventPayload();
            const rawBody = JSON.stringify(payload);
            const signature = buildSignature(TEST_SIGNING_SECRET, futureTimestamp, rawBody);

            const req = new Request('http://localhost/slack/events', {
                method: 'POST',
                body: rawBody,
                headers: {
                    'content-type': 'application/json',
                    'x-slack-request-timestamp': futureTimestamp,
                    'x-slack-signature': signature,
                },
            });

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });

        it('缺少 x-slack-signature header 回傳 403', async () => {
            const payload = makeEventPayload();
            const timestamp = makeTimestamp();
            const req = new Request('http://localhost/slack/events', {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: {
                    'content-type': 'application/json',
                    'x-slack-request-timestamp': timestamp,
                },
            });

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });

        it('缺少 x-slack-request-timestamp header 回傳 403', async () => {
            const payload = makeEventPayload();
            const rawBody = JSON.stringify(payload);
            const timestamp = makeTimestamp();
            const signature = buildSignature(TEST_SIGNING_SECRET, timestamp, rawBody);
            const req = new Request('http://localhost/slack/events', {
                method: 'POST',
                body: rawBody,
                headers: {
                    'content-type': 'application/json',
                    'x-slack-signature': signature,
                },
            });

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });

        it('所有 SlackApp 簽名都不符回傳 403', async () => {
            const app = makeApp({signingSecret: 'wrong-secret'});
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const payload = makeEventPayload();
            const req = makeRequest(payload);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });
    });

    describe('Event Callback 處理', () => {
        it('app_mention 事件呼叫 slackEventService.handleAppMention', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const payload = makeEventPayload({eventType: 'app_mention'});
            const req = makeRequest(payload);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(200);
            await new Promise((r) => setTimeout(r, 10));
            expect(slackEventService.handleAppMention).toHaveBeenCalledWith('app-1', payload.event);
        });

        it('重複 event_id 回傳 200 但不重複呼叫 handleAppMention', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const eventId = `unique-evt-${Date.now()}-dedup`;
            const payload = makeEventPayload({event_id: eventId});

            const req1 = makeRequest(payload);
            const req2 = makeRequest(payload);

            await handleSlackWebhook(req1);
            await handleSlackWebhook(req2);
            await new Promise((r) => setTimeout(r, 10));

            expect(slackEventService.handleAppMention).toHaveBeenCalledTimes(1);
        });

        it('找不到對應 SlackApp 時回傳 403', async () => {
            asMock(slackAppStore.list).mockReturnValue([]);

            const payload = makeEventPayload();
            const req = makeRequest(payload);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(403);
        });

        it('非 app_mention 事件回傳 200 但不呼叫 handleAppMention', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const payload = makeEventPayload({eventType: 'message', event_id: `msg-evt-${Date.now()}`});
            const req = makeRequest(payload);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(200);
            await new Promise((r) => setTimeout(r, 10));
            expect(slackEventService.handleAppMention).not.toHaveBeenCalled();
        });

        it('無效 JSON body 回傳 400', async () => {
            const req = new Request('http://localhost/slack/events', {
                method: 'POST',
                body: 'not-json',
                headers: {
                    'content-type': 'application/json',
                    'x-slack-request-timestamp': makeTimestamp(),
                    'x-slack-signature': 'v0=anything',
                },
            });

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(400);
        });

        it('無效事件格式（缺少必要欄位）回傳 400', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const invalidPayload = {
                type: 'event_callback',
                // 缺少 event_id、event_time、api_app_id、event
            };
            const req = makeRequest(invalidPayload);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(400);
        });

        it('未知事件類型回傳 200', async () => {
            const app = makeApp();
            asMock(slackAppStore.list).mockReturnValue([app]);
            asMock(slackAppStore.getById).mockReturnValue(app);

            const payload = {type: 'unknown_type'};
            const req = makeRequest(payload);

            const res = await handleSlackWebhook(req);

            expect(res.status).toBe(200);
        });
    });
});
