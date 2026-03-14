import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runExecutionService } from '../../src/services/workflow/runExecutionService.js';
import { runStore } from '../../src/services/runStore.js';
import { connectionStore } from '../../src/services/connectionStore.js';
import { podStore } from '../../src/services/podStore.js';
import { socketService } from '../../src/services/socketService.js';
import { claudeService } from '../../src/services/claude/claudeService.js';
import { logger } from '../../src/utils/logger.js';
import { WebSocketResponseEvents } from '../../src/schemas/events.js';
import type { WorkflowRun, RunPodInstance } from '../../src/services/runStore.js';
import type { RunContext } from '../../src/types/run.js';

function createMockRun(overrides?: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: 'run-1',
    canvasId: 'canvas-1',
    sourcePodId: 'pod-source',
    triggerMessage: '測試訊息',
    status: 'running',
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function createMockInstance(overrides?: Partial<RunPodInstance>): RunPodInstance {
  return {
    id: 'instance-1',
    runId: 'run-1',
    podId: 'pod-source',
    status: 'pending',
    claudeSessionId: null,
    errorMessage: null,
    triggeredAt: null,
    completedAt: null,
    autoPathwaySettled: null,
    directPathwaySettled: null,
    ...overrides,
  };
}

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: 'run-1',
    canvasId: 'canvas-1',
    sourcePodId: 'pod-source',
    ...overrides,
  };
}

describe('RunExecutionService', () => {
  const canvasId = 'canvas-1';
  const sourcePodId = 'pod-source';
  const targetPodId = 'pod-target';

  beforeEach(() => {
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(socketService, 'emitToCanvas').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createRun', () => {
    it('建立 Run 並為 chain 中所有 pod 建立 instance', async () => {
      const mockRun = createMockRun();
      const sourceInstance = createMockInstance({ podId: sourcePodId });
      const targetInstance = createMockInstance({ id: 'instance-2', podId: targetPodId });

      vi.spyOn(runStore, 'createRun').mockReturnValue(mockRun);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, podId) => {
        if (podId === sourcePodId) {
          return [{ id: 'conn-1', sourcePodId, targetPodId, sourceAnchor: 'right', targetAnchor: 'left', triggerMode: 'auto', decideStatus: 'none', decideReason: null, connectionStatus: 'idle' }];
        }
        return [];
      });
      vi.spyOn(runStore, 'createPodInstance').mockImplementation((_, podId) => {
        if (podId === sourcePodId) return sourceInstance;
        return targetInstance;
      });
      vi.spyOn(podStore, 'getById').mockImplementation((cId, podId) => {
        if (podId === sourcePodId) return { id: sourcePodId, name: 'Source Pod' } as any;
        if (podId === targetPodId) return { id: targetPodId, name: 'Target Pod' } as any;
        return undefined;
      });
      vi.spyOn(runStore, 'countRunsByCanvasId').mockReturnValue(1);

      const context = await runExecutionService.createRun(canvasId, sourcePodId, '測試');

      expect(context.runId).toBe(mockRun.id);
      expect(context.canvasId).toBe(canvasId);
      expect(context.sourcePodId).toBe(sourcePodId);
      expect(runStore.createPodInstance).toHaveBeenCalledTimes(2);
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CREATED,
        expect.objectContaining({ canvasId, run: expect.objectContaining({ id: mockRun.id, sourcePodName: 'Source Pod' }) }),
      );
    });

    it('emit payload 的 podInstances 中每個 instance 都有正確的 podName', async () => {
      const mockRun = createMockRun();
      const sourceInstance = createMockInstance({ podId: sourcePodId });
      const targetInstance = createMockInstance({ id: 'instance-2', podId: targetPodId });

      vi.spyOn(runStore, 'createRun').mockReturnValue(mockRun);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, podId) => {
        if (podId === sourcePodId) {
          return [{ id: 'conn-1', sourcePodId, targetPodId, sourceAnchor: 'right', targetAnchor: 'left', triggerMode: 'auto', decideStatus: 'none', decideReason: null, connectionStatus: 'idle' }];
        }
        return [];
      });
      vi.spyOn(runStore, 'createPodInstance').mockImplementation((_, podId) => {
        if (podId === sourcePodId) return sourceInstance;
        return targetInstance;
      });
      vi.spyOn(podStore, 'getById').mockImplementation((cId, podId) => {
        if (podId === sourcePodId) return { id: sourcePodId, name: 'Source Pod' } as any;
        if (podId === targetPodId) return { id: targetPodId, name: 'Target Pod' } as any;
        return undefined;
      });
      vi.spyOn(runStore, 'countRunsByCanvasId').mockReturnValue(1);

      await runExecutionService.createRun(canvasId, sourcePodId, '測試');

      const emitCall = vi.mocked(socketService.emitToCanvas).mock.calls[0];
      const payload = emitCall?.[2] as any;
      const instances = payload?.run?.podInstances as Array<{ podId: string; podName: string }>;

      const sourceResult = instances?.find((i) => i.podId === sourcePodId);
      const targetResult = instances?.find((i) => i.podId === targetPodId);

      expect(sourceResult?.podName).toBe('Source Pod');
      expect(targetResult?.podName).toBe('Target Pod');
    });

    it('pod 找不到時 podName fallback 為 podId', async () => {
      const unknownPodId = 'pod-unknown';
      const mockRun = createMockRun();
      const unknownInstance = createMockInstance({ podId: unknownPodId });

      vi.spyOn(runStore, 'createRun').mockReturnValue(mockRun);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);
      vi.spyOn(runStore, 'createPodInstance').mockReturnValue(unknownInstance);
      vi.spyOn(podStore, 'getById').mockReturnValue(undefined);
      vi.spyOn(runStore, 'countRunsByCanvasId').mockReturnValue(1);

      await runExecutionService.createRun(canvasId, unknownPodId, '測試');

      const emitCall = vi.mocked(socketService.emitToCanvas).mock.calls[0];
      const payload = emitCall?.[2] as any;
      const instances = payload?.run?.podInstances as Array<{ podId: string; podName: string }>;

      expect(instances?.[0]?.podName).toBe(unknownPodId);
    });

    it('source pod 找不到時 sourcePodName fallback 為 podId', async () => {
      const mockRun = createMockRun();
      vi.spyOn(runStore, 'createRun').mockReturnValue(mockRun);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);
      vi.spyOn(runStore, 'createPodInstance').mockReturnValue(createMockInstance());
      vi.spyOn(podStore, 'getById').mockReturnValue(undefined);
      vi.spyOn(runStore, 'countRunsByCanvasId').mockReturnValue(1);

      await runExecutionService.createRun(canvasId, sourcePodId, '測試');

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CREATED,
        expect.objectContaining({ run: expect.objectContaining({ sourcePodName: sourcePodId }) }),
      );
    });

    it('run 數量超過上限時觸發 enforceRunLimit 刪除最舊的 run', async () => {
      const mockRun = createMockRun();
      vi.spyOn(runStore, 'createRun').mockReturnValue(mockRun);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);
      vi.spyOn(runStore, 'createPodInstance').mockReturnValue(createMockInstance());
      vi.spyOn(podStore, 'getById').mockReturnValue(undefined);
      vi.spyOn(runStore, 'countRunsByCanvasId').mockReturnValue(31);
      vi.spyOn(runStore, 'getOldestCompletedRunIds').mockReturnValue(['old-run-1']);
      const deleteSpy = vi.spyOn(runStore, 'deleteRun').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ id: 'old-run-1' }));

      await runExecutionService.createRun(canvasId, sourcePodId, '測試');

      expect(deleteSpy).toHaveBeenCalledWith('old-run-1');
    });
  });

  describe('startPodInstance', () => {
    it('更新 status 為 running 並發送事件', () => {
      const instance = createMockInstance({ status: 'pending' });
      vi.spyOn(runStore, 'getPodInstance').mockReturnValueOnce(instance);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});

      runExecutionService.startPodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(instance.id, 'running');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: sourcePodId, status: 'running' }),
      );
    });

    it('找不到 instance 時 log warning 不拋錯', () => {
      vi.spyOn(runStore, 'getPodInstance').mockReturnValue(undefined);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});

      expect(() => runExecutionService.startPodInstance(makeRunContext(), sourcePodId)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
      expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
    });
  });

  describe('settlePodTrigger', () => {
    it('settle pathways 後狀態非 pending → 更新 status 為 completed 並評估 run 狀態', () => {
      const instance = createMockInstance({ status: 'running' });
      const settledInstance = createMockInstance({ status: 'running', autoPathwaySettled: true });
      const completedInstance = createMockInstance({ status: 'completed', completedAt: new Date().toISOString() });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, 'settleAllPathways').mockImplementation(() => {});
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([completedInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'completed', completedAt: new Date().toISOString() }));
      vi.spyOn(connectionStore, 'list').mockReturnValue([]);

      runExecutionService.settlePodTrigger(makeRunContext(), sourcePodId);

      expect(runStore.settleAllPathways).toHaveBeenCalledWith(instance.id);
      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(settledInstance.id, 'completed');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ status: 'completed' }),
      );
      expect(runStore.updateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('找不到 instance 時 log warning 不拋錯', () => {
      vi.spyOn(runStore, 'getPodInstance').mockReturnValue(undefined);

      expect(() => runExecutionService.settlePodTrigger(makeRunContext(), sourcePodId)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('errorPodInstance', () => {
    it('更新 status 為 error 並帶入 errorMessage', () => {
      const instance = createMockInstance({ status: 'running' });
      const errorInstance = createMockInstance({ status: 'error', errorMessage: '執行失敗', completedAt: new Date().toISOString() });
      vi.spyOn(runStore, 'getPodInstance').mockReturnValueOnce(instance);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([errorInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'error', completedAt: new Date().toISOString() }));

      runExecutionService.errorPodInstance(makeRunContext(), sourcePodId, '執行失敗');

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(instance.id, 'error', '執行失敗');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ status: 'error', errorMessage: '執行失敗' }),
      );
    });

    it('找不到 instance 時 log warning 不拋錯', () => {
      vi.spyOn(runStore, 'getPodInstance').mockReturnValue(undefined);

      expect(() => runExecutionService.errorPodInstance(makeRunContext(), sourcePodId, 'err')).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('summarizingPodInstance', () => {
    it('更新 status 為 summarizing 並發送事件，不評估 run 狀態', () => {
      const instance = createMockInstance({ status: 'running' });
      vi.spyOn(runStore, 'getPodInstance').mockReturnValueOnce(instance);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([]);

      runExecutionService.summarizingPodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(instance.id, 'summarizing');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: sourcePodId, status: 'summarizing' }),
      );
      expect(runStore.getPodInstancesByRunId).not.toHaveBeenCalled();
    });

    it('找不到 instance 時 log warning 不拋錯', () => {
      vi.spyOn(runStore, 'getPodInstance').mockReturnValue(undefined);

      expect(() => runExecutionService.summarizingPodInstance(makeRunContext(), sourcePodId)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('evaluateRunStatus（透過 settlePodTrigger 觸發）', () => {
    it('有 error 且無進行中的 instance → run 狀態變為 error', () => {
      const errorInstance = createMockInstance({ status: 'error', errorMessage: '失敗' });
      const skippedInstance = createMockInstance({ id: 'instance-2', podId: targetPodId, status: 'skipped' });
      const instance = createMockInstance({ status: 'running' });
      const settledInstance = createMockInstance({ status: 'running', autoPathwaySettled: true });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, 'settleAllPathways').mockImplementation(() => {});
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([errorInstance, skippedInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'error', completedAt: new Date().toISOString() }));
      vi.spyOn(connectionStore, 'list').mockReturnValue([]);

      runExecutionService.settlePodTrigger(makeRunContext(), sourcePodId);

      expect(runStore.updateRunStatus).toHaveBeenCalledWith('run-1', 'error');
    });

    it('有 pending instance 時不更新 run 狀態', () => {
      const runningInstance = createMockInstance({ status: 'running' });
      const pendingInstance = createMockInstance({ id: 'instance-2', podId: targetPodId, status: 'pending' });
      const instance = createMockInstance({ status: 'running' });
      const settledInstance = createMockInstance({ status: 'running', autoPathwaySettled: true });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, 'settleAllPathways').mockImplementation(() => {});
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([runningInstance, pendingInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(connectionStore, 'list').mockReturnValue([]);

      runExecutionService.settlePodTrigger(makeRunContext(), sourcePodId);

      expect(runStore.updateRunStatus).not.toHaveBeenCalled();
    });

    it('全部 instance 為 completed → run 狀態變為 completed', () => {
      const completedInstance1 = createMockInstance({ status: 'completed' });
      const completedInstance2 = createMockInstance({ id: 'instance-2', podId: targetPodId, status: 'completed' });
      const instance = createMockInstance({ status: 'running' });
      const settledInstance = createMockInstance({ status: 'running', autoPathwaySettled: true });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, 'settleAllPathways').mockImplementation(() => {});
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([completedInstance1, completedInstance2]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'completed', completedAt: new Date().toISOString() }));
      vi.spyOn(connectionStore, 'list').mockReturnValue([]);

      runExecutionService.settlePodTrigger(makeRunContext(), sourcePodId);

      expect(runStore.updateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    });

    it('全部 instance 為 completed/skipped 混合 → run 狀態變為 completed', () => {
      const completedInstance = createMockInstance({ status: 'completed' });
      const skippedInstance = createMockInstance({ id: 'instance-2', podId: targetPodId, status: 'skipped' });
      const instance = createMockInstance({ status: 'running' });
      const settledInstance = createMockInstance({ status: 'running', autoPathwaySettled: true });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, 'settleAllPathways').mockImplementation(() => {});
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([completedInstance, skippedInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'completed', completedAt: new Date().toISOString() }));
      vi.spyOn(connectionStore, 'list').mockReturnValue([]);

      runExecutionService.settlePodTrigger(makeRunContext(), sourcePodId);

      expect(runStore.updateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    });

    it('errorPodInstance 後有 error 且無進行中 → run 最終狀態更新為 error 並發送 RUN_STATUS_CHANGED', () => {
      const errorInstance = createMockInstance({ status: 'error', errorMessage: '執行錯誤' });
      const completedInstance = createMockInstance({ id: 'instance-2', podId: targetPodId, status: 'completed' });
      const instance = createMockInstance({ status: 'running' });
      vi.spyOn(runStore, 'getPodInstance').mockReturnValueOnce(instance);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([errorInstance, completedInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'error', completedAt: new Date().toISOString() }));
      vi.spyOn(connectionStore, 'list').mockReturnValue([]);

      runExecutionService.errorPodInstance(makeRunContext(), sourcePodId, '執行錯誤');

      expect(runStore.updateRunStatus).toHaveBeenCalledWith('run-1', 'error');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
        expect.objectContaining({ status: 'error' }),
      );
    });
  });

  describe('registerActiveStream / unregisterActiveStream', () => {
    it('register 後 unregister 正確清理 Map', () => {
      runExecutionService.registerActiveStream('run-x', 'pod-1');
      runExecutionService.registerActiveStream('run-x', 'pod-2');
      runExecutionService.unregisterActiveStream('run-x', 'pod-1');
      runExecutionService.unregisterActiveStream('run-x', 'pod-2');

      // deleteRun 呼叫時不應 abort 任何 pod（Map 已清空）
      vi.spyOn(claudeService, 'abortQuery').mockReturnValue(false);
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ id: 'run-x' }));
      vi.spyOn(runStore, 'deleteRun').mockImplementation(() => {});

      runExecutionService.deleteRun('run-x');

      expect(claudeService.abortQuery).not.toHaveBeenCalled();
    });

    it('Set 為空時從 Map 移除 runId', () => {
      runExecutionService.registerActiveStream('run-y', 'pod-1');
      runExecutionService.unregisterActiveStream('run-y', 'pod-1');

      vi.spyOn(claudeService, 'abortQuery').mockReturnValue(false);
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ id: 'run-y' }));
      vi.spyOn(runStore, 'deleteRun').mockImplementation(() => {});

      runExecutionService.deleteRun('run-y');

      expect(claudeService.abortQuery).not.toHaveBeenCalled();
    });
  });

  describe('deleteRun', () => {
    it('中斷活躍串流中的 pod 並刪除 run 發送事件', () => {
      runExecutionService.registerActiveStream('run-del', 'pod-active');
      vi.spyOn(claudeService, 'abortQuery').mockReturnValue(true);
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ id: 'run-del', canvasId }));
      vi.spyOn(runStore, 'deleteRun').mockImplementation(() => {});

      runExecutionService.deleteRun('run-del');

      expect(claudeService.abortQuery).toHaveBeenCalledWith('run-del:pod-active');
      expect(runStore.deleteRun).toHaveBeenCalledWith('run-del');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_DELETED,
        { runId: 'run-del', canvasId },
      );
    });

    it('run 不存在時不發送 RUN_DELETED 事件', () => {
      vi.spyOn(runStore, 'getRun').mockReturnValue(undefined);
      vi.spyOn(runStore, 'deleteRun').mockImplementation(() => {});

      runExecutionService.deleteRun('run-ghost');

      expect(runStore.deleteRun).toHaveBeenCalledWith('run-ghost');
      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it('無活躍串流時不呼叫 abortQuery', () => {
      vi.spyOn(claudeService, 'abortQuery').mockReturnValue(false);
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ id: 'run-no-stream', canvasId }));
      vi.spyOn(runStore, 'deleteRun').mockImplementation(() => {});

      runExecutionService.deleteRun('run-no-stream');

      expect(claudeService.abortQuery).not.toHaveBeenCalled();
    });
  });
});
