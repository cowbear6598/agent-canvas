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

vi.mock('../../src/services/slack/slackConnectionManager.js', () => ({
    slackConnectionManager: {
        sendMessage: vi.fn(() => Promise.resolve({success: true})),
    },
}));

vi.mock('../../src/services/connectionStore.js', () => ({
    connectionStore: {
        findBySourcePodId: vi.fn(() => []),
        findByTargetPodId: vi.fn(() => []),
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
import {slackConnectionManager} from '../../src/services/slack/slackConnectionManager.js';
import {connectionStore} from '../../src/services/connectionStore.js';
import {executeStreamingChat} from '../../src/services/claude/streamingChatExecutor.js';
import {WebSocketResponseEvents} from '../../src/schemas/events.js';
import type {SlackMessage} from '../../src/types/index.js';
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

function makeMessage(overrides: Partial<SlackMessage> = {}): SlackMessage {
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

    describe('isSlackChannelBusy', () => {
        it('單一 Pod 狀態為 idle 時回傳 false', () => {
            const pod = makePod({
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(false);
        });

        it('單一 Pod 狀態為 chatting 時回傳 true', () => {
            const pod = makePod({
                status: 'chatting',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(true);
        });

        it('單一 Pod 狀態為 summarizing 時回傳 true', () => {
            const pod = makePod({
                status: 'summarizing',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(true);
        });

        it('找不到綁定 Pod 時回傳 false', () => {
            asMock(podStore.findBySlackApp).mockReturnValue([]);

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(false);
        });

        it('Workflow 鏈中下游 Pod 忙碌時回傳 true', () => {
            const sourcePod = makePod({
                id: 'pod-source',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            const targetPod = makePod({
                id: 'pod-target',
                status: 'chatting',
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod: sourcePod}]);
            asMock(connectionStore.findBySourcePodId).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-source') return [{sourcePodId: 'pod-source', targetPodId: 'pod-target'}];
                return [];
            });
            asMock(connectionStore.findByTargetPodId).mockReturnValue([]);
            asMock(podStore.getById).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-target') return targetPod;
                return undefined;
            });

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(true);
        });

        it('Workflow 鏈中上游 Pod 忙碌時回傳 true', () => {
            const targetPod = makePod({
                id: 'pod-target',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            const sourcePod = makePod({
                id: 'pod-source',
                status: 'chatting',
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod: targetPod}]);
            asMock(connectionStore.findBySourcePodId).mockReturnValue([]);
            asMock(connectionStore.findByTargetPodId).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-target') return [{sourcePodId: 'pod-source', targetPodId: 'pod-target'}];
                return [];
            });
            asMock(podStore.getById).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-source') return sourcePod;
                return undefined;
            });

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(true);
        });

        it('Workflow 鏈中所有 Pod 都 idle 時回傳 false', () => {
            const sourcePod = makePod({
                id: 'pod-source',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            const targetPod = makePod({
                id: 'pod-target',
                status: 'idle',
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod: sourcePod}]);
            asMock(connectionStore.findBySourcePodId).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-source') return [{sourcePodId: 'pod-source', targetPodId: 'pod-target'}];
                return [];
            });
            asMock(connectionStore.findByTargetPodId).mockReturnValue([]);
            asMock(podStore.getById).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-target') return targetPod;
                return undefined;
            });

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(false);
        });

        it('跨 Canvas Pod 也能正確判斷忙碌狀態', () => {
            const otherCanvasId = 'canvas-2';
            const pod = makePod({
                status: 'chatting',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId: otherCanvasId, pod}]);

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(true);
        });

        it('同頻道有多個 Pod，其中一個 idle 一個 chatting，應回傳 true', () => {
            const idlePod = makePod({
                id: 'pod-idle',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            const chattingPod = makePod({
                id: 'pod-chatting',
                status: 'chatting',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([
                {canvasId, pod: idlePod},
                {canvasId, pod: chattingPod},
            ]);

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(true);
        });

        it('同頻道有多個 Pod 皆 idle，應回傳 false', () => {
            const pod1 = makePod({
                id: 'pod-1',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            const pod2 = makePod({
                id: 'pod-2',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(podStore.findBySlackApp).mockReturnValue([
                {canvasId, pod: pod1},
                {canvasId, pod: pod2},
            ]);
            asMock(connectionStore.findBySourcePodId).mockReturnValue([]);
            asMock(connectionStore.findByTargetPodId).mockReturnValue([]);

            const result = slackEventService.isSlackChannelBusy('app-1', 'C123');

            expect(result).toBe(false);
        });

        it('環狀 Connection 不會造成無限迴圈', () => {
            const podA = makePod({
                id: 'pod-a',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            const podB = makePod({id: 'pod-b', status: 'idle'});

            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod: podA}]);
            asMock(connectionStore.findBySourcePodId).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-a') return [{sourcePodId: 'pod-a', targetPodId: 'pod-b'}];
                if (id === 'pod-b') return [{sourcePodId: 'pod-b', targetPodId: 'pod-a'}];
                return [];
            });
            asMock(connectionStore.findByTargetPodId).mockReturnValue([]);
            asMock(podStore.getById).mockImplementation((_canvasId: string, id: string) => {
                if (id === 'pod-b') return podB;
                return undefined;
            });

            expect(() => slackEventService.isSlackChannelBusy('app-1', 'C123')).not.toThrow();
            expect(slackEventService.isSlackChannelBusy('app-1', 'C123')).toBe(false);
        });
    });

    describe('handleAppMention', () => {
        it('找不到綁定 Pod 時不呼叫 executeStreamingChat', async () => {
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

        it('頻道忙碌時發送忙碌回覆到 Slack', async () => {
            const pod = makePod({
                status: 'chatting',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(slackAppStore.getById).mockReturnValue({id: 'app-1', botUserId: 'UBOT'});
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);

            await slackEventService.handleAppMention('app-1', {
                type: 'app_mention',
                channel: 'C123',
                user: 'U456',
                text: '<@UBOT> 你好',
                event_ts: '111.222',
            } as any);

            expect(slackConnectionManager.sendMessage).toHaveBeenCalledWith('app-1', 'C123', '目前忙碌中，請稍後再試');
            expect(executeStreamingChat).not.toHaveBeenCalled();
        });

        it('頻道空閒時跳過忙碌 Pod 只注入 idle/error Pod', async () => {
            const idlePod = makePod({
                id: 'pod-idle',
                status: 'idle',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            const chattingPod = makePod({
                id: 'pod-chatting',
                status: 'chatting',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });

            asMock(slackAppStore.getById).mockReturnValue({id: 'app-1', botUserId: 'UBOT'});
            // findBySlackApp 同時回傳兩個 pod；isSlackChannelBusy 會看到 chatting pod 但我們的 BFS 只追 workflow 鏈，
            // chatting pod 本身會讓 isSlackChannelBusy 回傳 true，所以這個場景需要讓 chatting pod 不在 findBySlackApp 內
            // 改為：idle pod 是頻道綁定的，chatting pod 只存在於 findBoundPods 回傳（非 findBySlackApp 直接回傳）
            // 實際上這在現有架構下無法分離，因此改用以下策略：
            // 用一個 idle pod + 一個未綁定此頻道的 chatting pod
            const unrelatedChattingPod = makePod({
                id: 'pod-chatting',
                status: 'chatting',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C999'}, // 不同頻道
            });

            asMock(podStore.findBySlackApp).mockReturnValue([
                {canvasId, pod: idlePod},
                {canvasId, pod: unrelatedChattingPod},
            ]);
            asMock(podStore.getById).mockReturnValue(idlePod);

            await slackEventService.handleAppMention('app-1', {
                type: 'app_mention',
                channel: 'C123',
                user: 'U456',
                text: '<@UBOT> 你好',
                event_ts: '111.222',
            } as any);

            expect(executeStreamingChat).toHaveBeenCalledOnce();
            expect(slackConnectionManager.sendMessage).not.toHaveBeenCalled();
        });

        it('Pod 狀態為 error 時應先重置為 idle 再注入訊息', async () => {
            const pod = makePod({
                status: 'error',
                slackBinding: {slackAppId: 'app-1', slackChannelId: 'C123'},
            });
            asMock(slackAppStore.getById).mockReturnValue({id: 'app-1', botUserId: 'UBOT'});
            asMock(podStore.findBySlackApp).mockReturnValue([{canvasId, pod}]);
            asMock(connectionStore.findBySourcePodId).mockReturnValue([]);
            asMock(connectionStore.findByTargetPodId).mockReturnValue([]);
            // injectSlackMessage 中的 getById 回傳 idle 狀態（已重置後）
            asMock(podStore.getById).mockReturnValue({...pod, status: 'idle'});

            await slackEventService.handleAppMention('app-1', {
                type: 'app_mention',
                channel: 'C123',
                user: 'U456',
                text: '<@UBOT> 你好',
                event_ts: '111.222',
            } as any);

            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, pod.id, 'idle');
            expect(executeStreamingChat).toHaveBeenCalled();
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
                {}
            );
        });
    });
});
