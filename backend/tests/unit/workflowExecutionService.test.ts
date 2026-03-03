import {
  createConnectionStoreMock,
  createPodStoreMock,
  createMessageStoreMock,
  createSummaryServiceMock,
  createPendingTargetStoreMock,
  createWorkflowStateServiceMock,
  createWorkflowEventEmitterMock,
  createAiDecideServiceMock,
  createAutoClearServiceMock,
  createLoggerMock,
  createSocketServiceMock,
  createClaudeQueryServiceMock,
  createCommandServiceMock,
  createWorkflowMultiInputServiceMock,
  createDirectTriggerStoreMock,
} from '../mocks/workflowModuleMocks.js';

vi.mock('../../src/services/connectionStore.js', () => createConnectionStoreMock());
vi.mock('../../src/services/podStore.js', () => createPodStoreMock());
vi.mock('../../src/services/messageStore.js', () => createMessageStoreMock());
vi.mock('../../src/services/summaryService.js', () => createSummaryServiceMock());
vi.mock('../../src/services/pendingTargetStore.js', () => createPendingTargetStoreMock());
vi.mock('../../src/services/workflow/workflowStateService.js', () => createWorkflowStateServiceMock());
vi.mock('../../src/services/workflow/workflowEventEmitter.js', () => createWorkflowEventEmitterMock());
vi.mock('../../src/services/workflow/aiDecideService.js', () => createAiDecideServiceMock());
vi.mock('../../src/services/autoClear/index.js', () => createAutoClearServiceMock());
vi.mock('../../src/utils/logger.js', () => createLoggerMock());
vi.mock('../../src/services/socketService.js', () => createSocketServiceMock());
vi.mock('../../src/services/claude/queryService.js', () => createClaudeQueryServiceMock());
vi.mock('../../src/services/commandService.js', () => createCommandServiceMock());
vi.mock('../../src/services/workflow/workflowMultiInputService.js', () => createWorkflowMultiInputServiceMock());
vi.mock('../../src/services/directTriggerStore.js', () => createDirectTriggerStoreMock());

import { workflowExecutionService } from '../../src/services/workflow';
import { connectionStore } from '../../src/services/connectionStore.js';
import { podStore } from '../../src/services/podStore.js';
import { messageStore } from '../../src/services/messageStore.js';
import { summaryService } from '../../src/services/summaryService.js';
import { workflowStateService } from '../../src/services/workflow';
import { workflowEventEmitter } from '../../src/services/workflow';
import { aiDecideService } from '../../src/services/workflow';
import { pendingTargetStore } from '../../src/services/pendingTargetStore.js';
import { workflowQueueService } from '../../src/services/workflow';
import { workflowMultiInputService } from '../../src/services/workflow';
import type { Connection, TriggerMode } from '../../src/types';
import type { TriggerStrategy } from '../../src/services/workflow/types.js';
import { createMockPod, createMockConnection, createMockMessages, createMockStrategy, TEST_IDS } from '../mocks/workflowTestFactories.js';

// 提取為獨立函數，因為 vi.clearAllMocks 後需要重新設定，避免 beforeEach 膨脹
function createPipelineExecuteImpl(mockAutoStrategy: TriggerStrategy, mockAiDecideStrategy: TriggerStrategy) {
  return async (context: any, strategy: TriggerStrategy) => {
    const summaryResult = await summaryService.generateSummaryForTarget(
      context.canvasId,
      context.sourcePodId,
      context.connection.targetPodId
    );

    const { isMultiInput, requiredSourcePodIds } = workflowStateService.checkMultiInputScenario(
      context.canvasId,
      context.connection.targetPodId
    );

    if (isMultiInput) {
      await workflowMultiInputService.handleMultiInputForConnection(
        context.canvasId,
        context.sourcePodId,
        context.connection,
        requiredSourcePodIds,
        summaryResult.summary || 'test summary',
        context.triggerMode
      );
      return;
    }

    const targetPod = podStore.getById(context.canvasId, context.connection.targetPodId);
    if (targetPod && targetPod.status !== 'idle') {
      workflowQueueService.enqueue({
        canvasId: context.canvasId,
        connectionId: context.connection.id,
        sourcePodId: context.sourcePodId,
        targetPodId: context.connection.targetPodId,
        summary: summaryResult.summary || 'test summary',
        isSummarized: summaryResult.success || false,
        triggerMode: context.triggerMode,
      });
      return;
    }

    await workflowExecutionService.triggerWorkflowWithSummary(
      context.canvasId,
      context.connection.id,
      summaryResult.summary || 'test summary',
      summaryResult.success || false,
      undefined,
      strategy
    );
  };
}

function createAutoTriggerProcessImpl(mockPipeline: any, mockAutoStrategy: TriggerStrategy) {
  return async (canvasId: string, sourcePodId: string, connection: Connection) => {
    const pipelineContext = {
      canvasId,
      sourcePodId,
      connection,
      triggerMode: 'auto' as const,
      decideResult: { connectionId: connection.id, approved: true, reason: null },
    };
    await mockPipeline.execute(pipelineContext, mockAutoStrategy);
  };
}

function createAiDecideProcessImpl(mockPipeline: any, mockAiDecideStrategy: TriggerStrategy) {
  return async (canvasId: string, sourcePodId: string, connections: Connection[]) => {
    workflowEventEmitter.emitAiDecidePending(
      canvasId,
      connections.map(c => c.id),
      sourcePodId
    );

    connections.forEach(conn => {
      connectionStore.updateDecideStatus(canvasId, conn.id, 'pending', null);
    });

    const decision = await aiDecideService.decideConnections(canvasId, sourcePodId, connections);

    for (const result of decision.results) {
      const connection = connections.find(c => c.id === result.connectionId);
      if (!connection) continue;

      connectionStore.updateDecideStatus(
        canvasId,
        result.connectionId,
        result.shouldTrigger ? 'approved' : 'rejected',
        result.reason
      );

      workflowEventEmitter.emitAiDecideResult({
        canvasId,
        connectionId: result.connectionId,
        sourcePodId,
        targetPodId: connection.targetPodId,
        shouldTrigger: result.shouldTrigger,
        reason: result.reason,
      });

      if (result.shouldTrigger) {
        const { isMultiInput } = workflowStateService.checkMultiInputScenario(canvasId, connection.targetPodId);

        if (isMultiInput && pendingTargetStore.hasPendingTarget(connection.targetPodId)) {
          // 記錄 completion（這會在 multiInputService 中處理）
        } else {
          const pipelineContext = {
            canvasId,
            sourcePodId,
            connection,
            triggerMode: 'ai-decide' as const,
            decideResult: { connectionId: connection.id, approved: true, reason: result.reason },
          };
          await mockPipeline.execute(pipelineContext, mockAiDecideStrategy);
        }
      } else {
        const { isMultiInput } = workflowStateService.checkMultiInputScenario(canvasId, connection.targetPodId);
        if (isMultiInput && pendingTargetStore.hasPendingTarget(connection.targetPodId)) {
          pendingTargetStore.recordSourceRejection(connection.targetPodId, sourcePodId, result.reason);
        }
      }
    }

    for (const errorResult of decision.errors) {
      const connection = connections.find(c => c.id === errorResult.connectionId);
      if (!connection) continue;

      connectionStore.updateDecideStatus(
        canvasId,
        errorResult.connectionId,
        'error',
        `錯誤：${errorResult.error}`
      );

      workflowEventEmitter.emitAiDecideError({
        canvasId,
        connectionId: errorResult.connectionId,
        sourcePodId,
        targetPodId: connection.targetPodId,
        error: `錯誤：${errorResult.error}`,
      });
    }
  };
}

describe('WorkflowExecutionService', () => {
  const { canvasId, sourcePodId, targetPodId } = TEST_IDS;

  const mockAutoStrategy = createMockStrategy('auto');
  const mockDirectStrategy = createMockStrategy('direct');
  const mockAiDecideStrategy = createMockStrategy('ai-decide');

  const mockPipeline = {
    execute: vi.fn(),
    init: vi.fn(),
  };

  const mockAutoTriggerService = {
    processAutoTriggerConnection: vi.fn(),
    init: vi.fn(),
  };

  const mockAiDecideTriggerService = {
    processAiDecideConnections: vi.fn(),
    init: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // vi.clearAllMocks 會清除 implementation，需重新設定
    (mockPipeline.execute as any).mockImplementation(createPipelineExecuteImpl(mockAutoStrategy, mockAiDecideStrategy));
    (mockAutoTriggerService.processAutoTriggerConnection as any).mockImplementation(createAutoTriggerProcessImpl(mockPipeline, mockAutoStrategy));
    (mockAiDecideTriggerService.processAiDecideConnections as any).mockImplementation(createAiDecideProcessImpl(mockPipeline, mockAiDecideStrategy));

    workflowExecutionService.init({
      pipeline: mockPipeline as any,
      aiDecideTriggerService: mockAiDecideTriggerService as any,
      autoTriggerService: mockAutoTriggerService as any,
      directTriggerService: mockDirectStrategy,
    });

    const mockSourcePod = createMockPod({ id: sourcePodId, name: 'Source Pod', status: 'idle' });
    const mockTargetPod = createMockPod({ id: targetPodId, name: 'Target Pod', status: 'idle' });
    const mockMessages = createMockMessages();

    (podStore.getById as any).mockImplementation((cId: string, podId: string) => {
      if (podId === sourcePodId) return mockSourcePod;
      if (podId.startsWith('target-pod') || podId.startsWith('target-multi')) return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
      return null;
    });
    (messageStore.getMessages as any).mockReturnValue(mockMessages);
    (summaryService.generateSummaryForTarget as any).mockResolvedValue({ success: true, summary: 'Test summary' });
    (workflowStateService.checkMultiInputScenario as any).mockReturnValue({ isMultiInput: false, requiredSourcePodIds: [] });
    (pendingTargetStore.hasPendingTarget as any).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkAndTriggerWorkflows 同時處理 auto 和 ai-decide connections', () => {
    it('正確分組並平行處理兩種 connections', async () => {
      const mockAutoConnection = createMockConnection({ id: 'conn-auto-1', sourcePodId, targetPodId, triggerMode: 'auto' });
      const mockAiDecideConnection = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId: 'target-pod-2', triggerMode: 'ai-decide' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([
        mockAutoConnection,
        mockAiDecideConnection,
      ]);
      (connectionStore.getById as any).mockImplementation((cId: string, connId: string) => {
        if (connId === 'conn-auto-1') return mockAutoConnection;
        if (connId === 'conn-ai-1') return mockAiDecideConnection;
        return null;
      });

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [
          { connectionId: 'conn-ai-1', shouldTrigger: true, reason: '相關任務' },
        ],
        errors: [],
      });

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      expect(workflowEventEmitter.emitAiDecidePending).toHaveBeenCalledWith(
        canvasId,
        ['conn-ai-1'],
        sourcePodId
      );
      expect(aiDecideService.decideConnections).toHaveBeenCalledWith(
        canvasId,
        sourcePodId,
        [mockAiDecideConnection]
      );

      expect(summaryService.generateSummaryForTarget).toHaveBeenCalled();
    });
  });

  describe('auto connections 走現有流程不受影響', () => {
    it('只有 auto connection 時，正常觸發 workflow', async () => {
      const mockAutoConnection = createMockConnection({ id: 'conn-auto-1', sourcePodId, targetPodId, triggerMode: 'auto' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([mockAutoConnection]);
      (connectionStore.getById as any).mockReturnValue(mockAutoConnection);

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      expect(summaryService.generateSummaryForTarget).toHaveBeenCalledWith(
        canvasId,
        sourcePodId,
        targetPodId
      );
      expect(aiDecideService.decideConnections).not.toHaveBeenCalled();
    });
  });

  describe('ai-decide connections 呼叫 aiDecideService 進行判斷', () => {
    it('正確呼叫 aiDecideService 並處理批次判斷', async () => {
      const mockAiDecideConnection = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId: 'target-pod-2', triggerMode: 'ai-decide' });
      const aiConn2 = createMockConnection({ id: 'conn-ai-2', sourcePodId, targetPodId: 'target-pod-3', triggerMode: 'ai-decide' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([
        mockAiDecideConnection,
        aiConn2,
      ]);

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [
          { connectionId: 'conn-ai-1', shouldTrigger: true, reason: '相關任務 1' },
          { connectionId: 'conn-ai-2', shouldTrigger: false, reason: '不相關任務 2' },
        ],
        errors: [],
      });

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      expect(workflowEventEmitter.emitAiDecidePending).toHaveBeenCalledWith(
        canvasId,
        ['conn-ai-1', 'conn-ai-2'],
        sourcePodId
      );
      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(canvasId, 'conn-ai-1', 'pending', null);
      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(canvasId, 'conn-ai-2', 'pending', null);
      expect(aiDecideService.decideConnections).toHaveBeenCalledTimes(1);
    });
  });

  describe('ai-decide 判斷為觸發時，正確觸發 summary 生成和 target pod chat', () => {
    it('shouldTrigger: true 時，更新狀態為 approved 並觸發 workflow', async () => {
      const mockAiDecideConnection = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId: 'target-pod-2', triggerMode: 'ai-decide' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([mockAiDecideConnection]);
      (connectionStore.getById as any).mockReturnValue(mockAiDecideConnection);

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [
          { connectionId: 'conn-ai-1', shouldTrigger: true, reason: '上游結果與下游需求相關' },
        ],
        errors: [],
      });

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        canvasId,
        'conn-ai-1',
        'approved',
        '上游結果與下游需求相關'
      );
      expect(workflowEventEmitter.emitAiDecideResult).toHaveBeenCalledWith({
        canvasId,
        connectionId: 'conn-ai-1',
        sourcePodId,
        targetPodId: 'target-pod-2',
        shouldTrigger: true,
        reason: '上游結果與下游需求相關',
      });
      expect(summaryService.generateSummaryForTarget).toHaveBeenCalled();
    });
  });

  describe('ai-decide 判斷為不觸發時，不觸發 target pod，發送 rejected 事件', () => {
    it('shouldTrigger: false 時，更新狀態為 rejected 且不觸發', async () => {
      const mockAiDecideConnection = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId: 'target-pod-2', triggerMode: 'ai-decide' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([mockAiDecideConnection]);

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [
          { connectionId: 'conn-ai-1', shouldTrigger: false, reason: '上游產出與下游任務無關' },
        ],
        errors: [],
      });

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        canvasId,
        'conn-ai-1',
        'rejected',
        '上游產出與下游任務無關'
      );
      expect(workflowEventEmitter.emitAiDecideResult).toHaveBeenCalledWith({
        canvasId,
        connectionId: 'conn-ai-1',
        sourcePodId,
        targetPodId: 'target-pod-2',
        shouldTrigger: false,
        reason: '上游產出與下游任務無關',
      });
      expect(summaryService.generateSummaryForTarget).not.toHaveBeenCalled();
    });
  });

  describe('triggerWorkflowWithSummary forEachMultiInputGroupConnection 群組 active 設定', () => {
    it('auto 模式：應設定同群所有 auto/ai-decide 連線為 active', async () => {
      const autoConn1 = createMockConnection({ id: 'conn-auto-1', sourcePodId, targetPodId, triggerMode: 'auto' });
      const autoConn2 = createMockConnection({ id: 'conn-auto-2', sourcePodId: 'other-source', targetPodId, triggerMode: 'auto' });

      (connectionStore.getById as any).mockReturnValue(autoConn1);
      (connectionStore.findByTargetPodId as any).mockReturnValue([autoConn1, autoConn2]);

      await workflowExecutionService.triggerWorkflowWithSummary(
        canvasId,
        autoConn1.id,
        'Test summary',
        true,
        undefined,
        mockAutoStrategy
      );

      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(canvasId, 'conn-auto-1', 'active');
      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(canvasId, 'conn-auto-2', 'active');
      const activeCalls = (connectionStore.updateConnectionStatus as any).mock.calls.filter(
        (call: any[]) => call[2] === 'active'
      );
      expect(activeCalls).toHaveLength(2);
    });

    it('ai-decide 模式：應設定同群所有 auto/ai-decide 連線為 active', async () => {
      const aiConn1 = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId, triggerMode: 'ai-decide' });
      const aiConn2 = createMockConnection({ id: 'conn-ai-2', sourcePodId: 'other-source', targetPodId, triggerMode: 'ai-decide' });

      (connectionStore.getById as any).mockReturnValue(aiConn1);
      (connectionStore.findByTargetPodId as any).mockReturnValue([aiConn1, aiConn2]);

      await workflowExecutionService.triggerWorkflowWithSummary(
        canvasId,
        aiConn1.id,
        'Test summary',
        true,
        undefined,
        mockAiDecideStrategy
      );

      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(canvasId, 'conn-ai-1', 'active');
      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(canvasId, 'conn-ai-2', 'active');
      const activeCalls = (connectionStore.updateConnectionStatus as any).mock.calls.filter(
        (call: any[]) => call[2] === 'active'
      );
      expect(activeCalls).toHaveLength(2);
    });

    it('direct 模式：只設定當前連線為 active', async () => {
      const directConn = createMockConnection({ id: 'conn-direct-1', sourcePodId, targetPodId, triggerMode: 'direct' });

      (connectionStore.getById as any).mockReturnValue(directConn);
      (connectionStore.findByTargetPodId as any).mockReturnValue([directConn]);

      await workflowExecutionService.triggerWorkflowWithSummary(
        canvasId,
        directConn.id,
        'Test summary',
        true,
        [directConn.id],
        mockDirectStrategy
      );

      const activeCalls = (connectionStore.updateConnectionStatus as any).mock.calls.filter(
        (call: any[]) => call[2] === 'active'
      );
      expect(activeCalls).toHaveLength(1);
      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(canvasId, 'conn-direct-1', 'active');
    });
  });

  describe('triggerWorkflowWithSummary 在觸發前將 connection 設為 active', () => {
    it('呼叫 triggerWorkflowWithSummary 時，strategy.onTrigger 前應呼叫 updateConnectionStatus active', async () => {
      const mockAutoConnection = createMockConnection({ id: 'conn-auto-1', sourcePodId, targetPodId, triggerMode: 'auto' });

      (connectionStore.getById as any).mockReturnValue(mockAutoConnection);
      (connectionStore.findBySourcePodId as any).mockReturnValue([]);
      (connectionStore.findByTargetPodId as any).mockReturnValue([mockAutoConnection]);

      const callOrder: string[] = [];

      (connectionStore.updateConnectionStatus as any).mockImplementation((_cId: string, _connId: string, status: string) => {
        callOrder.push(`updateConnectionStatus:${status}`);
      });

      (mockAutoStrategy.onTrigger as any).mockImplementation(() => {
        callOrder.push('onTrigger');
      });

      await workflowExecutionService.triggerWorkflowWithSummary(
        canvasId,
        mockAutoConnection.id,
        'Test summary',
        true,
        undefined,
        mockAutoStrategy
      );

      const activeIndex = callOrder.indexOf('updateConnectionStatus:active');
      const onTriggerIndex = callOrder.indexOf('onTrigger');

      expect(activeIndex).toBeGreaterThanOrEqual(0);
      expect(onTriggerIndex).toBeGreaterThanOrEqual(0);
      // active 狀態必須在 onTrigger 之前設定
      expect(activeIndex).toBeLessThan(onTriggerIndex);
    });
  });

  describe('混合情境中 auto 和 ai-decide 平行處理、互不等待', () => {
    it('auto 和 ai-decide 同時執行，互不阻塞', async () => {
      const mockAutoConnection = createMockConnection({ id: 'conn-auto-1', sourcePodId, targetPodId, triggerMode: 'auto' });
      const autoConn2 = createMockConnection({ id: 'conn-auto-2', sourcePodId, targetPodId: 'target-pod-3', triggerMode: 'auto' });
      const mockAiDecideConnection = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId: 'target-pod-2', triggerMode: 'ai-decide' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([
        mockAutoConnection,
        autoConn2,
        mockAiDecideConnection,
      ]);
      (connectionStore.getById as any).mockImplementation((cId: string, connId: string) => {
        if (connId === 'conn-auto-1') return mockAutoConnection;
        if (connId === 'conn-auto-2') return autoConn2;
        if (connId === 'conn-ai-1') return mockAiDecideConnection;
        return null;
      });

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [
          { connectionId: 'conn-ai-1', shouldTrigger: true, reason: '相關' },
        ],
        errors: [],
      });

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(summaryService.generateSummaryForTarget).toHaveBeenCalledTimes(3);

      expect(aiDecideService.decideConnections).toHaveBeenCalledTimes(1);
      expect(workflowEventEmitter.emitAiDecideResult).toHaveBeenCalled();
    });
  });

  describe('多輸入場景中 ai-decide rejected 導致 target 永不觸發', () => {
    it('多輸入場景中，rejected source 導致 target 永不觸發', async () => {
      const targetPodWithMultiInput = 'target-multi-input';
      const aiConn = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId: targetPodWithMultiInput, triggerMode: 'ai-decide' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([aiConn]);

      (workflowStateService.checkMultiInputScenario as any).mockReturnValue({
        isMultiInput: true,
        requiredSourcePodIds: [sourcePodId, 'another-source'],
      });

      (pendingTargetStore.hasPendingTarget as any).mockReturnValue(true);

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [
          { connectionId: 'conn-ai-1', shouldTrigger: false, reason: '不相關' },
        ],
        errors: [],
      });

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      expect(pendingTargetStore.recordSourceRejection).toHaveBeenCalledWith(
        targetPodWithMultiInput,
        sourcePodId,
        '不相關'
      );

      expect(summaryService.generateSummaryForTarget).not.toHaveBeenCalled();
    });
  });

  describe('AI Decide 錯誤處理', () => {
    it('aiDecideService 回傳 errors 時，正確更新狀態並發送 error 事件', async () => {
      const mockAiDecideConnection = createMockConnection({ id: 'conn-ai-1', sourcePodId, targetPodId: 'target-pod-2', triggerMode: 'ai-decide' });

      (connectionStore.findBySourcePodId as any).mockReturnValue([mockAiDecideConnection]);

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [],
        errors: [
          { connectionId: 'conn-ai-1', error: 'AI decision failed' },
        ],
      });

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, sourcePodId);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(
        canvasId,
        'conn-ai-1',
        'error',
        '錯誤：AI decision failed'
      );
      expect(workflowEventEmitter.emitAiDecideError).toHaveBeenCalledWith({
        canvasId,
        connectionId: 'conn-ai-1',
        sourcePodId,
        targetPodId: 'target-pod-2',
        error: '錯誤：AI decision failed',
      });
    });
  });

  describe('多輸入 auto 場景在 target Pod busy 時進入 queue', () => {
    it('所有來源都回應完畢且 target Pod 為 chatting 時，應 enqueue 而非直接觸發', async () => {
      const source1PodId = 'source-pod-1';
      const source2PodId = 'source-pod-2';
      const multiInputTargetPodId = 'target-multi-input';

      const conn1: Connection = {
        id: 'conn-auto-1',
        sourcePodId: source1PodId,
        sourceAnchor: 'right',
        targetPodId: multiInputTargetPodId,
        targetAnchor: 'left',
        triggerMode: 'auto',
        decideStatus: 'none',
        decideReason: null,
        connectionStatus: 'idle',
      };

      (connectionStore.findBySourcePodId as any).mockReturnValue([conn1]);
      (connectionStore.getById as any).mockReturnValue(conn1);

      (podStore.getById as any).mockImplementation((cId: string, podId: string) => {
        if (podId === multiInputTargetPodId) {
          return createMockPod({ id: podId, status: 'chatting' });
        }
        return createMockPod({ id: podId, status: 'idle' });
      });

      (workflowStateService.checkMultiInputScenario as any).mockReturnValue({
        isMultiInput: true,
        requiredSourcePodIds: [source1PodId, source2PodId],
      });

      (pendingTargetStore.hasPendingTarget as any).mockReturnValue(false);

      (pendingTargetStore.recordSourceCompletion as any).mockReturnValue({
        allSourcesResponded: true,
        hasRejection: false,
      });

      (pendingTargetStore.getCompletedSummaries as any).mockReturnValue(
        new Map([
          [source1PodId, 'Summary from source 1'],
          [source2PodId, 'Summary from source 2'],
        ])
      );

      (workflowMultiInputService.handleMultiInputForConnection as any).mockImplementation(
        async (canvasId: string, sourcePodId: string, connection: Connection, requiredSourcePodIds: string[], summary: string, triggerMode: 'auto' | 'ai-decide') => {
          const targetPod = podStore.getById(canvasId, connection.targetPodId);
          if (targetPod && targetPod.status === 'chatting') {
            workflowQueueService.enqueue({
              canvasId,
              connectionId: connection.id,
              sourcePodId,
              targetPodId: connection.targetPodId,
              summary: 'merged summary',
              isSummarized: true,
              triggerMode,
            });
            pendingTargetStore.clearPendingTarget(connection.targetPodId);
          }
        }
      );

      const enqueueSpy = vi.spyOn(workflowQueueService, 'enqueue');

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, source1PodId);

      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId,
          connectionId: conn1.id,
          targetPodId: multiInputTargetPodId,
          isSummarized: true,
          triggerMode: 'auto',
        })
      );

      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(multiInputTargetPodId);
    });
  });

  describe('多輸入 AI Decide 場景在 target Pod busy 時進入 queue', () => {
    it('所有來源都回應完畢且 target Pod 為 chatting 時，應 enqueue 而非直接觸發', async () => {
      const source1PodId = 'source-pod-1';
      const source2PodId = 'source-pod-2';
      const multiInputTargetPodId = 'target-multi-input';

      const aiConn: Connection = {
        id: 'conn-ai-1',
        sourcePodId: source1PodId,
        sourceAnchor: 'right',
        targetPodId: multiInputTargetPodId,
        targetAnchor: 'left',
        triggerMode: 'ai-decide',
        decideStatus: 'none',
        decideReason: null,
        connectionStatus: 'idle',
      };

      (connectionStore.findBySourcePodId as any).mockReturnValue([aiConn]);
      (connectionStore.getById as any).mockReturnValue(aiConn);

      (podStore.getById as any).mockImplementation((cId: string, podId: string) => {
        if (podId === multiInputTargetPodId) {
          return createMockPod({ id: podId, status: 'chatting' });
        }
        return createMockPod({ id: podId, status: 'idle' });
      });

      (workflowStateService.checkMultiInputScenario as any).mockReturnValue({
        isMultiInput: true,
        requiredSourcePodIds: [source1PodId, source2PodId],
      });

      (pendingTargetStore.hasPendingTarget as any).mockReturnValue(false);

      (aiDecideService.decideConnections as any).mockResolvedValue({
        results: [
          { connectionId: aiConn.id, shouldTrigger: true, reason: '相關任務' },
        ],
        errors: [],
      });

      (pendingTargetStore.recordSourceCompletion as any).mockReturnValue({
        allSourcesResponded: true,
        hasRejection: false,
      });

      (pendingTargetStore.getCompletedSummaries as any).mockReturnValue(
        new Map([
          [source1PodId, 'Summary from source 1'],
          [source2PodId, 'Summary from source 2'],
        ])
      );

      (workflowMultiInputService.handleMultiInputForConnection as any).mockImplementation(
        async (canvasId: string, sourcePodId: string, connection: Connection, requiredSourcePodIds: string[], summary: string, triggerMode: 'auto' | 'ai-decide') => {
          const targetPod = podStore.getById(canvasId, connection.targetPodId);
          if (targetPod && targetPod.status === 'chatting') {
            workflowQueueService.enqueue({
              canvasId,
              connectionId: connection.id,
              sourcePodId,
              targetPodId: connection.targetPodId,
              summary: 'merged summary',
              isSummarized: true,
              triggerMode,
            });
            pendingTargetStore.clearPendingTarget(connection.targetPodId);
          }
        }
      );

      const enqueueSpy = vi.spyOn(workflowQueueService, 'enqueue');

      await workflowExecutionService.checkAndTriggerWorkflows(canvasId, source1PodId);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId,
          connectionId: aiConn.id,
          targetPodId: multiInputTargetPodId,
          isSummarized: true,
          triggerMode: 'ai-decide',
        })
      );

      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(multiInputTargetPodId);
    });
  });
});
