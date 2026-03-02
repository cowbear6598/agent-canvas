import {slackMessageQueue} from '../../src/services/slack/slackMessageQueue.js';
import type {SlackQueueMessage} from '../../src/types/index.js';

function makeMessage(id: string): SlackQueueMessage {
    return {
        id,
        slackAppId: 'app-1',
        channelId: 'C123',
        userId: 'U123',
        userName: 'testuser',
        text: `訊息 ${id}`,
        eventTs: '1234567890.000001',
    };
}

describe('SlackMessageQueue', () => {
    const podId = 'pod-test-1';

    beforeEach(() => {
        slackMessageQueue.clear(podId);
    });

    describe('enqueue', () => {
        it('推入訊息後 size 增加', () => {
            slackMessageQueue.enqueue(podId, makeMessage('msg-1'));
            expect(slackMessageQueue.size(podId)).toBe(1);
        });

        it('可推入多則訊息', () => {
            slackMessageQueue.enqueue(podId, makeMessage('msg-1'));
            slackMessageQueue.enqueue(podId, makeMessage('msg-2'));
            slackMessageQueue.enqueue(podId, makeMessage('msg-3'));
            expect(slackMessageQueue.size(podId)).toBe(3);
        });

        it('超過 MAX_QUEUE_SIZE(10) 時移除最舊的訊息', () => {
            for (let i = 1; i <= 11; i++) {
                slackMessageQueue.enqueue(podId, makeMessage(`msg-${i}`));
            }

            expect(slackMessageQueue.size(podId)).toBe(10);

            // 最舊的 msg-1 應已被移除，第一則應為 msg-2
            const first = slackMessageQueue.dequeue(podId);
            expect(first?.id).toBe('msg-2');
        });
    });

    describe('dequeue', () => {
        it('依 FIFO 順序取出訊息', () => {
            slackMessageQueue.enqueue(podId, makeMessage('msg-1'));
            slackMessageQueue.enqueue(podId, makeMessage('msg-2'));

            const first = slackMessageQueue.dequeue(podId);
            const second = slackMessageQueue.dequeue(podId);

            expect(first?.id).toBe('msg-1');
            expect(second?.id).toBe('msg-2');
        });

        it('佇列空時回傳 undefined', () => {
            const result = slackMessageQueue.dequeue(podId);
            expect(result).toBeUndefined();
        });

        it('取出最後一則後 Map 中移除該 key（size 為 0）', () => {
            slackMessageQueue.enqueue(podId, makeMessage('msg-1'));
            slackMessageQueue.dequeue(podId);

            expect(slackMessageQueue.size(podId)).toBe(0);
        });
    });

    describe('clear', () => {
        it('清除後 size 為 0', () => {
            slackMessageQueue.enqueue(podId, makeMessage('msg-1'));
            slackMessageQueue.enqueue(podId, makeMessage('msg-2'));

            slackMessageQueue.clear(podId);

            expect(slackMessageQueue.size(podId)).toBe(0);
        });

        it('不同 podId 互不影響', () => {
            const podId2 = 'pod-test-2';
            slackMessageQueue.enqueue(podId, makeMessage('msg-1'));
            slackMessageQueue.enqueue(podId2, makeMessage('msg-2'));

            slackMessageQueue.clear(podId);

            expect(slackMessageQueue.size(podId)).toBe(0);
            expect(slackMessageQueue.size(podId2)).toBe(1);

            slackMessageQueue.clear(podId2);
        });
    });

    describe('size', () => {
        it('不存在的 podId 回傳 0', () => {
            expect(slackMessageQueue.size('nonexistent-pod')).toBe(0);
        });
    });
});
