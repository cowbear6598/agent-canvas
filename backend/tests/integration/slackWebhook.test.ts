import {createHmac} from 'crypto';
import {v4 as uuidv4} from 'uuid';
import {
    createTestServer,
    closeTestServer,
    createSocketClient,
    disconnectSocket,
    emitAndWaitResponse,
    type TestServerInstance,
} from '../setup';
import {WebSocketRequestEvents, WebSocketResponseEvents} from '../../src/schemas';
import type {TestWebSocketClient} from '../setup';
import type {SlackAppCreatePayload} from '../../src/schemas';

vi.mock('@slack/web-api', () => {
    function MockWebClient(this: any) {
        this.auth = {test: vi.fn().mockResolvedValue({user_id: 'U_TEST_BOT'})};
        this.conversations = {
            list: vi.fn().mockResolvedValue({
                channels: [{id: 'C001', name: 'general', is_member: true}],
                response_metadata: {next_cursor: ''},
            }),
        };
        this.chat = {postMessage: vi.fn().mockResolvedValue({ok: true})};
    }
    return {WebClient: vi.fn().mockImplementation(MockWebClient)};
});

function buildSignature(signingSecret: string, timestamp: string, body: string): string {
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
    return `v0=${hmac}`;
}

function makeTimestamp(): string {
    return String(Math.floor(Date.now() / 1000));
}

describe('Slack Webhook 整合測試', () => {
    let server: TestServerInstance;
    let client: TestWebSocketClient;
    let baseUrl: string;

    beforeAll(async () => {
        server = await createTestServer();
        client = await createSocketClient(server.baseUrl, server.canvasId);
        baseUrl = server.baseUrl;
    });

    afterAll(async () => {
        if (client?.connected) await disconnectSocket(client);
        if (server) await closeTestServer(server);
    });

    describe('POST /slack/events URL Verification', () => {
        it('通過簽名驗證後回傳 challenge', async () => {
            const verifySigningSecret = 'abcdef1234567890abcdef1234567890';
            const id = uuidv4().replace(/-/g, '').slice(0, 8);

            const createPayload: SlackAppCreatePayload & {requestId: string} = {
                requestId: uuidv4(),
                name: `url-verify-test-app-${id}`,
                botToken: `xoxb-${id}-urlverify`,
                signingSecret: verifySigningSecret,
            };

            await emitAndWaitResponse<typeof createPayload, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_CREATE,
                WebSocketResponseEvents.SLACK_APP_CREATED,
                createPayload
            );

            await new Promise((r) => setTimeout(r, 150));

            const body = {type: 'url_verification', challenge: 'test-challenge', token: 'tok'};
            const rawBody = JSON.stringify(body);
            const timestamp = makeTimestamp();
            const signature = buildSignature(verifySigningSecret, timestamp, rawBody);

            const res = await fetch(`${baseUrl}/slack/events`, {
                method: 'POST',
                body: rawBody,
                headers: {
                    'content-type': 'application/json',
                    'x-slack-request-timestamp': timestamp,
                    'x-slack-signature': signature,
                },
            });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.challenge).toBe('test-challenge');
        });
    });

    describe('POST /slack/events 合法簽名事件', () => {
        let signingSecret: string;
        let slackAppId: string;

        beforeAll(async () => {
            const id = uuidv4().replace(/-/g, '').slice(0, 8);
            // 需符合 32 字元 hex 格式的 signingSecret
            signingSecret = uuidv4().replace(/-/g, '').slice(0, 32);

            const payload: SlackAppCreatePayload & {requestId: string} = {
                requestId: uuidv4(),
                name: `webhook-test-app-${id}`,
                botToken: `xoxb-${id}-token`,
                signingSecret,
            };

            const response = await emitAndWaitResponse<typeof payload, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_CREATE,
                WebSocketResponseEvents.SLACK_APP_CREATED,
                payload
            );

            slackAppId = response.slackApp.id;
            // 等待 initialize 完成
            await new Promise((r) => setTimeout(r, 150));
        });

        afterAll(async () => {
            if (slackAppId) {
                await emitAndWaitResponse(
                    client,
                    WebSocketRequestEvents.SLACK_APP_DELETE,
                    WebSocketResponseEvents.SLACK_APP_DELETED,
                    {requestId: uuidv4(), slackAppId}
                );
            }
        });

        it('合法簽名的 app_mention 事件回傳 200', async () => {
            const eventBody = {
                type: 'event_callback',
                event_id: `evt-valid-${Date.now()}`,
                event_time: Math.floor(Date.now() / 1000),
                api_app_id: 'A123',
                event: {
                    type: 'app_mention',
                    channel: 'C001',
                    user: 'U456',
                    text: 'hello',
                    ts: '111.222',
                    event_ts: '111.222',
                },
            };

            const rawBody = JSON.stringify(eventBody);
            const timestamp = makeTimestamp();
            const signature = buildSignature(signingSecret, timestamp, rawBody);

            const res = await fetch(`${baseUrl}/slack/events`, {
                method: 'POST',
                body: rawBody,
                headers: {
                    'content-type': 'application/json',
                    'x-slack-request-timestamp': timestamp,
                    'x-slack-signature': signature,
                },
            });

            expect(res.status).toBe(200);
        });

        it('重複 event_id 回傳 200', async () => {
            const eventId = `evt-dedup-${Date.now()}-integration`;
            const eventBody = {
                type: 'event_callback',
                event_id: eventId,
                event_time: Math.floor(Date.now() / 1000),
                api_app_id: 'A123',
                event: {
                    type: 'app_mention',
                    channel: 'C001',
                    user: 'U456',
                    text: 'hello',
                    ts: '111.333',
                    event_ts: '111.333',
                },
            };

            const rawBody = JSON.stringify(eventBody);
            const timestamp = makeTimestamp();
            const signature = buildSignature(signingSecret, timestamp, rawBody);

            const headers = {
                'content-type': 'application/json',
                'x-slack-request-timestamp': timestamp,
                'x-slack-signature': signature,
            };

            const res1 = await fetch(`${baseUrl}/slack/events`, {method: 'POST', body: rawBody, headers});
            const res2 = await fetch(`${baseUrl}/slack/events`, {method: 'POST', body: rawBody, headers});

            expect(res1.status).toBe(200);
            expect(res2.status).toBe(200);
        });
    });

    describe('POST /slack/events 簽名不合法', () => {
        it('回傳 403', async () => {
            const eventBody = {
                type: 'event_callback',
                event_id: 'evt-bad-sig',
                event_time: Math.floor(Date.now() / 1000),
                api_app_id: 'A123',
                event: {type: 'app_mention', channel: 'C001', user: 'U456', text: 'hi', ts: '1.1', event_ts: '1.1'},
            };

            const timestamp = makeTimestamp();
            const res = await fetch(`${baseUrl}/slack/events`, {
                method: 'POST',
                body: JSON.stringify(eventBody),
                headers: {
                    'content-type': 'application/json',
                    'x-slack-request-timestamp': timestamp,
                    'x-slack-signature': 'v0=invalidsignature',
                },
            });

            expect(res.status).toBe(403);
        });
    });

    describe('GET /slack/events', () => {
        it('回傳 404（只接受 POST）', async () => {
            const res = await fetch(`${baseUrl}/slack/events`, {method: 'GET'});

            expect(res.status).toBe(404);
        });
    });
});
