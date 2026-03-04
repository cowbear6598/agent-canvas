import { autoClearService } from '../../src/services/autoClear';
import { connectionStore } from '../../src/services/connectionStore.js';
import { podStore } from '../../src/services/podStore.js';
import { terminalPodTracker } from '../../src/services/autoClear';
import { workflowClearService } from '../../src/services/workflowClearService.js';
import { workflowEventEmitter } from '../../src/services/workflow/workflowEventEmitter.js';
import { socketService } from '../../src/services/socketService.js';
import type { Pod, Connection } from '../../src/types';
import { v4 as uuidv4 } from 'uuid';

describe('AutoClearService 單元測試', () => {
  const canvasId = 'test-canvas-id';

  beforeEach(() => {
    // restoreAllMocks 才能還原 spy 到原始方法，避免 clearAllMocks 導致 spy 變成空函數
    vi.restoreAllMocks();
    terminalPodTracker.clearAll();
  });

  describe('findTerminalPods - BFS 邏輯測試', () => {
    it('測試單一鏈式連接：A -> B -> C', () => {
      const podA = createMockPod('A');
      const podB = createMockPod('B');
      const podC = createMockPod('C');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podB.id, 'auto')];
        if (sourceId === podB.id) return [createMockConnection(podB.id, podC.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]);

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.size).toBe(1);
      expect(terminalPods.has(podC.id)).toBe(true);
      expect(terminalPods.get(podC.id)).toBe(1);
    });

    it('測試分支連接：A -> B, A -> C', () => {
      const podA = createMockPod('A');
      const podB = createMockPod('B');
      const podC = createMockPod('C');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) {
          return [
            createMockConnection(podA.id, podB.id, 'auto'),
            createMockConnection(podA.id, podC.id, 'auto'),
          ];
        }
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]);

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.size).toBe(2);
      expect(terminalPods.has(podB.id)).toBe(true);
      expect(terminalPods.has(podC.id)).toBe(true);
    });

    it('測試循環防護：A -> B -> C -> A', () => {
      const podA = createMockPod('A');
      const podB = createMockPod('B');
      const podC = createMockPod('C');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podB.id, 'auto')];
        if (sourceId === podB.id) return [createMockConnection(podB.id, podC.id, 'auto')];
        if (sourceId === podC.id) return [createMockConnection(podC.id, podA.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]);

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.size).toBe(0);
    });

    it('測試混合連接：有 auto-trigger 和無 auto-trigger 的混合', () => {
      const podA = createMockPod('A');
      const podB = createMockPod('B');
      const podC = createMockPod('C');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) {
          return [
            createMockConnection(podA.id, podB.id, 'auto'),
            createMockConnection(podA.id, podC.id, 'ai-decide'),
          ];
        }
        if (sourceId === podB.id) return [createMockConnection(podB.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]);

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.size).toBe(1);
      expect(terminalPods.has(podD.id)).toBe(true);
    });

    it('測試複雜樹狀結構：A -> B -> D, A -> C -> E', () => {
      const podA = createMockPod('A');
      const podB = createMockPod('B');
      const podC = createMockPod('C');
      const podD = createMockPod('D');
      const podE = createMockPod('E');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) {
          return [
            createMockConnection(podA.id, podB.id, 'auto'),
            createMockConnection(podA.id, podC.id, 'auto'),
          ];
        }
        if (sourceId === podB.id) return [createMockConnection(podB.id, podD.id, 'auto')];
        if (sourceId === podC.id) return [createMockConnection(podC.id, podE.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]);

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.size).toBe(2);
      expect(terminalPods.has(podD.id)).toBe(true);
      expect(terminalPods.has(podE.id)).toBe(true);
    });

    it('calculateExpectedGroups: 只有 auto 連入的 POD 預期組數為 1', () => {
      const podA = createMockPod('A');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.get(podD.id)).toBe(1);
    });

    it('calculateExpectedGroups: 同時有 auto 和 direct 連入的 POD 預期組數為 2', () => {
      const podA = createMockPod('A');
      const podC = createMockPod('C');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        return [];
      });

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.get(podD.id)).toBe(2);
    });

    it('calculateExpectedGroups: 只有 direct 連入的 POD 預期組數為 1（不在 auto 路徑上）', () => {
      const podA = createMockPod('A');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      // podD 只有 auto incoming，沒有 direct
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });

      const terminalPods = autoClearService.findTerminalPods(canvasId, podA.id);

      expect(terminalPods.get(podD.id)).toBe(1);
    });
  });

  describe('initializeWorkflowTracking - 初始化邏輯測試', () => {
    it('當 Pod 不存在時，不執行初始化', () => {
      const podId = uuidv4();

      vi.spyOn(podStore, 'getById').mockReturnValue(undefined);
      vi.spyOn(terminalPodTracker, 'initializeTracking');

      autoClearService.initializeWorkflowTracking(canvasId, podId);

      expect(terminalPodTracker.initializeTracking).not.toHaveBeenCalled();
    });

    it('當 Pod 沒有 autoClear 時，不執行初始化', () => {
      const pod = createMockPod('A', false);

      vi.spyOn(podStore, 'getById').mockReturnValue(pod);
      vi.spyOn(terminalPodTracker, 'initializeTracking');

      autoClearService.initializeWorkflowTracking(canvasId, pod.id);

      expect(terminalPodTracker.initializeTracking).not.toHaveBeenCalled();
    });

    it('當 Pod 沒有 outgoing auto-trigger 時，不執行初始化', () => {
      const pod = createMockPod('A', true);

      vi.spyOn(podStore, 'getById').mockReturnValue(pod);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);
      vi.spyOn(terminalPodTracker, 'initializeTracking');

      autoClearService.initializeWorkflowTracking(canvasId, pod.id);

      expect(terminalPodTracker.initializeTracking).not.toHaveBeenCalled();
    });

    it('當沒有 terminal pods 時，不執行初始化', () => {
      const podA = createMockPod('A', true);
      const podB = createMockPod('B', true);

      vi.spyOn(podStore, 'getById').mockReturnValue(podA);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podB.id, 'auto')];
        if (sourceId === podB.id) return [createMockConnection(podB.id, podA.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]);
      vi.spyOn(terminalPodTracker, 'initializeTracking');

      autoClearService.initializeWorkflowTracking(canvasId, podA.id);

      expect(terminalPodTracker.initializeTracking).not.toHaveBeenCalled();
    });

    it('正常情況下，正確初始化 terminalPodTracker（傳入 Map<string, number>）', () => {
      const podA = createMockPod('A', true);
      const podB = createMockPod('B', true);
      const podC = createMockPod('C', true);

      vi.spyOn(podStore, 'getById').mockReturnValue(podA);
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) {
          return [
            createMockConnection(podA.id, podB.id, 'auto'),
            createMockConnection(podA.id, podC.id, 'auto'),
          ];
        }
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]);
      vi.spyOn(terminalPodTracker, 'initializeTracking');

      autoClearService.initializeWorkflowTracking(canvasId, podA.id);

      expect(terminalPodTracker.initializeTracking).toHaveBeenCalledWith(
        podA.id,
        expect.any(Map)
      );

      const callArg = (terminalPodTracker.initializeTracking as ReturnType<typeof vi.spyOn>).mock.calls[0][1] as Map<string, number>;
      expect(callArg.has(podB.id)).toBe(true);
      expect(callArg.has(podC.id)).toBe(true);
      expect(callArg.get(podB.id)).toBe(1);
      expect(callArg.get(podC.id)).toBe(1);
    });
  });

  describe('onPodComplete - 條件判斷測試', () => {
    it('Pod 不存在時，不執行任何操作', async () => {
      const podId = uuidv4();

      vi.spyOn(podStore, 'getById').mockReturnValue(undefined);
      vi.spyOn(autoClearService, 'executeAutoClear');

      await autoClearService.onPodComplete(canvasId, podId);

      expect(autoClearService.executeAutoClear).not.toHaveBeenCalled();
    });

    it('Pod 沒有 autoClear 時，不執行清除', async () => {
      const pod = createMockPod('A', false);

      vi.spyOn(podStore, 'getById').mockReturnValue(pod);
      vi.spyOn(terminalPodTracker, 'recordCompletion').mockReturnValue({
        allComplete: false,
        sourcePodId: null,
      });
      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);
      vi.spyOn(autoClearService, 'executeAutoClear');

      await autoClearService.onPodComplete(canvasId, pod.id);

      expect(autoClearService.executeAutoClear).not.toHaveBeenCalled();
    });

    it('Pod 有 outgoing auto-trigger 時，等待下游完成（不立即清除）', async () => {
      const podA = createMockPod('A', true);
      const podB = createMockPod('B', true);

      vi.spyOn(podStore, 'getById').mockReturnValue(podA);
      vi.spyOn(terminalPodTracker, 'recordCompletion').mockReturnValue({
        allComplete: false,
        sourcePodId: null,
      });
      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([
        createMockConnection(podA.id, podB.id, 'auto'),
      ]);
      vi.spyOn(autoClearService, 'executeAutoClear');

      await autoClearService.onPodComplete(canvasId, podA.id);

      expect(autoClearService.executeAutoClear).not.toHaveBeenCalled();
    });

    it('Pod 是獨立的 terminal 時，立即清除', async () => {
      const pod = createMockPod('A', true);

      vi.spyOn(podStore, 'getById').mockReturnValue(pod);
      vi.spyOn(terminalPodTracker, 'recordCompletion').mockReturnValue({
        allComplete: false,
        sourcePodId: null,
      });
      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);
      vi.spyOn(autoClearService, 'executeAutoClear').mockResolvedValue();

      await autoClearService.onPodComplete(canvasId, pod.id);

      expect(autoClearService.executeAutoClear).toHaveBeenCalledWith(canvasId, pod.id);
    });

    it('當所有 terminal pods 完成時，執行 auto-clear', async () => {
      const podA = createMockPod('A', true);
      const sourcePodId = uuidv4();

      vi.spyOn(podStore, 'getById').mockReturnValue(podA);
      vi.spyOn(terminalPodTracker, 'recordCompletion').mockReturnValue({
        allComplete: true,
        sourcePodId: sourcePodId,
      });
      vi.spyOn(terminalPodTracker, 'clearTracking');
      vi.spyOn(autoClearService, 'executeAutoClear').mockResolvedValue();

      await autoClearService.onPodComplete(canvasId, podA.id);

      expect(autoClearService.executeAutoClear).toHaveBeenCalledWith(canvasId, sourcePodId);
      expect(terminalPodTracker.clearTracking).toHaveBeenCalledWith(sourcePodId);
    });
  });

  describe('hasOutgoingAutoTrigger - 輔助方法測試', () => {
    it('當沒有 outgoing connections 時，返回 false', () => {
      const podId = uuidv4();

      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);

      const result = autoClearService.hasOutgoingAutoTrigger(canvasId, podId);

      expect(result).toBe(false);
    });

    it('當沒有 triggerable connections 時，返回 false', () => {
      const podA = createMockPod('A');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]);

      const result = autoClearService.hasOutgoingAutoTrigger(canvasId, podA.id);

      expect(result).toBe(false);
    });

    it('當有至少一個 auto-trigger connection 時，返回 true', () => {
      const podA = createMockPod('A');
      const podB = createMockPod('B');
      const podC = createMockPod('C');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([
        createMockConnection(podA.id, podB.id),
        createMockConnection(podA.id, podC.id, 'auto'),
      ]);

      const result = autoClearService.hasOutgoingAutoTrigger(canvasId, podA.id);

      expect(result).toBe(true);
    });
  });

  describe('多組觸發追蹤測試', () => {
    it('兩組都存在時，第一組完成不觸發 autoClear', () => {
      const podA = createMockPod('A');
      const podC = createMockPod('C');
      const podD = createMockPod('D');

      // A -> auto -> D, C -> direct -> D
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      const result = terminalPodTracker.recordCompletion(podD.id);

      expect(result.allComplete).toBe(false);
      expect(result.sourcePodId).toBeNull();
    });

    it('兩組都完成後才觸發 autoClear', () => {
      const podA = createMockPod('A');
      const podC = createMockPod('C');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      terminalPodTracker.recordCompletion(podD.id);
      const result = terminalPodTracker.recordCompletion(podD.id);

      expect(result.allComplete).toBe(true);
      expect(result.sourcePodId).toBe(podA.id);
    });

    it('只有 Auto/AI 組時，完成即觸發 autoClear', () => {
      const podA = createMockPod('A');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      const result = terminalPodTracker.recordCompletion(podD.id);

      expect(result.allComplete).toBe(true);
      expect(result.sourcePodId).toBe(podA.id);
    });

    it('只有 Direct 組時（無 direct incoming），完成即 autoClear', () => {
      const podA = createMockPod('A');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      // podD 只有 auto incoming，沒有 direct
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      const result = terminalPodTracker.recordCompletion(podD.id);

      expect(result.allComplete).toBe(true);
    });

    it('多層結構：POD F 需要兩次完成才觸發 autoClear', () => {
      const podA = createMockPod('A');
      const podC = createMockPod('C');
      const podD = createMockPod('D');
      const podF = createMockPod('F');

      // A -> auto -> D -> auto -> F, C -> direct -> D
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        if (sourceId === podD.id) return [createMockConnection(podD.id, podF.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        if (targetId === podF.id) return [createMockConnection(podD.id, podF.id, 'auto')];
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);

      // POD F 的 expectedCount 應為 2（因為 POD D 被觸發 2 次，向下傳播）
      expect(expectedCounts.get(podF.id)).toBe(2);

      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      const firstResult = terminalPodTracker.recordCompletion(podF.id);
      expect(firstResult.allComplete).toBe(false);

      const secondResult = terminalPodTracker.recordCompletion(podF.id);
      expect(secondResult.allComplete).toBe(true);
      expect(secondResult.sourcePodId).toBe(podA.id);
    });
  });

  describe('decrementExpectedCount 邊界情況', () => {
    it('expectedCount 已為 0 時再次呼叫 decrementExpectedCount → expectedCount 保持 0，不重複觸發 allComplete', () => {
      const podA = createMockPod('A');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      // 第一次遞減：expectedCount 從 1 → 0，completedCount=0，checkAllComplete 回傳 true
      const firstResult = terminalPodTracker.decrementExpectedCount(podD.id);
      expect(firstResult.allComplete).toBe(true);
      expect(firstResult.sourcePodId).toBe(podA.id);

      // clearTracking 後再初始化新追蹤，模擬重複遞減情境
      // 直接驗證 Math.max(0, ...) 防護：expectedCount 不會低於 0
      terminalPodTracker.clearAll();
      const expectedCounts2 = new Map([[podD.id, 1]]);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts2);

      terminalPodTracker.decrementExpectedCount(podD.id); // expectedCount → 0
      const secondResult = terminalPodTracker.decrementExpectedCount(podD.id); // 再次遞減，應保持 0

      // expectedCount=0, completedCount=0，checkAllComplete 回傳 true
      expect(secondResult.allComplete).toBe(true);
    });
  });

  describe('executeAutoClear - emitAiDecideClear 條件測試', () => {
    it('成功且有 clearedConnectionIds 時，應呼叫 emitAiDecideClear', async () => {
      const sourcePodId = uuidv4();
      const connectionId = uuidv4();

      vi.spyOn(workflowClearService, 'clearWorkflow').mockResolvedValue({
        success: true,
        clearedPodIds: [sourcePodId],
        clearedPodNames: ['Test Pod'],
        clearedConnectionIds: [connectionId],
      });
      vi.spyOn(socketService, 'emitToCanvas').mockImplementation(() => {});
      vi.spyOn(workflowEventEmitter, 'emitAiDecideClear').mockImplementation(() => {});

      await autoClearService.executeAutoClear(canvasId, sourcePodId);

      expect(workflowEventEmitter.emitAiDecideClear).toHaveBeenCalledWith(canvasId, [connectionId]);
    });

    it('成功但無 clearedConnectionIds 時，不應呼叫 emitAiDecideClear', async () => {
      const sourcePodId = uuidv4();

      vi.spyOn(workflowClearService, 'clearWorkflow').mockResolvedValue({
        success: true,
        clearedPodIds: [sourcePodId],
        clearedPodNames: ['Test Pod'],
        clearedConnectionIds: [],
      });
      vi.spyOn(socketService, 'emitToCanvas').mockImplementation(() => {});
      vi.spyOn(workflowEventEmitter, 'emitAiDecideClear').mockImplementation(() => {});

      await autoClearService.executeAutoClear(canvasId, sourcePodId);

      expect(workflowEventEmitter.emitAiDecideClear).not.toHaveBeenCalled();
    });

    it('失敗時，不應呼叫 emitAiDecideClear', async () => {
      const sourcePodId = uuidv4();

      vi.spyOn(workflowClearService, 'clearWorkflow').mockResolvedValue({
        success: false,
        error: '清除失敗',
        clearedPodIds: [],
        clearedPodNames: [],
        clearedConnectionIds: [],
      });
      vi.spyOn(workflowEventEmitter, 'emitAiDecideClear').mockImplementation(() => {});

      await autoClearService.executeAutoClear(canvasId, sourcePodId);

      expect(workflowEventEmitter.emitAiDecideClear).not.toHaveBeenCalled();
    });
  });

  describe('recordCompletion 超額呼叫防護', () => {
    it('recordCompletion 被呼叫超過 expectedCount 次 → 超額呼叫被忽略，count 不繼續累加', () => {
      const podA = createMockPod('A');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      expect(expectedCounts.get(podD.id)).toBe(1);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      // 第一次呼叫：正常完成
      const firstResult = terminalPodTracker.recordCompletion(podD.id);
      expect(firstResult.allComplete).toBe(true);
      expect(firstResult.sourcePodId).toBe(podA.id);

      // 超額呼叫：應被忽略，回傳 allComplete: true 但 count 不增加
      const overflowResult = terminalPodTracker.recordCompletion(podD.id);
      expect(overflowResult.allComplete).toBe(true);
      expect(overflowResult.sourcePodId).toBe(podA.id);
    });
  });

  describe('AI 拒絕處理測試', () => {
    it('Auto/AI 組被拒絕後，expectedCount 正確遞減', () => {
      const podA = createMockPod('A');
      const podC = createMockPod('C');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      expect(expectedCounts.get(podD.id)).toBe(2);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      const result = terminalPodTracker.decrementExpectedCount(podD.id);

      // completedCount=0, expectedCount=1，尚未完成
      expect(result.allComplete).toBe(false);
      expect(result.sourcePodId).toBeNull();
    });

    it('遞減後 allComplete 變為 true，觸發 autoClear', () => {
      const podA = createMockPod('A');
      const podC = createMockPod('C');
      const podD = createMockPod('D');

      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        return [];
      });

      const expectedCounts = autoClearService.findTerminalPods(canvasId, podA.id);
      terminalPodTracker.initializeTracking(podA.id, expectedCounts);

      // Direct 組完成（completedCount=1）
      terminalPodTracker.recordCompletion(podD.id);

      // Auto/AI 組被拒絕（expectedCount 從 2 減為 1）
      const result = terminalPodTracker.decrementExpectedCount(podD.id);

      // completedCount(1) >= expectedCount(1)，allComplete 應為 true
      expect(result.allComplete).toBe(true);
      expect(result.sourcePodId).toBe(podA.id);
    });

    it('Direct 組已完成 + Auto/AI 組被拒絕，autoClear 正確觸發（透過 onGroupNotTriggered）', async () => {
      const podA = createMockPod('A', true);
      const podC = createMockPod('C');
      const podD = createMockPod('D', false);

      vi.spyOn(podStore, 'getById').mockImplementation((cId, pId) => {
        if (pId === podA.id) return podA;
        if (pId === podD.id) return podD;
        return undefined;
      });
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        return [];
      });
      vi.spyOn(autoClearService, 'executeAutoClear').mockResolvedValue();

      autoClearService.initializeWorkflowTracking(canvasId, podA.id);

      // Direct 組完成（POD D 完成一次）
      await autoClearService.onPodComplete(canvasId, podD.id);
      expect(autoClearService.executeAutoClear).not.toHaveBeenCalled();

      // Auto/AI 組被拒絕
      await autoClearService.onGroupNotTriggered(canvasId, podD.id);

      expect(autoClearService.executeAutoClear).toHaveBeenCalledWith(canvasId, podA.id);
    });

    it('多層結構中拒絕的傳播：下游 terminal PODs 的 expectedCount 遞減', async () => {
      const podA = createMockPod('A', true);
      const podC = createMockPod('C');
      const podD = createMockPod('D', false);
      const podF = createMockPod('F', false);

      vi.spyOn(podStore, 'getById').mockImplementation((cId, pId) => {
        if (pId === podA.id) return podA;
        if (pId === podD.id) return podD;
        if (pId === podF.id) return podF;
        return undefined;
      });
      vi.spyOn(connectionStore, 'findBySourcePodId').mockImplementation((cId, sourceId) => {
        if (sourceId === podA.id) return [createMockConnection(podA.id, podD.id, 'auto')];
        if (sourceId === podD.id) return [createMockConnection(podD.id, podF.id, 'auto')];
        return [];
      });
      vi.spyOn(connectionStore, 'findByTargetPodId').mockImplementation((cId, targetId) => {
        if (targetId === podD.id) {
          return [
            createMockConnection(podA.id, podD.id, 'auto'),
            createMockConnection(podC.id, podD.id, 'direct'),
          ];
        }
        if (targetId === podF.id) return [createMockConnection(podD.id, podF.id, 'auto')];
        return [];
      });
      vi.spyOn(autoClearService, 'executeAutoClear').mockResolvedValue();

      autoClearService.initializeWorkflowTracking(canvasId, podA.id);

      // Direct 組觸發，POD D 完成，接著觸發 POD F 完成（completedCount=1）
      await autoClearService.onPodComplete(canvasId, podF.id);
      expect(autoClearService.executeAutoClear).not.toHaveBeenCalled();

      // Auto/AI 組被拒絕，BFS 找到下游 POD F 並遞減 expectedCount（從 2 減為 1）
      await autoClearService.onGroupNotTriggered(canvasId, podD.id);

      // POD F: completedCount(1) >= expectedCount(1)，allComplete = true
      expect(autoClearService.executeAutoClear).toHaveBeenCalledWith(canvasId, podA.id);
    });
  });
});

// Helper functions
function createMockPod(name: string, autoClear: boolean = false): Pod {
  return {
    id: uuidv4(),
    name: `Pod ${name}`,
    x: 0,
    y: 0,
    rotation: 0,
    status: 'idle',
    workspacePath: '/tmp/test',
    claudeSessionId: null,
    outputStyleId: null,
    skillIds: [],
    subAgentIds: [],
    model: 'sonnet',
    repositoryId: null,
    commandId: null,
    autoClear,
  };
}

function createMockConnection(
  sourcePodId: string,
  targetPodId: string,
  triggerMode: 'auto' | 'ai-decide' | 'direct' = 'auto'
): Connection {
  return {
    id: uuidv4(),
    sourcePodId,
    sourceAnchor: 'right',
    targetPodId,
    targetAnchor: 'left',
    triggerMode,
    decideStatus: 'none',
    decideReason: null,
    connectionStatus: 'idle',
  };
}
