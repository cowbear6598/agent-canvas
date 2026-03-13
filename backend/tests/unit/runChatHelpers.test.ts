import type { Mock } from 'vitest';

vi.mock('../../src/services/runStore.js', () => ({
    runStore: {
        addRunMessage: vi.fn(),
    },
}));

vi.mock('../../src/services/socketService.js', () => ({
    socketService: {
        emitToCanvas: vi.fn(),
    },
}));

vi.mock('../../src/services/podStore.js', () => ({
    podStore: {
        setStatus: vi.fn(),
    },
}));

import { beforeEach, describe, expect, it } from 'vitest';
import { injectRunUserMessage } from '../../src/utils/runChatHelpers.js';
import { runStore } from '../../src/services/runStore.js';
import { socketService } from '../../src/services/socketService.js';
import { podStore } from '../../src/services/podStore.js';
import { WebSocketResponseEvents } from '../../src/schemas/events.js';
import type { RunContext } from '../../src/types/run.js';
import type { ContentBlock } from '../../src/types/index.js';

function asMock(fn: unknown): Mock<any> {
    return fn as Mock<any>;
}

const RUN_CONTEXT: RunContext = {
    runId: 'run-1',
    canvasId: 'canvas-1',
    sourcePodId: 'pod-source',
};

const POD_ID = 'pod-1';

describe('injectRunUserMessage', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        asMock(runStore.addRunMessage).mockResolvedValue(undefined);
    });

    it('應呼叫 runStore.addRunMessage 寫入 run message', async () => {
        await injectRunUserMessage(RUN_CONTEXT, POD_ID, '測試訊息');

        expect(runStore.addRunMessage).toHaveBeenCalledWith(
            RUN_CONTEXT.runId,
            POD_ID,
            'user',
            '測試訊息',
        );
    });

    it('應透過 socketService.emitToCanvas 發送 RUN_MESSAGE 事件', async () => {
        await injectRunUserMessage(RUN_CONTEXT, POD_ID, '廣播測試');

        expect(socketService.emitToCanvas).toHaveBeenCalledWith(
            RUN_CONTEXT.canvasId,
            WebSocketResponseEvents.RUN_MESSAGE,
            expect.objectContaining({
                runId: RUN_CONTEXT.runId,
                canvasId: RUN_CONTEXT.canvasId,
                podId: POD_ID,
                content: '廣播測試',
                messageId: expect.any(String),
                isPartial: false,
                role: 'user',
            }),
        );
    });

    it('不應呼叫 podStore.setStatus（run mode 不改全域狀態）', async () => {
        await injectRunUserMessage(RUN_CONTEXT, POD_ID, '測試');

        expect(podStore.setStatus).not.toHaveBeenCalled();
    });

    it('content 為 string 時應正確寫入原始字串', async () => {
        await injectRunUserMessage(RUN_CONTEXT, POD_ID, '純文字訊息');

        expect(runStore.addRunMessage).toHaveBeenCalledWith(
            RUN_CONTEXT.runId,
            POD_ID,
            'user',
            '純文字訊息',
        );
        expect(socketService.emitToCanvas).toHaveBeenCalledWith(
            RUN_CONTEXT.canvasId,
            WebSocketResponseEvents.RUN_MESSAGE,
            expect.objectContaining({ content: '純文字訊息' }),
        );
    });

    it('content 為 ContentBlock[] 時應經 extractDisplayContent 轉換後寫入', async () => {
        const blocks: ContentBlock[] = [
            { type: 'text', text: '區塊文字' },
            { type: 'image', mediaType: 'image/png', base64Data: 'xyz' },
        ];

        await injectRunUserMessage(RUN_CONTEXT, POD_ID, blocks);

        const expectedDisplay = '區塊文字[image]';
        expect(runStore.addRunMessage).toHaveBeenCalledWith(
            RUN_CONTEXT.runId,
            POD_ID,
            'user',
            expectedDisplay,
        );
        expect(socketService.emitToCanvas).toHaveBeenCalledWith(
            RUN_CONTEXT.canvasId,
            WebSocketResponseEvents.RUN_MESSAGE,
            expect.objectContaining({ content: expectedDisplay }),
        );
    });
});
