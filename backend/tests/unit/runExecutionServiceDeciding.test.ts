import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runExecutionService } from '../../src/services/workflow/runExecutionService.js';
import { runStore } from '../../src/services/runStore.js';
import { connectionStore } from '../../src/services/connectionStore.js';
import { socketService } from '../../src/services/socketService.js';
import { logger } from '../../src/utils/logger.js';
import type { RunPodInstance } from '../../src/services/runStore.js';
import type { RunContext } from '../../src/types/run.js';

function makeRunContext(): RunContext {
  return { runId: 'run-1', canvasId: 'canvas-1', sourcePodId: 'pod-source' };
}

function makeInstance(overrides?: Partial<RunPodInstance>): RunPodInstance {
  return {
    id: 'instance-1',
    runId: 'run-1',
    podId: 'pod-target',
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

describe('RunExecutionService - deciding 狀態', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(socketService, 'emitToCanvas').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decidingPodInstance 將 pod 狀態更新為 deciding', () => {
    const instance = makeInstance();
    vi.spyOn(runStore, 'getPodInstance').mockReturnValue(instance);
    vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});

    runExecutionService.decidingPodInstance(makeRunContext(), 'pod-target');

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(instance.id, 'deciding');
    expect(socketService.emitToCanvas).toHaveBeenCalled();
  });

  it('deciding 狀態不觸發 evaluateRunStatus', () => {
    const instance = makeInstance({ status: 'pending' });
    vi.spyOn(runStore, 'getPodInstance').mockReturnValue(instance);
    vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([
      makeInstance({ status: 'deciding' }),
    ]);

    runExecutionService.decidingPodInstance(makeRunContext(), 'pod-target');

    expect(runStore.updateRunStatus).not.toHaveBeenCalled();
  });

  it('有 deciding 的 instance 時，settleAndSkipPath 後不應完成 run', () => {
    const instanceA = makeInstance({ podId: 'pod-a', status: 'deciding' });
    const instanceB = makeInstance({ podId: 'pod-b', status: 'pending', autoPathwaySettled: false });
    const instanceBAfterSettle = makeInstance({ podId: 'pod-b', status: 'pending', autoPathwaySettled: true });
    vi.spyOn(runStore, 'getPodInstance')
      .mockReturnValueOnce(instanceB)
      .mockReturnValueOnce(instanceBAfterSettle)
      .mockReturnValueOnce(instanceBAfterSettle);
    vi.spyOn(runStore, 'settleAutoPathway').mockImplementation(() => {});
    vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([instanceA, instanceB]);
    vi.spyOn(connectionStore, 'list').mockReturnValue([]);

    runExecutionService.settleAndSkipPath(makeRunContext(), 'pod-b', 'auto');

    expect(runStore.updateRunStatus).not.toHaveBeenCalled();
  });
});

describe('evaluateRunStatus — deciding 狀態處理', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(socketService, 'emitToCanvas').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('有 pod 處於 deciding 狀態時，即使其他 pod 有 error，Run 不應結束', () => {
    // instanceA status 為 error，表示已非 pending，settlePodTrigger 會觸發 completed 流程進而呼叫 evaluateRunStatus
    const instanceA = makeInstance({ podId: 'pod-a', status: 'error', autoPathwaySettled: false });
    const instanceB = makeInstance({ id: 'instance-2', podId: 'pod-b', status: 'deciding' });
    const instanceASettled = makeInstance({ podId: 'pod-a', status: 'error', autoPathwaySettled: true });
    vi.spyOn(runStore, 'getPodInstance')
      .mockReturnValueOnce(instanceA)
      .mockReturnValueOnce(instanceASettled)
      .mockReturnValueOnce(instanceASettled);
    vi.spyOn(runStore, 'settleAutoPathway').mockImplementation(() => {});
    vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([instanceA, instanceB]);
    vi.spyOn(connectionStore, 'list').mockReturnValue([]);

    runExecutionService.settlePodTrigger(makeRunContext(), 'pod-a', 'auto');

    expect(runStore.updateRunStatus).not.toHaveBeenCalled();
  });

  it('所有 pod completed/skipped 且無 deciding 時，Run 標記為 completed', () => {
    const instanceA = makeInstance({ podId: 'pod-a', status: 'completed', autoPathwaySettled: false });
    const instanceB = makeInstance({ id: 'instance-2', podId: 'pod-b', status: 'skipped' });
    const instanceASettled = makeInstance({ podId: 'pod-a', status: 'completed', autoPathwaySettled: true });
    vi.spyOn(runStore, 'getPodInstance')
      .mockReturnValueOnce(instanceA)
      .mockReturnValueOnce(instanceASettled)
      .mockReturnValueOnce(instanceASettled);
    vi.spyOn(runStore, 'settleAutoPathway').mockImplementation(() => {});
    vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {});
    vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([instanceA, instanceB]);
    vi.spyOn(connectionStore, 'list').mockReturnValue([]);
    vi.spyOn(runStore, 'getRun').mockReturnValue({
      id: 'run-1',
      canvasId: 'canvas-1',
      sourcePodId: 'pod-source',
      triggerMessage: '測試',
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    runExecutionService.settlePodTrigger(makeRunContext(), 'pod-a', 'auto');

    expect(runStore.updateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
  });
});
