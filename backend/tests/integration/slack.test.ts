import { v4 as uuidv4 } from 'uuid';
import {
    createTestServer,
    closeTestServer,
    createSocketClient,
    disconnectSocket,
    emitAndWaitResponse,
    type TestServerInstance,
} from '../setup';
import { createPod, getCanvasId, FAKE_UUID } from '../helpers';
import {
    WebSocketRequestEvents,
    WebSocketResponseEvents,
    type SlackAppCreatePayload,
    type SlackAppDeletePayload,
    type SlackAppGetPayload,
    type SlackAppChannelsPayload,
    type SlackAppChannelsRefreshPayload,
    type PodBindSlackPayload,
    type PodUnbindSlackPayload,
} from '../../src/schemas';
import type { TestWebSocketClient } from '../setup';

vi.mock('@slack/web-api', () => {
    function MockWebClient(this: any) {
        this.auth = {test: vi.fn().mockResolvedValue({user_id: 'U_TEST_BOT'})};
        this.conversations = {
            list: vi.fn().mockResolvedValue({
                channels: [
                    {id: 'C001', name: 'general', is_member: true},
                    {id: 'C002', name: 'random', is_member: true},
                ],
                response_metadata: {next_cursor: ''},
            }),
        };
        this.chat = {postMessage: vi.fn().mockResolvedValue({ok: true})};
    }
    return {WebClient: vi.fn().mockImplementation(MockWebClient)};
});

async function createSlackApp(
    client: TestWebSocketClient,
    overrides?: Partial<SlackAppCreatePayload>
): Promise<Record<string, any>> {
    const id = uuidv4().replace(/-/g, '').slice(0, 8);
    // signingSecret 需符合 32 字元 hex 格式
    const signingSecret = uuidv4().replace(/-/g, '').slice(0, 32);
    const payload: SlackAppCreatePayload & { requestId: string } = {
        requestId: uuidv4(),
        name: `test-app-${id}`,
        botToken: `xoxb-${id}-token`,
        signingSecret,
        ...overrides,
    };

    const response = await emitAndWaitResponse<typeof payload, Record<string, any>>(
        client,
        WebSocketRequestEvents.SLACK_APP_CREATE,
        WebSocketResponseEvents.SLACK_APP_CREATED,
        payload
    );

    // initialize 是 fire-and-forget，短暫等待讓其完成
    if (response.success && response.slackApp?.id) {
        await new Promise((r) => setTimeout(r, 100));
    }

    return response;
}

async function deleteSlackApp(
    client: TestWebSocketClient,
    slackAppId: string
): Promise<Record<string, any>> {
    return emitAndWaitResponse<SlackAppDeletePayload & { requestId: string }, Record<string, any>>(
        client,
        WebSocketRequestEvents.SLACK_APP_DELETE,
        WebSocketResponseEvents.SLACK_APP_DELETED,
        { requestId: uuidv4(), slackAppId }
    );
}

describe('Slack 整合', () => {
    let server: TestServerInstance;
    let client: TestWebSocketClient;

    beforeAll(async () => {
        server = await createTestServer();
        client = await createSocketClient(server.baseUrl, server.canvasId);
    });

    afterAll(async () => {
        if (client?.connected) await disconnectSocket(client);
        if (server) await closeTestServer(server);
    });

    describe('Slack App CRUD', () => {
        let createdAppId: string;

        afterEach(async () => {
            if (createdAppId) {
                await deleteSlackApp(client, createdAppId);
                createdAppId = '';
            }
        });

        it('透過 WS 事件 slack:app:create 建立 Slack App', async () => {
            const response = await createSlackApp(client);

            expect(response.success).toBe(true);
            expect(response.slackApp).toBeDefined();
            expect(response.slackApp.name).toContain('test-app-');

            createdAppId = response.slackApp.id;
        });

        it('建立 Slack App 時 botToken 格式驗證失敗', async () => {
            const response = await emitAndWaitResponse<Record<string, any>, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_CREATE,
                WebSocketResponseEvents.SLACK_APP_CREATED,
                {
                    requestId: uuidv4(),
                    name: 'invalid-token-app',
                    botToken: 'invalid-token',
                    signingSecret: 'abcdef1234567890abcdef1234567890',
                }
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });

        it('建立 Slack App 時 signingSecret 為空應失敗', async () => {
            const response = await emitAndWaitResponse<Record<string, any>, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_CREATE,
                WebSocketResponseEvents.SLACK_APP_CREATED,
                {
                    requestId: uuidv4(),
                    name: 'empty-secret-app',
                    botToken: 'xoxb-empty-secret',
                    signingSecret: '',
                }
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });

        it('建立 Slack App 時名稱為空應失敗', async () => {
            const response = await emitAndWaitResponse<Record<string, any>, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_CREATE,
                WebSocketResponseEvents.SLACK_APP_CREATED,
                {
                    requestId: uuidv4(),
                    name: '',
                    botToken: 'xoxb-empty-name',
                    signingSecret: 'abcdef1234567890abcdef1234567890',
                }
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });

        it('透過 WS 事件 slack:app:list 取得 Slack App 清單', async () => {
            const createResponse = await createSlackApp(client);
            createdAppId = createResponse.slackApp.id;

            const response = await emitAndWaitResponse<{ requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_LIST,
                WebSocketResponseEvents.SLACK_APP_LIST_RESULT,
                { requestId: uuidv4() }
            );

            expect(response.success).toBe(true);
            expect(Array.isArray(response.slackApps)).toBe(true);
            const ids = response.slackApps.map((a: any) => a.id);
            expect(ids).toContain(createdAppId);
        });

        it('透過 WS 事件 slack:app:get 取得單一 Slack App 詳情', async () => {
            const createResponse = await createSlackApp(client);
            createdAppId = createResponse.slackApp.id;

            const response = await emitAndWaitResponse<SlackAppGetPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_GET,
                WebSocketResponseEvents.SLACK_APP_GET_RESULT,
                { requestId: uuidv4(), slackAppId: createdAppId }
            );

            expect(response.success).toBe(true);
            expect(response.slackApp.id).toBe(createdAppId);
        });

        it('透過 WS 事件 slack:app:delete 刪除 Slack App', async () => {
            const createResponse = await createSlackApp(client);
            const appId = createResponse.slackApp.id;

            const response = await deleteSlackApp(client, appId);

            expect(response.success).toBe(true);
            expect(response.slackAppId).toBe(appId);

            createdAppId = '';
        });

        it('刪除不存在的 Slack App 回傳錯誤', async () => {
            const response = await deleteSlackApp(client, FAKE_UUID);

            expect(response.success).toBe(false);
            expect(response.error).toContain('找不到');
        });

        it('透過 WS 事件 slack:app:channels 取得 Slack App 的頻道清單', async () => {
            const createResponse = await createSlackApp(client);
            createdAppId = createResponse.slackApp.id;

            const response = await emitAndWaitResponse<SlackAppChannelsPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_CHANNELS,
                WebSocketResponseEvents.SLACK_APP_CHANNELS_RESULT,
                { requestId: uuidv4(), slackAppId: createdAppId }
            );

            expect(response.success).toBe(true);
            expect(response.slackAppId).toBe(createdAppId);
            expect(Array.isArray(response.channels)).toBe(true);
        });

        it('透過 WS 事件 slack:app:channels:refresh 重新取得頻道清單', async () => {
            const createResponse = await createSlackApp(client);
            createdAppId = createResponse.slackApp.id;

            const response = await emitAndWaitResponse<SlackAppChannelsRefreshPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.SLACK_APP_CHANNELS_REFRESH,
                WebSocketResponseEvents.SLACK_APP_CHANNELS_REFRESHED,
                { requestId: uuidv4(), slackAppId: createdAppId }
            );

            expect(response.success).toBe(true);
            expect(response.slackAppId).toBe(createdAppId);
            expect(Array.isArray(response.channels)).toBe(true);
        });
    });

    describe('Pod 綁定 Slack', () => {
        let slackAppId: string;

        beforeAll(async () => {
            const response = await createSlackApp(client);
            slackAppId = response.slackApp.id;
        });

        afterAll(async () => {
            if (slackAppId) {
                await deleteSlackApp(client, slackAppId);
            }
        });

        it('Pod 綁定 Slack 連線（WS 事件 pod:bind-slack）', async () => {
            const pod = await createPod(client);
            const canvasId = await getCanvasId(client);

            const response = await emitAndWaitResponse<PodBindSlackPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_BIND_SLACK,
                WebSocketResponseEvents.POD_SLACK_BOUND,
                {
                    requestId: uuidv4(),
                    canvasId,
                    podId: pod.id,
                    slackAppId,
                    slackChannelId: 'C001',
                }
            );

            expect(response.success).toBe(true);
            expect(response.pod).toBeDefined();
            expect(response.pod.id).toBe(pod.id);
            expect(response.pod.slackBinding).toEqual({ slackAppId, slackChannelId: 'C001' });
        });

        it('Pod 解綁 Slack 連線（WS 事件 pod:unbind-slack）', async () => {
            const pod = await createPod(client);
            const canvasId = await getCanvasId(client);

            await emitAndWaitResponse<PodBindSlackPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_BIND_SLACK,
                WebSocketResponseEvents.POD_SLACK_BOUND,
                {
                    requestId: uuidv4(),
                    canvasId,
                    podId: pod.id,
                    slackAppId,
                    slackChannelId: 'C001',
                }
            );

            const response = await emitAndWaitResponse<PodUnbindSlackPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_UNBIND_SLACK,
                WebSocketResponseEvents.POD_SLACK_UNBOUND,
                {
                    requestId: uuidv4(),
                    canvasId,
                    podId: pod.id,
                }
            );

            expect(response.success).toBe(true);
            expect(response.pod).toBeDefined();
            expect(response.pod.id).toBe(pod.id);
            expect(response.pod.slackBinding).toBeUndefined();
        });

        it('Pod 綁定時指定不存在的 Slack App 應失敗', async () => {
            const pod = await createPod(client);
            const canvasId = await getCanvasId(client);

            const response = await emitAndWaitResponse<PodBindSlackPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_BIND_SLACK,
                WebSocketResponseEvents.POD_SLACK_BOUND,
                {
                    requestId: uuidv4(),
                    canvasId,
                    podId: pod.id,
                    slackAppId: FAKE_UUID,
                    slackChannelId: 'C001',
                }
            );

            expect(response.success).toBe(false);
            expect(response.error).toContain('找不到');
        });

        it('Pod 綁定時指定不存在的頻道 ID 應失敗', async () => {
            const pod = await createPod(client);
            const canvasId = await getCanvasId(client);

            const response = await emitAndWaitResponse<PodBindSlackPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_BIND_SLACK,
                WebSocketResponseEvents.POD_SLACK_BOUND,
                {
                    requestId: uuidv4(),
                    canvasId,
                    podId: pod.id,
                    slackAppId,
                    slackChannelId: 'nonexistent-channel',
                }
            );

            expect(response.success).toBe(false);
            expect(response.error).toContain('找不到');
        });
    });

    describe('Slack 自動清理', () => {
        it('Pod 刪除時自動清理 Slack 連線', async () => {
            const appResponse = await createSlackApp(client);
            const appId = appResponse.slackApp.id;
            const pod = await createPod(client);
            const canvasId = await getCanvasId(client);

            await emitAndWaitResponse<PodBindSlackPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_BIND_SLACK,
                WebSocketResponseEvents.POD_SLACK_BOUND,
                {
                    requestId: uuidv4(),
                    canvasId,
                    podId: pod.id,
                    slackAppId: appId,
                    slackChannelId: 'C001',
                }
            );

            const deleteResponse = await emitAndWaitResponse<{ requestId: string; canvasId: string; podId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_DELETE,
                WebSocketResponseEvents.POD_DELETED,
                { requestId: uuidv4(), canvasId, podId: pod.id }
            );

            expect(deleteResponse.success).toBe(true);
            await deleteSlackApp(client, appId);
        });

        it('Slack App 刪除時自動解綁所有 Pod', async () => {
            const appResponse = await createSlackApp(client);
            const appId = appResponse.slackApp.id;
            const pod = await createPod(client);
            const canvasId = await getCanvasId(client);

            await emitAndWaitResponse<PodBindSlackPayload & { requestId: string }, Record<string, any>>(
                client,
                WebSocketRequestEvents.POD_BIND_SLACK,
                WebSocketResponseEvents.POD_SLACK_BOUND,
                {
                    requestId: uuidv4(),
                    canvasId,
                    podId: pod.id,
                    slackAppId: appId,
                    slackChannelId: 'C001',
                }
            );

            const deleteResponse = await deleteSlackApp(client, appId);
            expect(deleteResponse.success).toBe(true);

            const { podStore } = await import('../../src/services/podStore.js');
            const updatedPod = podStore.getById(canvasId, pod.id);
            expect(updatedPod?.slackBinding).toBeUndefined();
        });
    });
});
