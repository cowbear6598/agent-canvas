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
      vi.spyOn(podStore, 'getById').mockReturnValue({ id: sourcePodId, name: 'Source Pod' } as any);
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
      const updatedInstance = createMockInstance({ status: 'running', triggeredAt: new Date().toISOString() });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(updatedInstance);
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

  describe('completePodInstance', () => {
    it('更新 status 為 completed 並評估 run 狀態', () => {
      const instance = createMockInstance({ status: 'running' });
      const updatedInstance = createMockInstance({ status: 'completed', completedAt: new Date().toISOString() });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(updatedInstance);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([updatedInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'completed', completedAt: new Date().toISOString() }));

      runExecutionService.completePodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(instance.id, 'completed');
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

      expect(() => runExecutionService.completePodInstance(makeRunContext(), sourcePodId)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('errorPodInstance', () => {
    it('更新 status 為 error 並帶入 errorMessage', () => {
      const instance = createMockInstance({ status: 'running' });
      const updatedInstance = createMockInstance({ status: 'error', errorMessage: '執行失敗', completedAt: new Date().toISOString() });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(updatedInstance);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([updatedInstance]);
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
      const updatedInstance = createMockInstance({ status: 'summarizing' });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(updatedInstance);
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

  describe('skipPodInstance', () => {
    it('更新 status 為 skipped 並發送事件、評估 run 狀態', () => {
      const instance = createMockInstance({ status: 'pending' });
      const updatedInstance = createMockInstance({ status: 'skipped', completedAt: new Date().toISOString() });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(updatedInstance);
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([updatedInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'completed', completedAt: new Date().toISOString() }));

      runExecutionService.skipPodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(instance.id, 'skipped');
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ status: 'skipped' }),
      );
    });

    it('找不到 instance 時 log warning 不拋錯', () => {
      vi.spyOn(runStore, 'getPodInstance').mockReturnValue(undefined);

      expect(() => runExecutionService.skipPodInstance(makeRunContext(), sourcePodId)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('evaluateRunStatus（透過 completePodInstance 觸發）', () => {
    it('有 error 且無進行中的 instance → run 狀態變為 error', () => {
      const errorInstance = createMockInstance({ status: 'error', errorMessage: '失敗' });
      const skippedInstance = createMockInstance({ id: 'instance-2', podId: targetPodId, status: 'skipped' });
      const instance = createMockInstance({ status: 'running' });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(createMockInstance({ status: 'completed' }));
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([errorInstance, skippedInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getRun').mockReturnValue(createMockRun({ status: 'error', completedAt: new Date().toISOString() }));

      runExecutionService.completePodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updateRunStatus).toHaveBeenCalledWith('run-1', 'error');
    });

    it('有 pending instance 時不更新 run 狀態', () => {
      const runningInstance = createMockInstance({ status: 'running' });
      const pendingInstance = createMockInstance({ id: 'instance-2', podId: targetPodId, status: 'pending' });
      const instance = createMockInstance({ status: 'running' });
      vi.spyOn(runStore, 'getPodInstance')
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(createMockInstance({ status: 'completed' }));
      vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
      vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([runningInstance, pendingInstance]);
      vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});

      runExecutionService.completePodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updateRunStatus).not.toHaveBeenCalled();
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
