import type { Mock } from 'vitest';

vi.mock('../../src/services/podStore.js', () => ({
  podStore: {
    findByIntegrationAppAndResource: vi.fn(() => []),
    getById: vi.fn(),
    setStatus: vi.fn(),
  },
}));

vi.mock('../../src/services/messageStore.js', () => ({
  messageStore: {
    addMessage: vi.fn(() => Promise.resolve({ success: true, data: { id: 'msg-1' } })),
  },
}));

vi.mock('../../src/services/socketService.js', () => ({
  socketService: {
    emitToCanvas: vi.fn(),
  },
}));

vi.mock('../../src/services/claude/streamingChatExecutor.js', () => ({
  executeStreamingChat: vi.fn(() => Promise.resolve({ messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false })),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/services/workflow/index.js', () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../src/utils/workflowChainTraversal.js', () => ({
  isWorkflowChainBusy: vi.fn(() => false),
}));

vi.mock('../../src/services/integration/integrationRegistry.js', () => ({
  integrationRegistry: {
    get: vi.fn(() => undefined),
  },
}));

vi.mock('../../src/services/workflow/runExecutionService.js', () => ({
  runExecutionService: {
    createRun: vi.fn(() => Promise.resolve({ runId: 'run-1', canvasId: 'canvas-1' })),
    startPodInstance: vi.fn(),
    settlePodTrigger: vi.fn(),
  },
}));

vi.mock('../../src/utils/runChatHelpers.js', () => ({
  injectRunUserMessage: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/utils/chatCallbacks.js', () => ({
  onRunChatComplete: vi.fn(),
  onChatComplete: vi.fn(),
  onChatAborted: vi.fn(),
}));

vi.mock('../../src/services/integration/replyContextStore.js', () => ({
  replyContextStore: {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
  buildReplyContextKey: vi.fn((runContext: unknown, podId: string) => {
    if (runContext && typeof runContext === 'object' && 'runId' in runContext) {
      return `${(runContext as { runId: string }).runId}:${podId}`;
    }
    return `pod:${podId}`;
  }),
}));

import { integrationEventPipeline } from '../../src/services/integration/integrationEventPipeline.js';
import { podStore } from '../../src/services/podStore.js';
import { messageStore } from '../../src/services/messageStore.js';
import { socketService } from '../../src/services/socketService.js';
import { executeStreamingChat } from '../../src/services/claude/streamingChatExecutor.js';
import { workflowExecutionService } from '../../src/services/workflow/index.js';
import { isWorkflowChainBusy } from '../../src/utils/workflowChainTraversal.js';
import { integrationRegistry } from '../../src/services/integration/integrationRegistry.js';
import { runExecutionService } from '../../src/services/workflow/runExecutionService.js';
import { injectRunUserMessage } from '../../src/utils/runChatHelpers.js';
import { onRunChatComplete } from '../../src/utils/chatCallbacks.js';
import { replyContextStore } from '../../src/services/integration/replyContextStore.js';
import { WebSocketResponseEvents } from '../../src/schemas/events.js';
import type { Pod } from '../../src/types/index.js';
import type { NormalizedEvent } from '../../src/services/integration/types.js';
import type { RunContext } from '../../src/types/run.js';

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
    multiInstance: false,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    provider: 'slack',
    appId: 'app-1',
    resourceId: 'C123',
    userName: 'testuser',
    text: '[Slack: @testuser] <user_data>測試訊息</user_data>',
    rawEvent: {},
    ...overrides,
  };
}

describe('IntegrationEventPipeline', () => {
  const canvasId = 'canvas-1';
  const podId = 'pod-1';

  const mockRunContext: RunContext = { runId: 'run-1', canvasId: 'canvas-1' };

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([]);
    asMock(podStore.getById).mockReturnValue(undefined);
    asMock(messageStore.addMessage).mockResolvedValue({ success: true, data: { id: 'msg-1' } });
    asMock(executeStreamingChat).mockResolvedValue({ messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false });
    asMock(workflowExecutionService.checkAndTriggerWorkflows).mockResolvedValue(undefined);
    asMock(isWorkflowChainBusy).mockReturnValue(false);
    asMock(integrationRegistry.get).mockReturnValue(undefined);
    asMock(runExecutionService.createRun).mockResolvedValue(mockRunContext);
    asMock(runExecutionService.startPodInstance).mockReturnValue(undefined);
    asMock(injectRunUserMessage).mockResolvedValue(undefined);
    asMock(onRunChatComplete).mockReturnValue(undefined);
    asMock(replyContextStore.set).mockReturnValue(undefined);
    asMock(replyContextStore.get).mockReturnValue(undefined);
    asMock(replyContextStore.delete).mockReturnValue(undefined);
  });

  describe('processEvent', () => {
    it('找不到綁定 Pod 時不呼叫 executeStreamingChat', async () => {
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([]);

      await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

      expect(executeStreamingChat).not.toHaveBeenCalled();
    });

    it('正確注入訊息至綁定的 Pod', async () => {
      const pod = makePod();
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
      asMock(podStore.getById).mockReturnValue(pod);

      await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

      expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'chatting');
      expect(messageStore.addMessage).toHaveBeenCalledWith(
        canvasId,
        podId,
        'user',
        '[Slack: @testuser] <user_data>測試訊息</user_data>'
      );
      expect(executeStreamingChat).toHaveBeenCalledWith(
        expect.objectContaining({ canvasId, podId, abortable: false }),
        { onComplete: expect.any(Function) }
      );
    });

    it('廣播 POD_CHAT_USER_MESSAGE 事件至前端', async () => {
      const pod = makePod();
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
      asMock(podStore.getById).mockReturnValue(pod);

      await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_USER_MESSAGE,
        expect.objectContaining({
          canvasId,
          podId,
          content: '[Slack: @testuser] <user_data>測試訊息</user_data>',
        })
      );
    });

    it('完成後應觸發 workflow', async () => {
      const pod = makePod();
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
      asMock(podStore.getById).mockReturnValue(pod);

      asMock(executeStreamingChat).mockImplementationOnce(async (_params: unknown, options: { onComplete?: (cId: string, pId: string) => Promise<void> }) => {
        if (options?.onComplete) {
          await options.onComplete(canvasId, podId);
        }
        return { messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false };
      });

      await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

      await vi.waitFor(() => {
        expect(workflowExecutionService.checkAndTriggerWorkflows).toHaveBeenCalledWith(canvasId, podId);
      });
    });

    describe('忙碌處理', () => {
      it('資源忙碌時不注入訊息', async () => {
        const pod = makePod({ status: 'chatting' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(executeStreamingChat).not.toHaveBeenCalled();
      });

      it('資源忙碌且 Provider 有 sendMessage 時發送忙碌回覆', async () => {
        const pod = makePod({ status: 'chatting' });
        // 使用不同的 resourceId 避免 singleton busyReplyCooldowns 狀態干擾
        const event = makeEvent({ resourceId: 'C-sendmsg-test' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        const mockSendMessage = vi.fn(() => Promise.resolve({ success: true as const }));
        asMock(integrationRegistry.get).mockReturnValue({ sendMessage: mockSendMessage });

        await integrationEventPipeline.processEvent('slack', 'app-1', event);

        expect(mockSendMessage).toHaveBeenCalledWith('app-1', 'C-sendmsg-test', '目前忙碌中，請稍後再試');
      });

      it('資源忙碌且 Provider 無 sendMessage 時不拋出錯誤', async () => {
        const pod = makePod({ status: 'chatting' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        asMock(integrationRegistry.get).mockReturnValue({});

        await expect(
          integrationEventPipeline.processEvent('slack', 'app-1', makeEvent())
        ).resolves.not.toThrow();
      });

      it('同一資源短時間內第二次忙碌不再發送忙碌回覆', async () => {
        const pod = makePod({ status: 'chatting', id: 'pod-busy' });
        // findByIntegrationAppAndResource 在 isResourceBusy 內也被呼叫，需統一回傳
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        const mockSendMessage = vi.fn(() => Promise.resolve({ success: true as const }));
        asMock(integrationRegistry.get).mockReturnValue({ sendMessage: mockSendMessage });

        const mockNow = vi.spyOn(Date, 'now');
        mockNow.mockReturnValue(200_000_000);

        const event = makeEvent({ resourceId: 'C-busy' });
        await integrationEventPipeline.processEvent('slack', 'app-1', event);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);

        // 模擬 10 秒後（30 秒冷卻未到）
        mockNow.mockReturnValue(200_010_000);
        await integrationEventPipeline.processEvent('slack', 'app-1', event);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);

        mockNow.mockRestore();
      });

      it('Workflow 鏈中有忙碌 Pod 時判定為資源忙碌', async () => {
        const pod = makePod({ status: 'idle' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        asMock(isWorkflowChainBusy).mockReturnValue(true);

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(executeStreamingChat).not.toHaveBeenCalled();
      });
    });

    describe('Pod 狀態處理', () => {
      it('Pod 狀態為 chatting 時跳過該 Pod', async () => {
        const pod = makePod({ status: 'chatting' });
        // isResourceBusy 回傳 false（模擬只有單一 Pod 綁定同一資源但此處讓 isWorkflowChainBusy 回傳 false）
        // 需讓 isResourceBusy 回傳 false，但 processBoundPod 仍要跳過 chatting pod
        // 做法：findByIntegrationAppAndResource 第一次在 processEvent 回傳該 pod，讓 isResourceBusy 呼叫時回傳 idle pod
        let callCount = 0;
        asMock(podStore.findByIntegrationAppAndResource).mockImplementation(() => {
          callCount++;
          // 第一次呼叫（processEvent 取得 boundPods）和第三次（isResourceBusy 內部）
          // isResourceBusy 是第二次呼叫
          if (callCount === 2) {
            return [{ canvasId, pod: makePod({ status: 'idle' }) }];
          }
          return [{ canvasId, pod }];
        });
        asMock(podStore.getById).mockReturnValue(pod);

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(executeStreamingChat).not.toHaveBeenCalled();
      });

      it('Pod 狀態為 error 時先重置為 idle 再注入訊息', async () => {
        const pod = makePod({ status: 'error' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        // injectMessage 中的二次確認 getById 回傳 idle（error 被重置後）
        asMock(podStore.getById).mockReturnValue({ ...pod, status: 'idle' });

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, pod.id, 'idle');
        expect(executeStreamingChat).toHaveBeenCalled();
      });

      it('executeStreamingChat 拋出錯誤時設定 Pod 狀態為 error', async () => {
        const pod = makePod();
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        asMock(podStore.getById).mockReturnValue(pod);
        asMock(executeStreamingChat).mockRejectedValue(new Error('串流失敗'));

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'error');
      });

      it('Pod 在二次確認時已變為 chatting 應跳過注入', async () => {
        const pod = makePod({ status: 'idle' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        // 二次確認時回傳 chatting 狀態
        asMock(podStore.getById).mockReturnValue({ ...pod, status: 'chatting' });

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(executeStreamingChat).not.toHaveBeenCalled();
        expect(podStore.setStatus).not.toHaveBeenCalledWith(canvasId, podId, 'chatting');
      });
    });

    it('多個綁定 Pod 應並行執行', async () => {
      const pod1 = makePod({ id: 'pod-1' });
      const pod2 = makePod({ id: 'pod-2' });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod: pod1 },
        { canvasId, pod: pod2 },
      ]);
      asMock(podStore.getById).mockImplementation((_canvasId: string, id: string) => {
        if (id === 'pod-1') return pod1;
        if (id === 'pod-2') return pod2;
        return undefined;
      });

      const startedIds: string[] = [];
      const resolvers: Array<() => void> = [];

      asMock(executeStreamingChat).mockImplementation(async (params: { podId: string }) => {
        startedIds.push(params.podId);
        await new Promise<void>(resolve => resolvers.push(resolve));
        return { messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false };
      });

      const handlePromise = integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

      await vi.waitFor(() => {
        expect(startedIds).toHaveLength(2);
      });

      resolvers.forEach(resolve => resolve());
      await handlePromise;

      expect(executeStreamingChat).toHaveBeenCalledTimes(2);
    });

    it('部分 Pod 執行失敗不影響其他 Pod', async () => {
      const pod1 = makePod({ id: 'pod-1' });
      const pod2 = makePod({ id: 'pod-2' });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod: pod1 },
        { canvasId, pod: pod2 },
      ]);
      asMock(podStore.getById).mockImplementation((_canvasId: string, id: string) => {
        if (id === 'pod-1') return pod1;
        if (id === 'pod-2') return pod2;
        return undefined;
      });
      asMock(executeStreamingChat)
        .mockRejectedValueOnce(new Error('Pod 1 執行失敗'))
        .mockResolvedValueOnce({ messageId: 'stream-2', content: '回覆', hasContent: true, aborted: false });

      await expect(
        integrationEventPipeline.processEvent('slack', 'app-1', makeEvent())
      ).resolves.not.toThrow();

      expect(executeStreamingChat).toHaveBeenCalledTimes(2);
    });

    describe('multiInstance Pod', () => {
      it('應建立 Run 並使用 injectRunUserMessage', async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(runExecutionService.createRun).toHaveBeenCalledWith(canvasId, podId, expect.any(String));
        expect(runExecutionService.startPodInstance).toHaveBeenCalledWith(mockRunContext, podId);
        expect(injectRunUserMessage).toHaveBeenCalledWith(mockRunContext, podId, expect.any(String));
        expect(executeStreamingChat).toHaveBeenCalledWith(
          expect.objectContaining({ canvasId, podId, abortable: false, runContext: mockRunContext }),
          expect.any(Object)
        );
      });

      it('應跳過 busy check，即使 Pod 狀態為 chatting 也建立新 Run', async () => {
        const pod = makePod({ multiInstance: true, status: 'chatting' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(runExecutionService.createRun).toHaveBeenCalled();
        expect(executeStreamingChat).toHaveBeenCalled();
      });

      it('processEvent 層級：所有 Pod 皆為 multiInstance 時不發送忙碌回覆', async () => {
        const pod = makePod({ multiInstance: true, status: 'chatting' });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        const mockSendMessage = vi.fn(() => Promise.resolve({ success: true as const }));
        asMock(integrationRegistry.get).mockReturnValue({ sendMessage: mockSendMessage });

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('完成後應呼叫 onRunChatComplete', async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        asMock(executeStreamingChat).mockImplementationOnce(async (_params: unknown, options: { onComplete?: (cId: string, pId: string) => void }) => {
          if (options?.onComplete) {
            options.onComplete(canvasId, podId);
          }
          return { messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false };
        });

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(onRunChatComplete).toHaveBeenCalledWith(mockRunContext, canvasId, podId);
      });

      it('執行失敗時不設定 Pod 全域狀態為 error', async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        asMock(executeStreamingChat).mockRejectedValueOnce(new Error('串流失敗'));

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(podStore.setStatus).not.toHaveBeenCalledWith(canvasId, podId, 'error');
      });

      it('非 multiInstance Pod 維持現有行為（走 injectUserMessage 路徑）', async () => {
        const pod = makePod({ multiInstance: false });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        asMock(podStore.getById).mockReturnValue(pod);

        await integrationEventPipeline.processEvent('slack', 'app-1', makeEvent());

        expect(runExecutionService.createRun).not.toHaveBeenCalled();
        expect(injectRunUserMessage).not.toHaveBeenCalled();
        expect(messageStore.addMessage).toHaveBeenCalled();
      });

      it('event 有 senderId/threadTs 時應設定 replyContextStore', async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);

        const event = makeEvent({ senderId: 'U123', messageTs: '1234.5678', threadTs: '1111.2222' });

        asMock(executeStreamingChat).mockImplementationOnce(async (_params: unknown, options: { onComplete?: (cId: string, pId: string) => void }) => {
          if (options?.onComplete) {
            options.onComplete(canvasId, podId);
          }
          return { messageId: 'stream-1', content: '回覆', hasContent: true, aborted: false };
        });

        await integrationEventPipeline.processEvent('slack', 'app-1', event);

        expect(replyContextStore.set).toHaveBeenCalledWith(
          'run-1:pod-1',
          { senderId: 'U123', messageTs: '1234.5678', threadTs: '1111.2222' }
        );
        expect(replyContextStore.delete).toHaveBeenCalledWith('run-1:pod-1');
      });

      it('非 multiInstance event 有 senderId 時應設定 replyContextStore', async () => {
        const pod = makePod({ multiInstance: false });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([{ canvasId, pod }]);
        asMock(podStore.getById).mockReturnValue(pod);

        const event = makeEvent({ senderId: 'U456', messageTs: '9999.0000' });

        await integrationEventPipeline.processEvent('slack', 'app-1', event);

        expect(replyContextStore.set).toHaveBeenCalledWith(
          'pod:pod-1',
          { senderId: 'U456', messageTs: '9999.0000', threadTs: undefined }
        );
        expect(replyContextStore.delete).toHaveBeenCalledWith('pod:pod-1');
      });
    });
  });

  describe('safeProcessEvent', () => {
    it('應以 fire-and-forget 方式呼叫 processEvent，不拋出錯誤', async () => {
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([]);

      expect(() => {
        integrationEventPipeline.safeProcessEvent('slack', 'app-1', makeEvent());
      }).not.toThrow();

      await vi.waitFor(() => {
        expect(podStore.findByIntegrationAppAndResource).toHaveBeenCalled();
      });
    });
  });
});
