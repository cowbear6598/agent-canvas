vi.mock('../../src/services/claude/claudeService.js', () => ({
    claudeService: {
        sendMessage: vi.fn(() => Promise.resolve({})),
        abortQuery: vi.fn(() => true),
    },
}));

vi.mock('../../src/services/socketService.js', () => ({
    socketService: {
        emitToCanvas: vi.fn(() => {}),
        cleanupSocket: vi.fn(() => {}),
        joinCanvasRoom: vi.fn(() => {}),
    },
}));

vi.mock('../../src/services/canvasStore.js', () => ({
    canvasStore: {
        removeSocket: vi.fn(() => {}),
        getBySocket: vi.fn(() => null),
    },
}));

vi.mock('../../src/handlers/cursorHandlers.js', () => ({
    broadcastCursorLeft: vi.fn(() => {}),
}));

import { claudeService } from '../../src/services/claude/claudeService.js';
import { socketService } from '../../src/services/socketService.js';

function asMock(fn: unknown) {
    return fn as ReturnType<typeof vi.fn>;
}

describe('斷線重連行為', () => {
    beforeEach(() => {
        asMock(claudeService.sendMessage).mockClear();
        asMock(claudeService.abortQuery).mockClear();
        asMock(socketService.cleanupSocket).mockClear();
    });

    describe('斷線後活躍查詢不被中斷', () => {
        it('呼叫 cleanupSocket 不會觸發 abortQuery', async () => {
            const podId = 'pod-1';
            const connectionId = 'conn-A';

            let resolveQuery!: () => void;
            asMock(claudeService.sendMessage).mockImplementation(
                () => new Promise<void>((resolve) => { resolveQuery = resolve; })
            );

            const queryPromise = claudeService.sendMessage(podId, 'test message', vi.fn());

            socketService.cleanupSocket(connectionId);

            expect(claudeService.abortQuery).not.toHaveBeenCalled();

            resolveQuery();
            await expect(queryPromise).resolves.toBeUndefined();
        });
    });

    describe('重連後以新 connectionId 發送停止請求應成功', () => {
        it('以不同 connectionId 發送 abort 請求仍能成功中斷查詢', () => {
            const podId = 'pod-1';

            const aborted = claudeService.abortQuery(podId);

            expect(claudeService.abortQuery).toHaveBeenCalledWith(podId);
            expect(aborted).toBe(true);
        });

        it('連線 A 斷線後，連線 B 可以發送 abort 請求', () => {
            const podId = 'pod-1';
            const connectionIdA = 'conn-A';

            socketService.cleanupSocket(connectionIdA);

            const abortedByB = claudeService.abortQuery(podId);

            expect(abortedByB).toBe(true);
            expect(claudeService.abortQuery).toHaveBeenCalledWith(podId);
        });

        it('多次斷線重連後 abort 仍能正常運作', () => {
            const podId = 'pod-1';

            socketService.cleanupSocket('conn-1');
            socketService.cleanupSocket('conn-2');
            socketService.cleanupSocket('conn-3');

            // 每次斷線都未觸發 abortQuery
            expect(claudeService.abortQuery).not.toHaveBeenCalled();

            // 最終以新連線 abort 仍可成功
            const aborted = claudeService.abortQuery(podId);
            expect(aborted).toBe(true);
        });
    });
});
