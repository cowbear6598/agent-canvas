vi.mock('../../src/services/podStore.js', () => ({
  podStore: {
    getById: vi.fn(),
    setStatus: vi.fn(),
  },
}));

vi.mock('../../src/services/runStore.js', () => ({
  runStore: {
    getPodInstance: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workflowPipeline } from '../../src/services/workflow/workflowPipeline.js';
import { podStore } from '../../src/services/podStore.js';
import { runStore } from '../../src/services/runStore.js';
import type { PipelineContext, TriggerStrategy, CollectSourcesContext, TriggerDecideContext } from '../../src/services/workflow/types.js';
import type { Connection } from '../../src/types/index.js';
import type { RunContext } from '../../src/types/run.js';
import type { RunPodInstance } from '../../src/services/runStore.js';
import { createMockPod, createMockConnection, createMockStrategy, TEST_IDS } from '../mocks/workflowTestFactories.js';

describe('WorkflowPipeline', () => {
  const { canvasId, sourcePodId, targetPodId, connectionId } = TEST_IDS;

  const mockConnection: Connection = createMockConnection({
    id: connectionId,
    sourcePodId,
    targetPodId,
    triggerMode: 'auto',
  });

  const baseContext: PipelineContext = {
    canvasId,
    sourcePodId,
    connection: mockConnection,
    triggerMode: 'auto',
    decideResult: { connectionId, approved: true, reason: null },
  };

  const mockExecutionService = {
    generateSummaryWithFallback: vi.fn(),
    triggerWorkflowWithSummary: vi.fn(),
  };

  const mockStateService = {
    checkMultiInputScenario: vi.fn(),
  };

  const mockMultiInputService = {
    handleMultiInputForConnection: vi.fn(),
  };

  const mockQueueService = {
    enqueue: vi.fn(),
    processNextInQueue: vi.fn().mockResolvedValue(undefined),
  };

  const mockTargetPod = createMockPod({
    id: targetPodId,
    name: 'Target Pod',
    model: 'claude-sonnet-4-5-20250929' as const,
    status: 'idle' as const,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    workflowPipeline.init({
      executionService: mockExecutionService,
      stateService: mockStateService,
      multiInputService: mockMultiInputService,
      queueService: mockQueueService,
    });

    (mockExecutionService.generateSummaryWithFallback as any).mockResolvedValue({
      content: '摘要',
      isSummarized: true,
    });
    (mockStateService.checkMultiInputScenario as any).mockReturnValue({
      isMultiInput: false,
      requiredSourcePodIds: [],
    });
    (podStore.getById as any).mockReturnValue(mockTargetPod);
  });

  describe('Pipeline 完整流程', () => {
    it('有 collectSources 的 strategy 時，完整執行 pipeline', async () => {
      const mockStrategy = createMockStrategy('auto', {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockExecutionService.generateSummaryWithFallback).toHaveBeenCalledWith(
        canvasId,
        sourcePodId,
        targetPodId,
        undefined,
        'auto'
      );

      expect(mockStrategy.collectSources).toHaveBeenCalledWith({
        canvasId,
        sourcePodId,
        connection: mockConnection,
        summary: '摘要',
      });

      expect(mockExecutionService.triggerWorkflowWithSummary).toHaveBeenCalledWith({
        canvasId,
        connectionId,
        summary: '摘要',
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });
  });

  describe('collectSources 階段', () => {
    it('collectSources 回傳 ready=false 時暫停', async () => {
      const mockStrategy = createMockStrategy('auto', {
        collectSources: vi.fn().mockResolvedValue({
          ready: false,
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();

      expect(mockQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('使用預設 collectSources 邏輯（strategy 沒有 collectSources）', async () => {
      const mockStrategy = createMockStrategy('auto');

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockStateService.checkMultiInputScenario).toHaveBeenCalledWith(
        canvasId,
        targetPodId
      );

      expect(mockExecutionService.triggerWorkflowWithSummary).toHaveBeenCalledWith({
        canvasId,
        connectionId,
        summary: '摘要',
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });

    it('多輸入情境正確委派', async () => {
      const mockStrategy = createMockStrategy('auto');

      (mockStateService.checkMultiInputScenario as any).mockReturnValue({
        isMultiInput: true,
        requiredSourcePodIds: ['pod-a', 'pod-b'],
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockMultiInputService.handleMultiInputForConnection).toHaveBeenCalledWith({
        canvasId,
        sourcePodId,
        connection: mockConnection,
        requiredSourcePodIds: ['pod-a', 'pod-b'],
        summary: '摘要',
        triggerMode: 'auto',
      });

      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();
    });

    it('collectSources 提供 mergedContent 時使用該內容', async () => {
      const mockStrategy = createMockStrategy('auto', {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: '合併內容',
          isSummarized: true,
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockExecutionService.triggerWorkflowWithSummary).toHaveBeenCalledWith({
        canvasId,
        connectionId,
        summary: '合併內容',
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });

      const call = (mockExecutionService.triggerWorkflowWithSummary as any).mock.calls[0][0];
      expect(call.summary).toBe('合併內容');
      expect(call.isSummarized).toBe(true);
    });
  });

  describe('checkQueue 階段', () => {
    it('目標 Pod 忙碌時加入佇列', async () => {
      const mockStrategy = createMockStrategy('auto');

      (podStore.getById as any).mockReturnValue({
        ...mockTargetPod,
        status: 'chatting',
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockQueueService.enqueue).toHaveBeenCalledWith({
        canvasId,
        connectionId,
        sourcePodId,
        targetPodId,
        summary: '摘要',
        isSummarized: true,
        triggerMode: 'auto',
        participatingConnectionIds: undefined,
      });

      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();
    });

    it('目標 Pod 忙碌時 enqueue 後立即呼叫一次 processNextInQueue', async () => {
      const mockStrategy = createMockStrategy('auto');

      (podStore.getById as any).mockReturnValue({
        ...mockTargetPod,
        status: 'chatting',
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockQueueService.enqueue).toHaveBeenCalled();
      expect(mockQueueService.processNextInQueue).toHaveBeenCalledTimes(1);
      expect(mockQueueService.processNextInQueue).toHaveBeenCalledWith(canvasId, targetPodId);
    });
  });

  describe('generateSummary 階段', () => {
    it('generateSummary 失敗時不繼續流程', async () => {
      const mockStrategy = createMockStrategy('auto', {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
        }),
      });

      (mockExecutionService.generateSummaryWithFallback as any).mockResolvedValue(null);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();

      expect(mockStrategy.collectSources).not.toHaveBeenCalled();
    });
  });

  describe('collectSources 與 mergedContent 的完整流程', () => {
    it('collectSources 回傳 mergedContent 且 isSummarized 未設定時預設為 true', async () => {
      const mockStrategy = createMockStrategy('auto', {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: '合併內容但未指定 isSummarized',
        }),
      });

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockExecutionService.triggerWorkflowWithSummary).toHaveBeenCalledWith({
        canvasId,
        connectionId,
        summary: '合併內容但未指定 isSummarized',
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });
  });

  describe('trigger 階段傳遞 strategy', () => {
    it('ai-decide mode 時傳遞 strategy 給 triggerWorkflowWithSummary', async () => {
      const aiDecideContext: PipelineContext = {
        ...baseContext,
        triggerMode: 'ai-decide',
        connection: createMockConnection({
          ...mockConnection,
          triggerMode: 'ai-decide',
        }),
      };

      const mockStrategy = createMockStrategy('ai-decide', {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: '合併內容',
          isSummarized: true,
        }),
      });

      await workflowPipeline.execute(aiDecideContext, mockStrategy);

      expect(mockExecutionService.triggerWorkflowWithSummary).toHaveBeenCalledWith({
        canvasId,
        connectionId,
        summary: '合併內容',
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });

    it('direct mode 時傳遞 strategy 給 triggerWorkflowWithSummary', async () => {
      const directContext: PipelineContext = {
        ...baseContext,
        triggerMode: 'direct',
        connection: createMockConnection({
          ...mockConnection,
          triggerMode: 'direct',
        }),
      };

      const mockStrategy = createMockStrategy('direct', {
        collectSources: vi.fn().mockResolvedValue({
          ready: true,
          mergedContent: '合併內容',
          isSummarized: true,
        }),
      });

      await workflowPipeline.execute(directContext, mockStrategy);

      expect(mockExecutionService.triggerWorkflowWithSummary).toHaveBeenCalledWith({
        canvasId,
        connectionId,
        summary: '合併內容',
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockStrategy,
      });
    });
  });

  describe('目標 Pod 不存在時的處理', () => {
    it('找不到目標 Pod 時不觸發 workflow', async () => {
      const mockStrategy = createMockStrategy('auto');

      (podStore.getById as any).mockReturnValue(null);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();

      expect(mockQueueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('Run 模式 skipped guard', () => {
    const runContext: RunContext = { runId: 'run-1', canvasId, sourcePodId };
    const runContextPipelineBase: PipelineContext = { ...baseContext, runContext };

    function makeRunInstance(status: RunPodInstance['status']): RunPodInstance {
      return {
        id: 'inst-1',
        runId: 'run-1',
        podId: targetPodId,
        status,
        claudeSessionId: null,
        errorMessage: null,
        triggeredAt: null,
        completedAt: null,
        autoPathwaySettled: null,
        directPathwaySettled: null,
      };
    }

    it('target instance 為 completed 時應 early return，不繼續觸發', async () => {
      const mockStrategy = createMockStrategy('auto');
      (runStore.getPodInstance as any).mockReturnValue(makeRunInstance('completed'));

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(mockExecutionService.generateSummaryWithFallback).not.toHaveBeenCalled();
      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();
    });

    it('target instance 為 skipped 時應 early return，不繼續觸發', async () => {
      const mockStrategy = createMockStrategy('auto');
      (runStore.getPodInstance as any).mockReturnValue(makeRunInstance('skipped'));

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(mockExecutionService.generateSummaryWithFallback).not.toHaveBeenCalled();
      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();
    });

    it('target instance 為 error 時應 early return，不繼續觸發', async () => {
      const mockStrategy = createMockStrategy('auto');
      (runStore.getPodInstance as any).mockReturnValue(makeRunInstance('error'));

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(mockExecutionService.generateSummaryWithFallback).not.toHaveBeenCalled();
      expect(mockExecutionService.triggerWorkflowWithSummary).not.toHaveBeenCalled();
    });

    it('target instance 為 pending 時應繼續執行', async () => {
      const mockStrategy = createMockStrategy('auto');
      (runStore.getPodInstance as any).mockReturnValue(makeRunInstance('pending'));

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(mockExecutionService.generateSummaryWithFallback).toHaveBeenCalled();
    });

    it('target instance 為 deciding 時應繼續執行', async () => {
      const mockStrategy = createMockStrategy('auto');
      (runStore.getPodInstance as any).mockReturnValue(makeRunInstance('deciding'));

      await workflowPipeline.execute(runContextPipelineBase, mockStrategy);

      expect(mockExecutionService.generateSummaryWithFallback).toHaveBeenCalled();
    });

    it('非 run 模式（無 runContext）時不觸發 guard，照常執行', async () => {
      const mockStrategy = createMockStrategy('auto');
      (runStore.getPodInstance as any).mockReturnValue(undefined);

      await workflowPipeline.execute(baseContext, mockStrategy);

      expect(mockExecutionService.generateSummaryWithFallback).toHaveBeenCalled();
    });
  });
});
