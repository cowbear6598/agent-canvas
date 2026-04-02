import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDeleteRun = vi.fn();
const mockGetRun = vi.fn();
const mockGetRunsByCanvasId = vi.fn();
const mockGetPodInstancesByRunId = vi.fn();
const mockGetById = vi.fn();
const mockGetRunMessages = vi.fn();
const mockEmitSuccess = vi.fn();
const mockEmitError = vi.fn();

vi.mock('../../src/utils/handlerHelpers.js', () => ({
    withCanvasId: (_event: unknown, handler: (connectionId: string, canvasId: string, payload: unknown, requestId: string) => Promise<void>) =>
        (connectionId: string, payload: unknown, requestId: string) =>
            handler(connectionId, 'canvas-1', payload, requestId),
}));

vi.mock('../../src/services/workflow/runExecutionService.js', () => ({
    runExecutionService: {
        deleteRun: mockDeleteRun,
    },
}));

vi.mock('../../src/services/runStore.js', () => ({
    runStore: {
        getRun: mockGetRun,
        getRunsByCanvasId: mockGetRunsByCanvasId,
        getPodInstancesByRunId: mockGetPodInstancesByRunId,
        getRunMessages: mockGetRunMessages,
    },
}));

vi.mock('../../src/services/podStore.js', () => ({
    podStore: {
        getById: mockGetById,
    },
}));

vi.mock('../../src/utils/websocketResponse.js', () => ({
    emitSuccess: mockEmitSuccess,
    emitError: mockEmitError,
}));

vi.mock('../../src/schemas/index.js', () => ({
    WebSocketResponseEvents: {
        RUN_DELETED: 'run:deleted',
        RUN_HISTORY_LOADED: 'run:history:result',
        RUN_POD_MESSAGES_LOADED: 'run:pod-messages:result',
    },
}));

const { handleRunDelete, handleRunLoadHistory, handleRunLoadPodMessages } =
    await import('../../src/handlers/runHandlers.js');

const CONNECTION_ID = 'conn-1';
const CANVAS_ID = 'canvas-1';
const RUN_ID = 'run-uuid-1';
const POD_ID = 'pod-uuid-1';
const REQUEST_ID = 'req-1';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRunDelete', () => {
    it('應呼叫 runExecutionService.deleteRun 傳入 runId', async () => {
        mockGetRun.mockReturnValue({ id: RUN_ID, canvasId: CANVAS_ID });

        await handleRunDelete(CONNECTION_ID, { runId: RUN_ID }, REQUEST_ID);

        expect(mockDeleteRun).toHaveBeenCalledWith(RUN_ID);
    });

    it('不應自行發送 WebSocket 事件（由 deleteRun 內部處理）', async () => {
        mockGetRun.mockReturnValue({ id: RUN_ID, canvasId: CANVAS_ID });

        await handleRunDelete(CONNECTION_ID, { runId: RUN_ID }, REQUEST_ID);

        expect(mockEmitSuccess).not.toHaveBeenCalled();
    });

    it('runId 不存在時應回傳 NOT_FOUND 錯誤，不執行刪除', async () => {
        mockGetRun.mockReturnValue(undefined);

        await handleRunDelete(CONNECTION_ID, { runId: RUN_ID }, REQUEST_ID);

        expect(mockDeleteRun).not.toHaveBeenCalled();
        expect(mockEmitError).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:deleted',
            expect.objectContaining({ key: expect.any(String) }),
            REQUEST_ID,
            undefined,
            'NOT_FOUND'
        );
    });

    it('runId 屬於其他 canvas 時應回傳 NOT_FOUND 錯誤，不執行刪除', async () => {
        mockGetRun.mockReturnValue({ id: RUN_ID, canvasId: 'other-canvas' });

        await handleRunDelete(CONNECTION_ID, { runId: RUN_ID }, REQUEST_ID);

        expect(mockDeleteRun).not.toHaveBeenCalled();
        expect(mockEmitError).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:deleted',
            expect.objectContaining({ key: expect.any(String) }),
            REQUEST_ID,
            undefined,
            'NOT_FOUND'
        );
    });
});

describe('handleRunLoadHistory', () => {
    it('應取得 canvas 下所有 run 並組合 podInstances 與 sourcePodName', async () => {
        const mockRun = {
            id: RUN_ID,
            canvasId: CANVAS_ID,
            sourcePodId: POD_ID,
            triggerMessage: '測試',
            status: 'completed',
            createdAt: '2024-01-01T00:00:00.000Z',
            completedAt: null,
        };
        const mockInstance = {
            id: 'instance-1',
            runId: RUN_ID,
            podId: POD_ID,
            status: 'completed',
            claudeSessionId: null,
            errorMessage: null,
            triggeredAt: null,
            completedAt: null,
        };
        const mockPod = { id: POD_ID, name: 'Source Pod' };

        mockGetRunsByCanvasId.mockReturnValue([mockRun]);
        mockGetPodInstancesByRunId.mockReturnValue([mockInstance]);
        mockGetById.mockReturnValue(mockPod);

        await handleRunLoadHistory(CONNECTION_ID, {}, REQUEST_ID);

        expect(mockGetRunsByCanvasId).toHaveBeenCalledWith(CANVAS_ID);
        expect(mockGetPodInstancesByRunId).toHaveBeenCalledWith(RUN_ID);
        expect(mockEmitSuccess).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:history:result',
            expect.objectContaining({
                requestId: REQUEST_ID,
                success: true,
                runs: expect.arrayContaining([
                    expect.objectContaining({
                        id: RUN_ID,
                        sourcePodName: 'Source Pod',
                        podInstances: expect.arrayContaining([
                            expect.objectContaining({
                                id: 'instance-1',
                                podName: 'Source Pod',
                            }),
                        ]),
                    }),
                ]),
            })
        );
    });

    it('pod 不存在時 sourcePodName 應 fallback 為 podId', async () => {
        const mockRun = {
            id: RUN_ID,
            canvasId: CANVAS_ID,
            sourcePodId: POD_ID,
            triggerMessage: '測試',
            status: 'running',
            createdAt: '2024-01-01T00:00:00.000Z',
            completedAt: null,
        };

        mockGetRunsByCanvasId.mockReturnValue([mockRun]);
        mockGetPodInstancesByRunId.mockReturnValue([]);
        mockGetById.mockReturnValue(undefined);

        await handleRunLoadHistory(CONNECTION_ID, {}, REQUEST_ID);

        expect(mockEmitSuccess).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:history:result',
            expect.objectContaining({
                runs: expect.arrayContaining([
                    expect.objectContaining({
                        sourcePodName: POD_ID,
                    }),
                ]),
            })
        );
    });

    it('instance 的 pod 不存在時 podName 應 fallback 為 podId', async () => {
        const unknownPodId = 'unknown-pod-id';
        const mockRun = {
            id: RUN_ID,
            canvasId: CANVAS_ID,
            sourcePodId: POD_ID,
            triggerMessage: '測試',
            status: 'running',
            createdAt: '2024-01-01T00:00:00.000Z',
            completedAt: null,
        };
        const mockInstance = {
            id: 'instance-1',
            runId: RUN_ID,
            podId: unknownPodId,
            status: 'pending',
            claudeSessionId: null,
            errorMessage: null,
            triggeredAt: null,
            completedAt: null,
        };

        mockGetRunsByCanvasId.mockReturnValue([mockRun]);
        mockGetPodInstancesByRunId.mockReturnValue([mockInstance]);
        mockGetById.mockReturnValue(undefined);

        await handleRunLoadHistory(CONNECTION_ID, {}, REQUEST_ID);

        const callArg = mockEmitSuccess.mock.calls[0][2];
        const instance = callArg.runs[0].podInstances[0];
        expect(instance.podName).toBe(unknownPodId);
    });

    it('canvas 無 run 時應回傳空陣列', async () => {
        mockGetRunsByCanvasId.mockReturnValue([]);

        await handleRunLoadHistory(CONNECTION_ID, {}, REQUEST_ID);

        expect(mockEmitSuccess).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:history:result',
            expect.objectContaining({
                success: true,
                runs: [],
            })
        );
    });
});

describe('handleRunLoadPodMessages', () => {
    it('應呼叫 getRunMessages 並發送訊息清單', async () => {
        const mockMessages = [
            { id: 'msg-1', role: 'user', content: '你好', timestamp: '2024-01-01T00:00:00.000Z' },
            { id: 'msg-2', role: 'assistant', content: '哈囉', timestamp: '2024-01-01T00:00:01.000Z' },
        ];

        mockGetRun.mockReturnValue({ id: RUN_ID, canvasId: CANVAS_ID });
        mockGetRunMessages.mockReturnValue(mockMessages);

        await handleRunLoadPodMessages(CONNECTION_ID, { runId: RUN_ID, podId: POD_ID }, REQUEST_ID);

        expect(mockGetRunMessages).toHaveBeenCalledWith(RUN_ID, POD_ID);
        expect(mockEmitSuccess).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:pod-messages:result',
            {
                requestId: REQUEST_ID,
                success: true,
                messages: mockMessages,
            }
        );
    });

    it('無訊息時應回傳空陣列', async () => {
        mockGetRun.mockReturnValue({ id: RUN_ID, canvasId: CANVAS_ID });
        mockGetRunMessages.mockReturnValue([]);

        await handleRunLoadPodMessages(CONNECTION_ID, { runId: RUN_ID, podId: POD_ID }, REQUEST_ID);

        expect(mockEmitSuccess).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:pod-messages:result',
            expect.objectContaining({
                success: true,
                messages: [],
            })
        );
    });

    it('runId 不存在時應回傳 NOT_FOUND 錯誤，不載入訊息', async () => {
        mockGetRun.mockReturnValue(undefined);

        await handleRunLoadPodMessages(CONNECTION_ID, { runId: RUN_ID, podId: POD_ID }, REQUEST_ID);

        expect(mockGetRunMessages).not.toHaveBeenCalled();
        expect(mockEmitError).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:pod-messages:result',
            expect.objectContaining({ key: expect.any(String) }),
            REQUEST_ID,
            undefined,
            'NOT_FOUND'
        );
    });

    it('runId 屬於其他 canvas 時應回傳 NOT_FOUND 錯誤，不載入訊息', async () => {
        mockGetRun.mockReturnValue({ id: RUN_ID, canvasId: 'other-canvas' });

        await handleRunLoadPodMessages(CONNECTION_ID, { runId: RUN_ID, podId: POD_ID }, REQUEST_ID);

        expect(mockGetRunMessages).not.toHaveBeenCalled();
        expect(mockEmitError).toHaveBeenCalledWith(
            CONNECTION_ID,
            'run:pod-messages:result',
            expect.objectContaining({ key: expect.any(String) }),
            REQUEST_ID,
            undefined,
            'NOT_FOUND'
        );
    });
});
