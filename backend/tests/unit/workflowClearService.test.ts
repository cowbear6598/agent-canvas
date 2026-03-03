import { vi } from 'vitest';

vi.mock('../../src/services/connectionStore.js', () => ({
  connectionStore: {
    findBySourcePodId: vi.fn(),
    findByTargetPodId: vi.fn(),
    updateDecideStatus: vi.fn(),
    updateConnectionStatus: vi.fn(),
  },
}));

vi.mock('../../src/services/podStore.js', () => ({
  podStore: {
    getById: vi.fn(),
    setClaudeSessionId: vi.fn(),
    resetClaudeSession: vi.fn(),
  },
}));

vi.mock('../../src/services/messageStore.js', () => ({
  messageStore: {
    clearMessages: vi.fn(),
  },
}));

vi.mock('../../src/services/persistence/chatPersistence.js', () => ({
  chatPersistenceService: {
    clearChatHistory: vi.fn(),
  },
}));

vi.mock('../../src/services/canvasStore.js', () => ({
  canvasStore: {
    getCanvasDir: vi.fn(),
  },
}));

vi.mock('../../src/services/pendingTargetStore.js', () => ({
  pendingTargetStore: {
    clearPendingTarget: vi.fn(),
  },
}));

vi.mock('../../src/services/directTriggerStore.js', () => ({
  directTriggerStore: {
    clearDirectPending: vi.fn(),
    clearTimer: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { workflowClearService } from '../../src/services/workflowClearService.js';
import { connectionStore } from '../../src/services/connectionStore.js';
import { podStore } from '../../src/services/podStore.js';
import { messageStore } from '../../src/services/messageStore.js';
import { chatPersistenceService } from '../../src/services/persistence/chatPersistence.js';
import { canvasStore } from '../../src/services/canvasStore.js';
import { pendingTargetStore } from '../../src/services/pendingTargetStore.js';
import { directTriggerStore } from '../../src/services/directTriggerStore.js';

const CANVAS_ID = 'canvas-1';
const CANVAS_DIR = '/tmp/test-canvas-1';
const SOURCE_POD_ID = 'pod-1';
const TARGET_POD_ID = 'pod-2';
const DOWNSTREAM_POD_ID = 'pod-3';

function setupDefaultMocks() {
  (canvasStore.getCanvasDir as any).mockReturnValue(CANVAS_DIR);

  (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
    if (podId === SOURCE_POD_ID) {
      return [{ id: 'conn-1', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'auto', decideStatus: 'none' }];
    }
    if (podId === TARGET_POD_ID) {
      return [{ id: 'conn-2', sourcePodId: TARGET_POD_ID, targetPodId: DOWNSTREAM_POD_ID, triggerMode: 'auto', decideStatus: 'none' }];
    }
    return [];
  });

  (podStore.getById as any).mockImplementation((_cId: string, podId: string) => {
    const pods: Record<string, { id: string; name: string }> = {
      [SOURCE_POD_ID]: { id: SOURCE_POD_ID, name: 'Source Pod' },
      [TARGET_POD_ID]: { id: TARGET_POD_ID, name: 'Target Pod' },
      [DOWNSTREAM_POD_ID]: { id: DOWNSTREAM_POD_ID, name: 'Downstream Pod' },
    };
    return pods[podId] ?? null;
  });

  (chatPersistenceService.clearChatHistory as any).mockResolvedValue({ success: true });
}

describe('WorkflowClearService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('clearWorkflow 基本功能', () => {
    it('canvas 不存在時，回傳失敗結果', async () => {
      (canvasStore.getCanvasDir as any).mockReturnValue(null);

      const result = await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain(CANVAS_ID);
      expect(result.clearedPodIds).toHaveLength(0);
    });

    it('成功清除 source pod 及所有下游 pod', async () => {
      const result = await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(result.success).toBe(true);
      expect(result.clearedPodIds).toContain(SOURCE_POD_ID);
      expect(result.clearedPodIds).toContain(TARGET_POD_ID);
      expect(result.clearedPodIds).toContain(DOWNSTREAM_POD_ID);
      expect(result.clearedPodNames).toContain('Source Pod');
      expect(result.clearedPodNames).toContain('Target Pod');
      expect(result.clearedPodNames).toContain('Downstream Pod');
    });

    it('對每個被清除的 pod 呼叫 messageStore.clearMessages', async () => {
      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(messageStore.clearMessages).toHaveBeenCalledWith(SOURCE_POD_ID);
      expect(messageStore.clearMessages).toHaveBeenCalledWith(TARGET_POD_ID);
      expect(messageStore.clearMessages).toHaveBeenCalledWith(DOWNSTREAM_POD_ID);
    });
  });

  describe('clearWorkflow 清除 pendingTargetStore 殘留資料', () => {
    it('對每個被清除的 pod 呼叫 pendingTargetStore.clearPendingTarget', async () => {
      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(SOURCE_POD_ID);
      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(TARGET_POD_ID);
      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(DOWNSTREAM_POD_ID);
    });

    it('第二次執行 workflow 前，pendingTargetStore 不應有殘留資料', async () => {
      // 第一次清除
      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      const firstClearCallCount = (pendingTargetStore.clearPendingTarget as any).mock.calls.length;
      expect(firstClearCallCount).toBeGreaterThan(0);

      // 模擬第二次執行前，再次清除
      vi.clearAllMocks();
      setupDefaultMocks();

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      // 第二次清除時，每個 pod 都應被清除
      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(SOURCE_POD_ID);
      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(TARGET_POD_ID);
      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(DOWNSTREAM_POD_ID);
    });

    it('只有單一 pod（無下游）時，也會清除 pendingTargetStore', async () => {
      (connectionStore.findBySourcePodId as any).mockReturnValue([]);

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledWith(SOURCE_POD_ID);
      expect(pendingTargetStore.clearPendingTarget).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearWorkflow 清除 directTriggerStore 殘留資料', () => {
    it('對每個被清除的 pod 呼叫 directTriggerStore.clearDirectPending', async () => {
      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(directTriggerStore.clearDirectPending).toHaveBeenCalledWith(SOURCE_POD_ID);
      expect(directTriggerStore.clearDirectPending).toHaveBeenCalledWith(TARGET_POD_ID);
      expect(directTriggerStore.clearDirectPending).toHaveBeenCalledWith(DOWNSTREAM_POD_ID);
    });
  });

  describe('clearWorkflow 清除 ai-decide connection 狀態', () => {
    it('ai-decide connection 且 decideStatus 非 none 時，重設為 none', async () => {
      (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
        if (podId === SOURCE_POD_ID) {
          return [{ id: 'conn-ai', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'ai-decide', decideStatus: 'approved' }];
        }
        return [];
      });

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(CANVAS_ID, 'conn-ai', 'none', null);
    });

    it('ai-decide connection 且 decideStatus 為 none 時，不呼叫 updateDecideStatus', async () => {
      (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
        if (podId === SOURCE_POD_ID) {
          return [{ id: 'conn-ai', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'ai-decide', decideStatus: 'none' }];
        }
        return [];
      });

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(connectionStore.updateDecideStatus).not.toHaveBeenCalled();
    });

    it('ai-decide connection 為 approved 狀態時，connectionStatus 重置為 idle', async () => {
      (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
        if (podId === SOURCE_POD_ID) {
          return [{ id: 'conn-ai', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'ai-decide', decideStatus: 'approved' }];
        }
        return [];
      });

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(CANVAS_ID, 'conn-ai', 'idle');
    });

    it('ai-decide connection 為 rejected 狀態時，connectionStatus 重置為 idle', async () => {
      (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
        if (podId === SOURCE_POD_ID) {
          return [{ id: 'conn-ai', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'ai-decide', decideStatus: 'rejected' }];
        }
        return [];
      });

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(CANVAS_ID, 'conn-ai', 'idle');
    });

    it('ai-decide connection 為 error 狀態時，connectionStatus 重置為 idle', async () => {
      (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
        if (podId === SOURCE_POD_ID) {
          return [{ id: 'conn-ai', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'ai-decide', decideStatus: 'error' }];
        }
        return [];
      });

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(CANVAS_ID, 'conn-ai', 'idle');
    });

    it('多條 ai-decide connection 全部都應被重置 connectionStatus 為 idle', async () => {
      (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
        if (podId === SOURCE_POD_ID) {
          return [
            { id: 'conn-ai-1', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'ai-decide', decideStatus: 'approved' },
            { id: 'conn-ai-2', sourcePodId: SOURCE_POD_ID, targetPodId: DOWNSTREAM_POD_ID, triggerMode: 'ai-decide', decideStatus: 'rejected' },
          ];
        }
        return [];
      });

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(CANVAS_ID, 'conn-ai-1', 'idle');
      expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(CANVAS_ID, 'conn-ai-2', 'idle');
    });

    it('ai-decide connection 且 decideStatus 為 none 時，不呼叫 updateConnectionStatus', async () => {
      (connectionStore.findBySourcePodId as any).mockImplementation((_cId: string, podId: string) => {
        if (podId === SOURCE_POD_ID) {
          return [{ id: 'conn-ai', sourcePodId: SOURCE_POD_ID, targetPodId: TARGET_POD_ID, triggerMode: 'ai-decide', decideStatus: 'none' }];
        }
        return [];
      });

      await workflowClearService.clearWorkflow(CANVAS_ID, SOURCE_POD_ID);

      expect(connectionStore.updateConnectionStatus).not.toHaveBeenCalled();
    });
  });

  describe('getDownstreamPodIds 正確計算下游 pod', () => {
    it('無下游 pod 時，只回傳 source pod 本身', () => {
      (connectionStore.findBySourcePodId as any).mockReturnValue([]);

      const result = workflowClearService.getDownstreamPodIds(CANVAS_ID, SOURCE_POD_ID);

      expect(result).toEqual([SOURCE_POD_ID]);
    });

    it('有連鎖下游 pod 時，全部回傳', () => {
      const result = workflowClearService.getDownstreamPodIds(CANVAS_ID, SOURCE_POD_ID);

      expect(result).toContain(SOURCE_POD_ID);
      expect(result).toContain(TARGET_POD_ID);
      expect(result).toContain(DOWNSTREAM_POD_ID);
    });
  });
});
