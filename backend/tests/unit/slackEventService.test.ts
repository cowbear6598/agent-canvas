import type {Mock} from 'vitest';

vi.mock('../../src/services/podStore.js', () => ({
    podStore: {
        getById: vi.fn(),
        setStatus: vi.fn(),
        findBySlackApp: vi.fn(() => []),
    },
}));

vi.mock('../../src/services/messageStore.js', () => ({
    messageStore: {
        addMessage: vi.fn(() => Promise.resolve({success: true, data: {id: 'msg-1'}})),
    },
}));

vi.mock('../../src/services/socketService.js', () => ({
    socketService: {
        emitToCanvas: vi.fn(),
    },
}));

vi.mock('../../src/services/slack/slackAppStore.js', () => ({
    slackAppStore: {
        getById: vi.fn(),
    },
}));

vi.mock('../../src/services/slack/slackMessageQueue.js', () => ({
    slackMessageQueue: {
        enqueue: vi.fn(),
        dequeue: vi.fn(() => undefined),
    },
}));

vi.mock('../../src/services/claude/streamingChatExecutor.js', () => ({
    executeStreamingChat: vi.fn(() => Promise.resolve({messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false})),
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import {slackEventService} from '../../src/services/slack/slackEventService.js';
import {podStore} from '../../src/services/podStore.js';
import {messageStore} from '../../src/services/messageStore.js';
import {socketService} from '../../src/services/socketService.js';
import {slackAppStore} from '../../src/services/slack/slackAppStore.js';
import {slackMessageQueue} from '../../src/services/slack/slackMessageQueue.js';
import {executeStreamingChat} from '../../src/services/claude/streamingChatExecutor.js';
import {WebSocketResponseEvents} from '../../src/schemas/events.js';
import type {SlackQueueMessage} from '../../src/types/index.js';
import type {Pod} from '../../src/types/index.js';

function asMock(fn: unknown): Mock<any> {
    return fn as Mock<any>;
}

function makePod(overrides: Partial<Pod> = {}): Pod {
    return {
        id: 'pod-1',
        name: 'Test Pod',
        status: 'idle',
        workspacePath: '/workspace/pod-1',
        x: 0,
        y: 0,
        rotation: 0,
        claudeSessionId: null,
        outputStyleId: null,
        skillIds: [],
        subAgentIds: [],
        mcpServerIds: [],
        model: 'opus',
        repositoryId: null,
        commandId: null,
        autoClear: false,
        ...overrides,
    };
}

function makeMessage(overrides: Partial<SlackQueueMessage> = {}): SlackQueueMessage {
    return {
        id: 'msg-1',
        slackAppId: 'app-1',
        channelId: 'C123',
        userId: 'U123',
        userName: 'testuser',
        text: '測試訊息',
        eventTs: '1234567890.000001',
        ...overrides,
    };
}

describe('SlackEventService', () => {
    const canvasId = 'canvas-1';
    const podId = 'pod-1';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('findBoundPods', () => {
        it('找到匹配 slackAppId 和 channelId 的 Pod', () => {
            const pod = makePod({
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);

            const result = slackEventService.findBoundPods('app-1', 'C123');

            expect(result).toHaveLength(1);
            expect(result[0].pod.id).toBe('pod-1');
        });

        it('channelId 不符合時不回傳 Pod', () => {
            const pod = makePod({
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C999'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);

            const result = slackEventService.findBoundPods('app-1', 'C123');

            expect(result).toHaveLength(0);
        });

        it('無綁定 Pod 時回傳空陣列', () => {
            asMock(podStore.findBySlackApp).mockReturnValue([]);

            const result = slackEventService.findBoundPods('app-1', 'C123');

            expect(result).toHaveLength(0);
        });
    });

    describe('handleAppMention', () => {
        it('找不到綁定 Pod 時不呼叫 routeMessageToPod', async () => {
            asMock(slackAppStore.getById).mockReturnValue({id: 'app-1', botUserId: 'UBOT'});
            asMock(podStore.findBySlackApp).mockReturnValue([]);

            await slackEventService.handleAppMention('app-1', {
                type: 'app_mention',
                channel: 'C123',
                user: 'U456',
                text: '<@UBOT> 測試',
                event_ts: '111.222',
            } as any);

            expect(executeStreamingChat).not.toHaveBeenCalled();
        });

        it('清理 mention 標籤並路由至綁定的 Pod', async () => {
            const pod = makePod({
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(slackAppStore.getById).mockReturnValue({id: 'app-1', botUserId: 'UBOT'});
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.handleAppMention('app-1', {
                type: 'app_mention',
                channel: 'C123',
                user: 'U456',
                text: '<@UBOT> 你好',
                event_ts: '111.222',
            } as any);

            expect(messageStore.addMessage).toHaveBeenCalledWith(
                canvasId,
                podId,
                'user',
                '[Slack: @U456] 你好'
            );
        });

        it('多個 mention 標籤都被清理', async () => {
            const pod = makePod({
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(slackAppStore.getById).mockReturnValue({id: 'app-1', botUserId: 'UBOT'});
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.handleAppMention('app-1', {
                type: 'app_mention',
                channel: 'C123',
                user: 'U456',
                text: '<@UBOT> <@OTHER> 訊息內容',
                event_ts: '111.222',
            } as any);

            expect(messageStore.addMessage).toHaveBeenCalledWith(
                canvasId,
                podId,
                'user',
                '[Slack: @U456] 訊息內容'
            );
        });
    });

    describe('routeMessageToPod', () => {
        const message = makeMessage();

        it('Pod 狀態為 idle 時直接注入訊息', async () => {
            const pod = makePod({status: 'idle'});
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.routeMessageToPod(canvasId, podId, message);

            expect(executeStreamingChat).toHaveBeenCalledOnce();
            expect(slackMessageQueue.enqueue).not.toHaveBeenCalled();
        });

        it('Pod 狀態為 chatting 時加入佇列並廣播 SLACK_MESSAGE_QUEUED', async () => {
            const pod = makePod({status: 'chatting'});
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.routeMessageToPod(canvasId, podId, message);

            expect(slackMessageQueue.enqueue).toHaveBeenCalledWith(podId, message);
            expect(socketService.emitToCanvas).toHaveBeenCalledWith(
                canvasId,
                WebSocketResponseEvents.SLACK_MESSAGE_QUEUED,
                expect.objectContaining({canvasId, podId, message})
            );
            expect(executeStreamingChat).not.toHaveBeenCalled();
        });

        it('Pod 狀態為 summarizing 時加入佇列並廣播 SLACK_MESSAGE_QUEUED', async () => {
            const pod = makePod({status: 'summarizing'});
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.routeMessageToPod(canvasId, podId, message);

            expect(slackMessageQueue.enqueue).toHaveBeenCalledWith(podId, message);
            expect(socketService.emitToCanvas).toHaveBeenCalledWith(
                canvasId,
                WebSocketResponseEvents.SLACK_MESSAGE_QUEUED,
                expect.objectContaining({canvasId, podId})
            );
            expect(executeStreamingChat).not.toHaveBeenCalled();
        });

        it('Pod 狀態為 error 時重設狀態後注入訊息', async () => {
            const pod = makePod({status: 'error'});
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.routeMessageToPod(canvasId, podId, message);

            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'idle');
            expect(executeStreamingChat).toHaveBeenCalledOnce();
        });

        it('找不到 Pod 時不呼叫任何動作', async () => {
            asMock(podStore.getById).mockReturnValue(undefined);

            await slackEventService.routeMessageToPod(canvasId, podId, message);

            expect(executeStreamingChat).not.toHaveBeenCalled();
            expect(slackMessageQueue.enqueue).not.toHaveBeenCalled();
        });
    });

    describe('injectSlackMessage', () => {
        const message = makeMessage();

        it('組合正確的使用者訊息格式', async () => {
            const pod = makePod();
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.injectSlackMessage(canvasId, podId, message);

            expect(messageStore.addMessage).toHaveBeenCalledWith(
                canvasId,
                podId,
                'user',
                '[Slack: @testuser] 測試訊息'
            );
        });

        it('設定 Pod 狀態為 chatting', async () => {
            const pod = makePod();
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.injectSlackMessage(canvasId, podId, message);

            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'chatting');
        });

        it('廣播 POD_CHAT_USER_MESSAGE 事件至前端', async () => {
            const pod = makePod();
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.injectSlackMessage(canvasId, podId, message);

            expect(socketService.emitToCanvas).toHaveBeenCalledWith(
                canvasId,
                WebSocketResponseEvents.POD_CHAT_USER_MESSAGE,
                expect.objectContaining({
                    canvasId,
                    podId,
                    content: '[Slack: @testuser] 測試訊息',
                })
            );
        });

        it('呼叫 executeStreamingChat 觸發對話', async () => {
            const pod = makePod();
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.injectSlackMessage(canvasId, podId, message);

            expect(executeStreamingChat).toHaveBeenCalledWith(
                expect.objectContaining({canvasId, podId, abortable: false}),
                expect.objectContaining({onComplete: expect.any(Function)})
            );
        });

        it('onComplete 時呼叫 processNextQueueMessage', async () => {
            const pod = makePod();
            asMock(podStore.getById).mockReturnValue(pod);
            asMock(slackMessageQueue.dequeue).mockReturnValueOnce(undefined);

            let onCompleteCallback: ((canvasId: string, podId: string) => Promise<void>) | undefined;
            asMock(executeStreamingChat).mockImplementation(async (_opts: any, callbacks: any) => {
                onCompleteCallback = callbacks?.onComplete;
                return {messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false};
            });

            await slackEventService.injectSlackMessage(canvasId, podId, message);

            expect(onCompleteCallback).toBeDefined();
            await onCompleteCallback!(canvasId, podId);

            expect(slackMessageQueue.dequeue).toHaveBeenCalledWith(podId);
        });
    });

    describe('processNextQueueMessage', () => {
        it('佇列有訊息時呼叫 injectSlackMessage', async () => {
            const nextMessage = makeMessage({id: 'msg-2', text: '下一則'});
            asMock(slackMessageQueue.dequeue).mockReturnValueOnce(nextMessage);
            const pod = makePod();
            asMock(podStore.getById).mockReturnValue(pod);

            await slackEventService.processNextQueueMessage(canvasId, podId);

            expect(executeStreamingChat).toHaveBeenCalledOnce();
        });

        it('佇列無訊息時不做任何事', async () => {
            asMock(slackMessageQueue.dequeue).mockReturnValueOnce(undefined);

            await slackEventService.processNextQueueMessage(canvasId, podId);

            expect(executeStreamingChat).not.toHaveBeenCalled();
        });
    });
});
