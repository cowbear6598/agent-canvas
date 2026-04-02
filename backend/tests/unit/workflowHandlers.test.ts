import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetById = vi.fn();
const mockGetDownstreamPods = vi.fn();
const mockClearWorkflow = vi.fn();
const mockEmitSuccess = vi.fn();
const mockEmitError = vi.fn();
const mockEmitNotFound = vi.fn();
const mockEmitToCanvas = vi.fn();
const mockEmitAiDecideClear = vi.fn();

vi.mock('../../src/utils/handlerHelpers.js', () => ({
  withCanvasId: (_event: unknown, handler: (connectionId: string, canvasId: string, payload: unknown, requestId: string) => Promise<void>) =>
    (connectionId: string, payload: unknown, requestId: string) =>
      handler(connectionId, 'canvas-1', payload, requestId),
}));

vi.mock('../../src/services/podStore.js', () => ({
  podStore: {
    getById: mockGetById,
  },
}));

vi.mock('../../src/services/workflowClearService.js', () => ({
  workflowClearService: {
    getDownstreamPods: mockGetDownstreamPods,
    clearWorkflow: mockClearWorkflow,
  },
}));

vi.mock('../../src/utils/websocketResponse.js', () => ({
  emitSuccess: mockEmitSuccess,
  emitError: mockEmitError,
  emitNotFound: mockEmitNotFound,
}));

vi.mock('../../src/services/socketService.js', () => ({
  socketService: {
    emitToCanvas: mockEmitToCanvas,
  },
}));

vi.mock('../../src/services/workflow/index.js', () => ({
  workflowEventEmitter: {
    emitAiDecideClear: mockEmitAiDecideClear,
  },
}));

vi.mock('../../src/schemas/index.js', () => ({
  WebSocketResponseEvents: {
    WORKFLOW_GET_DOWNSTREAM_PODS_RESULT: 'workflow:get-downstream-pods:result',
    WORKFLOW_CLEAR_RESULT: 'workflow:clear:result',
  },
}));

const { handleWorkflowGetDownstreamPods, handleWorkflowClear } =
  await import('../../src/handlers/workflowHandlers.js');

const CONNECTION_ID = 'conn-1';
const REQUEST_ID = 'req-1';
const SOURCE_POD_ID = 'pod-source-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleWorkflowGetDownstreamPods', () => {
  it('來源 pod 存在時應回傳 downstream pods', async () => {
    const mockPod = { id: SOURCE_POD_ID, name: 'Source Pod' };
    const mockDownstreamPods = [
      { id: 'pod-2', name: 'Pod 2' },
      { id: 'pod-3', name: 'Pod 3' },
    ];

    mockGetById.mockReturnValue(mockPod);
    mockGetDownstreamPods.mockReturnValue(mockDownstreamPods);

    await handleWorkflowGetDownstreamPods(CONNECTION_ID, { sourcePodId: SOURCE_POD_ID }, REQUEST_ID);

    expect(mockGetDownstreamPods).toHaveBeenCalledWith('canvas-1', SOURCE_POD_ID);
    expect(mockEmitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      'workflow:get-downstream-pods:result',
      { requestId: REQUEST_ID, success: true, pods: mockDownstreamPods }
    );
  });

  it('來源 pod 不存在時應回傳 NOT_FOUND', async () => {
    mockGetById.mockReturnValue(undefined);

    await handleWorkflowGetDownstreamPods(CONNECTION_ID, { sourcePodId: SOURCE_POD_ID }, REQUEST_ID);

    expect(mockEmitNotFound).toHaveBeenCalledWith(
      CONNECTION_ID,
      'workflow:get-downstream-pods:result',
      "Pod",
      SOURCE_POD_ID,
      REQUEST_ID
    );
    expect(mockGetDownstreamPods).not.toHaveBeenCalled();
  });
});

describe('handleWorkflowClear', () => {
  it('來源 pod 不存在時應回傳 NOT_FOUND', async () => {
    mockGetById.mockReturnValue(undefined);

    await handleWorkflowClear(CONNECTION_ID, { sourcePodId: SOURCE_POD_ID }, REQUEST_ID);

    expect(mockEmitNotFound).toHaveBeenCalledWith(
      CONNECTION_ID,
      'workflow:clear:result',
      "Pod",
      SOURCE_POD_ID,
      REQUEST_ID
    );
    expect(mockClearWorkflow).not.toHaveBeenCalled();
  });

  it('清除成功時應 emitToCanvas', async () => {
    const mockPod = { id: SOURCE_POD_ID, name: 'Source Pod' };
    const mockClearResult = {
      success: true,
      clearedPodIds: [SOURCE_POD_ID, 'pod-2'],
      clearedPodNames: ['Source Pod', 'Pod 2'],
      clearedConnectionIds: [],
    };

    mockGetById.mockReturnValue(mockPod);
    mockClearWorkflow.mockResolvedValue(mockClearResult);

    await handleWorkflowClear(CONNECTION_ID, { sourcePodId: SOURCE_POD_ID }, REQUEST_ID);

    expect(mockClearWorkflow).toHaveBeenCalledWith('canvas-1', SOURCE_POD_ID);
    expect(mockEmitToCanvas).toHaveBeenCalledWith(
      'canvas-1',
      'workflow:clear:result',
      expect.objectContaining({
        requestId: REQUEST_ID,
        canvasId: 'canvas-1',
        success: true,
        clearedPodIds: mockClearResult.clearedPodIds,
        clearedPodNames: mockClearResult.clearedPodNames,
      })
    );
  });
});
