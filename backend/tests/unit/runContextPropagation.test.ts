import type { Mock } from 'vitest';

vi.mock('../../src/services/canvasStore.js', () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => 'canvas-1'),
  },
}));

vi.mock('../../src/services/podStore.js', () => ({
  podStore: {
    getById: vi.fn(),
    setStatus: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../src/services/messageStore.js', () => ({
  messageStore: {
    getMessages: vi.fn(() => []),
    upsertMessage: vi.fn(),
    clearMessages: vi.fn(),
  },
}));

vi.mock('../../src/services/runStore.js', () => ({
  runStore: {
    createRun: vi.fn(),
    getRun: vi.fn(),
    createPodInstance: vi.fn(),
    getPodInstance: vi.fn(),
    getPodInstancesByRunId: vi.fn(() => []),
    updatePodInstanceStatus: vi.fn(),
    updatePodInstanceClaudeSessionId: vi.fn(),
    getRunningPodInstances: vi.fn(() => []),
    addRunMessage: vi.fn(),
    upsertRunMessage: vi.fn(),
    getRunMessages: vi.fn(() => []),
    countRunsByCanvasId: vi.fn(() => 0),
    getOldestCompletedRunIds: vi.fn(() => []),
    deleteRun: vi.fn(),
    updateRunStatus: vi.fn(),
    getRunsByCanvasId: vi.fn(() => []),
  },
}));

vi.mock('../../src/services/workflow/runExecutionService.js', () => ({
  runExecutionService: {
    createRun: vi.fn(),
    startPodInstance: vi.fn(),
    completePodInstance: vi.fn(),
    errorPodInstance: vi.fn(),
    summarizingPodInstance: vi.fn(),
    skipPodInstance: vi.fn(),
    registerActiveStream: vi.fn(),
    unregisterActiveStream: vi.fn(),
    deleteRun: vi.fn(),
  },
}));

vi.mock('../../src/services/claude/streamingChatExecutor.js', () => ({
  executeStreamingChat: vi.fn(() =>
    Promise.resolve({ messageId: 'msg-1', content: '回覆', hasContent: true, aborted: false })
  ),
}));

vi.mock('../../src/utils/runChatHelpers.js', () => ({
  injectRunUserMessage: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/utils/chatHelpers.js', () => ({
  injectUserMessage: vi.fn(() => Promise.resolve()),
  extractDisplayContent: vi.fn((msg: unknown) => (typeof msg === 'string' ? msg : '顯示內容')),
}));

vi.mock('../../src/utils/chatCallbacks.js', () => ({
  onChatComplete: vi.fn(() => Promise.resolve()),
  onChatAborted: vi.fn(),
  onRunChatComplete: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/services/socketService.js', () => ({
  socketService: {
    emitToCanvas: vi.fn(),
    emitToAll: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/websocketResponse.js', () => ({
  emitError: vi.fn(),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

vi.mock('../../src/services/workflow/workflowExecutionService.js', () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: vi.fn(() => Promise.resolve()),
    triggerWorkflowWithSummary: vi.fn(() => Promise.resolve()),
    generateSummaryWithFallback: vi.fn(),
  },
}));

vi.mock('../../src/services/workflow/index.js', () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: vi.fn(() => Promise.resolve()),
    triggerWorkflowWithSummary: vi.fn(() => Promise.resolve()),
    generateSummaryWithFallback: vi.fn(),
  },
  workflowQueueService: {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    getQueueSize: vi.fn(() => 0),
    processNextInQueue: vi.fn(() => Promise.resolve()),
    init: vi.fn(),
  },
}));

vi.mock('../../src/services/connectionStore.js', () => ({
  connectionStore: {
    findBySourcePodId: vi.fn(() => []),
    getById: vi.fn(),
    updateDecideStatus: vi.fn(),
    updateConnectionStatus: vi.fn(),
    findByTargetPodId: vi.fn(() => []),
  },
}));

vi.mock('../../src/services/commandService.js', () => ({
  commandService: {
    list: vi.fn(() => Promise.resolve([])),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleChatSend } from '../../src/handlers/chatHandlers.js';
import { podStore } from '../../src/services/podStore.js';
import { messageStore } from '../../src/services/messageStore.js';
import { runExecutionService } from '../../src/services/workflow/runExecutionService.js';
import { executeStreamingChat } from '../../src/services/claude/streamingChatExecutor.js';
import { injectUserMessage } from '../../src/utils/chatHelpers.js';
import { injectRunUserMessage } from '../../src/utils/runChatHelpers.js';
import { runStore } from '../../src/services/runStore.js';
import type { Pod } from '../../src/types/index.js';
import type { RunContext } from '../../src/types/run.js';

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

const CONNECTION_ID = 'conn-ws-1';
const CANVAS_ID = 'canvas-1';
const SOURCE_POD_ID = 'source-pod';
const REQUEST_ID = 'req-1';

const TEST_RUN_CONTEXT: RunContext = {
  runId: 'test-run-id',
  canvasId: CANVAS_ID,
  sourcePodId: SOURCE_POD_ID,
};

function makeMultiInstancePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: SOURCE_POD_ID,
    name: 'Multi-Instance Pod',
    status: 'idle',
    workspacePath: '/workspace',
    x: 0,
    y: 0,
    rotation: 0,
    claudeSessionId: null,
    outputStyleId: null,
    repositoryId: null,
    commandId: null,
    skillIds: [],
    subAgentIds: [],
    model: 'sonnet',
    multiInstance: true,
    integrationBindings: undefined,
    ...overrides,
  } as Pod;
}

function makeNormalPod(overrides: Partial<Pod> = {}): Pod {
  return {
    ...makeMultiInstancePod(),
    multiInstance: false,
    ...overrides,
  };
}

describe('RunContext 傳遞驗證', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    asMock(runExecutionService.createRun).mockResolvedValue(TEST_RUN_CONTEXT);
    asMock(runExecutionService.startPodInstance).mockImplementation(() => {});
    asMock(runExecutionService.completePodInstance).mockImplementation(() => {});
    asMock(executeStreamingChat).mockResolvedValue({ messageId: 'msg-1', content: '回覆', hasContent: true, aborted: false });
    asMock(injectUserMessage).mockResolvedValue(undefined);
    asMock(injectRunUserMessage).mockResolvedValue(undefined);
  });

  describe('1. RunContext 從 chatHandlers 傳入 runExecutionService', () => {
    it('multiInstance pod 時呼叫 runExecutionService.createRun 並傳入 canvasId 與 podId', async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(runExecutionService.createRun).toHaveBeenCalledWith(
        CANVAS_ID,
        SOURCE_POD_ID,
        expect.any(String)
      );
    });

    it('multiInstance pod 時 executeStreamingChat 收到包含 runContext 的 options', async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(executeStreamingChat).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          podId: SOURCE_POD_ID,
          runContext: TEST_RUN_CONTEXT,
        }),
        expect.any(Object)
      );
    });
  });

  describe('2. 有 RunContext 時 message 寫入 run_messages 而非 messages', () => {
    it('multiInstance 時呼叫 injectRunUserMessage 而非 injectUserMessage', async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(injectRunUserMessage).toHaveBeenCalledWith(
        TEST_RUN_CONTEXT,
        SOURCE_POD_ID,
        '測試訊息'
      );
      expect(injectUserMessage).not.toHaveBeenCalled();
    });

    it('有 RunContext 時 streaming 過程呼叫 runStore.upsertRunMessage 而非 messageStore.upsertMessage', async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      // 模擬 executeStreamingChat 過程中呼叫 runStore.upsertRunMessage
      asMock(executeStreamingChat).mockImplementation(async (options: { runContext?: RunContext }) => {
        if (options.runContext) {
          runStore.upsertRunMessage(options.runContext.runId, SOURCE_POD_ID, {
            id: 'msg-1',
            role: 'assistant',
            content: '回覆',
            timestamp: new Date().toISOString(),
          });
        } else {
          messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
            id: 'msg-1',
            role: 'assistant',
            content: '回覆',
            timestamp: new Date().toISOString(),
          });
        }
        return { messageId: 'msg-1', content: '回覆', hasContent: true, aborted: false };
      });

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(runStore.upsertRunMessage).toHaveBeenCalled();
      expect(messageStore.upsertMessage).not.toHaveBeenCalled();
    });
  });

  describe('3. 有 RunContext 時不更新 pod 全域狀態', () => {
    it('multiInstance 時不呼叫 podStore.setStatus', async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(podStore.setStatus).not.toHaveBeenCalled();
    });

    it('multiInstance 時呼叫 runExecutionService.startPodInstance', async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(runExecutionService.startPodInstance).toHaveBeenCalledWith(
        TEST_RUN_CONTEXT,
        SOURCE_POD_ID
      );
    });
  });

  describe('4. 無 RunContext 時完全向後相容', () => {
    it('非 multiInstance pod 時呼叫 injectUserMessage 而非 injectRunUserMessage', async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(injectUserMessage).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        podId: SOURCE_POD_ID,
        content: '測試訊息',
      });
      expect(injectRunUserMessage).not.toHaveBeenCalled();
    });

    it('非 multiInstance 時不呼叫 runExecutionService.createRun', async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(runExecutionService.createRun).not.toHaveBeenCalled();
    });

    it('非 multiInstance 時 executeStreamingChat 不傳 runContext', async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      const callArgs = asMock(executeStreamingChat).mock.calls[0][0];
      expect(callArgs.runContext).toBeUndefined();
    });

    it('非 multiInstance 時 streaming 過程呼叫 messageStore.upsertMessage 而非 runStore.upsertRunMessage', async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      asMock(executeStreamingChat).mockImplementation(async (options: { runContext?: RunContext }) => {
        if (options.runContext) {
          runStore.upsertRunMessage(options.runContext.runId, SOURCE_POD_ID, {
            id: 'msg-1',
            role: 'assistant',
            content: '回覆',
            timestamp: new Date().toISOString(),
          });
        } else {
          messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
            id: 'msg-1',
            role: 'assistant',
            content: '回覆',
            timestamp: new Date().toISOString(),
          });
        }
        return { messageId: 'msg-1', content: '回覆', hasContent: true, aborted: false };
      });

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      expect(messageStore.upsertMessage).toHaveBeenCalled();
      expect(runStore.upsertRunMessage).not.toHaveBeenCalled();
    });
  });

  describe('5. checkAndTriggerWorkflows RunContext 傳遞', () => {
    it('multiInstance 時傳給 executeStreamingChat 的 onComplete 為 onRunChatComplete 的呼叫', async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      let capturedOnComplete: ((cId: string, pId: string) => void | Promise<void>) | undefined;

      asMock(executeStreamingChat).mockImplementation(async (_opts: unknown, callbacks: { onComplete?: (cId: string, pId: string) => Promise<void> }) => {
        capturedOnComplete = callbacks?.onComplete;
        return { messageId: 'msg-1', content: '回覆', hasContent: true, aborted: false };
      });

      await handleChatSend(CONNECTION_ID, { podId: SOURCE_POD_ID, message: '測試訊息' }, REQUEST_ID);

      // 驗證 onComplete callback 已被設定（來自 onRunChatComplete 的閉包）
      expect(capturedOnComplete).toBeDefined();

      // 呼叫 callback，驗證它會觸發 runExecutionService.completePodInstance
      if (capturedOnComplete) {
        await capturedOnComplete(CANVAS_ID, SOURCE_POD_ID);
      }

      // onRunChatComplete 本體呼叫 runExecutionService.completePodInstance 和 checkAndTriggerWorkflows
      // 但 onRunChatComplete 被 mock 了，所以驗證 onRunChatComplete mock 有被呼叫
      const { onRunChatComplete } = await import('../../src/utils/chatCallbacks.js');
      expect(onRunChatComplete).toHaveBeenCalledWith(
        TEST_RUN_CONTEXT,
        CANVAS_ID,
        SOURCE_POD_ID
      );
    });
  });
});
