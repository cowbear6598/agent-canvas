vi.mock("../../src/services/workflow/runQueueService.js", () => ({
  runQueueService: {
    getQueueSize: vi.fn().mockReturnValue(0),
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    processNext: vi.fn().mockResolvedValue(undefined),
    init: vi.fn(),
  },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runStore } from "../../src/services/runStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { socketService } from "../../src/services/socketService.js";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { logger } from "../../src/utils/logger.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import type {
  WorkflowRun,
  RunPodInstance,
} from "../../src/services/runStore.js";
import type { RunContext } from "../../src/types/run.js";

function createMockRun(overrides?: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "pod-source",
    triggerMessage: "測試訊息",
    status: "running",
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function createMockInstance(
  overrides?: Partial<RunPodInstance>,
): RunPodInstance {
  return {
    id: "instance-1",
    runId: "run-1",
    podId: "pod-source",
    status: "pending",
    claudeSessionId: null,
    errorMessage: null,
    triggeredAt: null,
    completedAt: null,
    autoPathwaySettled: "not-applicable",
    directPathwaySettled: "not-applicable",
    ...overrides,
  };
}

function makeRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    runId: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "pod-source",
    ...overrides,
  };
}

describe("RunExecutionService", () => {
  const canvasId = "canvas-1";
  const sourcePodId = "pod-source";
  const targetPodId = "pod-target";

  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createRun", () => {
    it("建立 Run 並為 chain 中所有 pod 建立 instance", async () => {
      const mockRun = createMockRun();
      const sourceInstance = createMockInstance({ podId: sourcePodId });
      const targetInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
      });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
        (cId, podId) => {
          if (podId === sourcePodId) {
            return [
              {
                id: "conn-1",
                sourcePodId,
                targetPodId,
                sourceAnchor: "right",
                targetAnchor: "left",
                triggerMode: "auto",
                decideStatus: "none",
                decideReason: null,
                connectionStatus: "idle",
              },
            ];
          }
          return [];
        },
      );
      vi.spyOn(runStore, "createPodInstance").mockImplementation((_, podId) => {
        if (podId === sourcePodId) return sourceInstance;
        return targetInstance;
      });
      vi.spyOn(podStore, "getById").mockImplementation((cId, podId) => {
        if (podId === sourcePodId)
          return { id: sourcePodId, name: "Source Pod" } as any;
        if (podId === targetPodId)
          return { id: targetPodId, name: "Target Pod" } as any;
        return undefined;
      });
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      const context = await runExecutionService.createRun(
        canvasId,
        sourcePodId,
        "測試",
      );

      expect(context.runId).toBe(mockRun.id);
      expect(context.canvasId).toBe(canvasId);
      expect(context.sourcePodId).toBe(sourcePodId);
      expect(runStore.createPodInstance).toHaveBeenCalledTimes(2);
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CREATED,
        expect.objectContaining({
          canvasId,
          run: expect.objectContaining({
            id: mockRun.id,
            sourcePodName: "Source Pod",
          }),
        }),
      );
    });

    it("emit payload 的 podInstances 中每個 instance 都有正確的 podName", async () => {
      const mockRun = createMockRun();
      const sourceInstance = createMockInstance({ podId: sourcePodId });
      const targetInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
      });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
        (cId, podId) => {
          if (podId === sourcePodId) {
            return [
              {
                id: "conn-1",
                sourcePodId,
                targetPodId,
                sourceAnchor: "right",
                targetAnchor: "left",
                triggerMode: "auto",
                decideStatus: "none",
                decideReason: null,
                connectionStatus: "idle",
              },
            ];
          }
          return [];
        },
      );
      vi.spyOn(runStore, "createPodInstance").mockImplementation((_, podId) => {
        if (podId === sourcePodId) return sourceInstance;
        return targetInstance;
      });
      vi.spyOn(podStore, "getById").mockImplementation((cId, podId) => {
        if (podId === sourcePodId)
          return { id: sourcePodId, name: "Source Pod" } as any;
        if (podId === targetPodId)
          return { id: targetPodId, name: "Target Pod" } as any;
        return undefined;
      });
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      await runExecutionService.createRun(canvasId, sourcePodId, "測試");

      const emitCall = vi.mocked(socketService.emitToCanvas).mock.calls[0];
      const payload = emitCall?.[2] as any;
      const instances = payload?.run?.podInstances as Array<{
        podId: string;
        podName: string;
      }>;

      const sourceResult = instances?.find((i) => i.podId === sourcePodId);
      const targetResult = instances?.find((i) => i.podId === targetPodId);

      expect(sourceResult?.podName).toBe("Source Pod");
      expect(targetResult?.podName).toBe("Target Pod");
    });

    it("pod 找不到時 podName fallback 為 podId", async () => {
      const unknownPodId = "pod-unknown";
      const mockRun = createMockRun();
      const unknownInstance = createMockInstance({ podId: unknownPodId });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(runStore, "createPodInstance").mockReturnValue(unknownInstance);
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      await runExecutionService.createRun(canvasId, unknownPodId, "測試");

      const emitCall = vi.mocked(socketService.emitToCanvas).mock.calls[0];
      const payload = emitCall?.[2] as any;
      const instances = payload?.run?.podInstances as Array<{
        podId: string;
        podName: string;
      }>;

      expect(instances?.[0]?.podName).toBe(unknownPodId);
    });

    it("source pod 找不到時 sourcePodName fallback 為 podId", async () => {
      const mockRun = createMockRun();
      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(runStore, "createPodInstance").mockReturnValue(
        createMockInstance(),
      );
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      await runExecutionService.createRun(canvasId, sourcePodId, "測試");

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CREATED,
        expect.objectContaining({
          run: expect.objectContaining({ sourcePodName: sourcePodId }),
        }),
      );
    });

    it("run 數量超過上限時觸發 enforceRunLimit 刪除最舊的 run", async () => {
      const mockRun = createMockRun();
      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(runStore, "createPodInstance").mockReturnValue(
        createMockInstance(),
      );
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(31);
      vi.spyOn(runStore, "getOldestCompletedRunIds").mockReturnValue([
        "old-run-1",
      ]);
      const deleteSpy = vi
        .spyOn(runStore, "deleteRun")
        .mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: "old-run-1" }),
      );

      await runExecutionService.createRun(canvasId, sourcePodId, "測試");

      expect(deleteSpy).toHaveBeenCalledWith("old-run-1");
    });
  });

  describe("startPodInstance", () => {
    it("更新 status 為 running 並發送事件", () => {
      const instance = createMockInstance({ status: "pending" });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      runExecutionService.startPodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        instance.id,
        "running",
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: sourcePodId, status: "running" }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      expect(() =>
        runExecutionService.startPodInstance(makeRunContext(), sourcePodId),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
      expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
    });
  });

  describe("settlePodTrigger", () => {
    it("settle auto pathway 後狀態非 pending → 更新 status 為 completed 並評估 run 狀態", () => {
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
      });
      const completedInstance = createMockInstance({
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        completedInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.settleAutoPathway).toHaveBeenCalledWith(instance.id);
      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        settledInstance.id,
        "completed",
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ status: "completed" }),
      );
      expect(runStore.updateRunStatus).toHaveBeenCalledWith(
        "run-1",
        "completed",
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
        expect.objectContaining({ status: "completed" }),
      );
    });

    it("使用 direct pathway 時呼叫 settleDirectPathway 而非 settleAutoPathway", () => {
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "not-applicable",
        directPathwaySettled: "pending",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "not-applicable",
        directPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        createMockInstance({
          status: "completed",
          autoPathwaySettled: "not-applicable",
          directPathwaySettled: "settled",
        }),
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "direct",
      );

      expect(runStore.settleDirectPathway).toHaveBeenCalledWith(instance.id);
      expect(runStore.settleAutoPathway).not.toHaveBeenCalled();
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      expect(() =>
        runExecutionService.settlePodTrigger(
          makeRunContext(),
          sourcePodId,
          "auto",
        ),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("佇列有項目時即使 pathways 全 settled，不標記 completed", async () => {
      const { runQueueService } =
        await import("../../src/services/workflow/runQueueService.js");
      (runQueueService.getQueueSize as any).mockReturnValue(1);

      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalledWith(
        expect.anything(),
        "completed",
      );
    });

    it("佇列為空時且 pathways 全 settled，標記為 completed", async () => {
      const { runQueueService } =
        await import("../../src/services/workflow/runQueueService.js");
      (runQueueService.getQueueSize as any).mockReturnValue(0);

      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      });
      const completedInstance = createMockInstance({
        status: "completed",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        completedInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        settledInstance.id,
        "completed",
      );
    });

    it("部分 pathway settle 時不改變 instance status（由 processNext 透過 activeStream 判斷）", () => {
      // auto=pending, direct=pending，settle direct 後 auto 仍為 pending → 尚未全 settled
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
        directPathwaySettled: "pending",
      });
      const afterSettle = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
        directPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance) // settlePathwayAndRefresh 第 1 次：settle 前
        .mockReturnValueOnce(afterSettle); // settlePathwayAndRefresh 第 2 次：settle 後
      vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "direct",
      );

      // 不應改變 status — processNext 改用 hasActiveStream 判斷是否能 dequeue
      expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
      // directPathwaySettled 應已 settled，autoPathwaySettled 仍為 pending
      expect(afterSettle.directPathwaySettled).toBe("settled");
      expect(afterSettle.autoPathwaySettled).toBe("pending");
    });

    it("全部 pathway settle 時正常標記 completed", () => {
      // auto=settled, direct=pending，settle direct 後全部 settled
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
        directPathwaySettled: "pending",
      });
      const afterSettle = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      });
      const completedInstance = createMockInstance({
        status: "completed",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(afterSettle)
        .mockReturnValueOnce(afterSettle);
      vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        completedInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "direct",
      );

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        afterSettle.id,
        "completed",
      );
    });

    it("部分 pathway settle 但 instance status 非 running 時不回退", () => {
      // status=error，settle direct 後 auto 仍為 pending → 尚未全 settled，但不回退非 running 狀態
      const instance = createMockInstance({
        status: "error",
        autoPathwaySettled: "pending",
        directPathwaySettled: "pending",
      });
      const afterSettle = createMockInstance({
        status: "error",
        autoPathwaySettled: "pending",
        directPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(afterSettle);
      vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "direct",
      );

      // error 狀態不應被回退為 pending
      expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalledWith(
        expect.anything(),
        "pending",
      );
      expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
    });
  });

  describe("settleAndSkipPath", () => {
    it("尚有未 settled 的 pathway 時不更新 status", () => {
      const instance = createMockInstance({
        status: "pending",
        autoPathwaySettled: "pending",
        directPathwaySettled: "pending",
      });
      const afterSettle = createMockInstance({
        status: "pending",
        autoPathwaySettled: "settled",
        directPathwaySettled: "pending",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(afterSettle);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      runExecutionService.settleAndSkipPath(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.settleAutoPathway).toHaveBeenCalledWith(instance.id);
      expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
    });

    it("所有 pathway settled 且 status 為 pending（NEVER_TRIGGERED_STATUSES）→ skipped", () => {
      const instance = createMockInstance({
        status: "pending",
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      });
      const afterSettle = createMockInstance({
        status: "pending",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(afterSettle)
        .mockReturnValueOnce(afterSettle);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        createMockInstance({
          status: "skipped",
          autoPathwaySettled: "settled",
        }),
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settleAndSkipPath(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        afterSettle.id,
        "skipped",
      );
    });

    it("所有 pathway settled 且 status 為 deciding（NEVER_TRIGGERED_STATUSES）→ skipped", () => {
      const instance = createMockInstance({
        status: "deciding",
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      });
      const afterSettle = createMockInstance({
        status: "deciding",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(afterSettle)
        .mockReturnValueOnce(afterSettle);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        createMockInstance({
          status: "skipped",
          autoPathwaySettled: "settled",
        }),
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settleAndSkipPath(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        afterSettle.id,
        "skipped",
      );
    });

    it("所有 pathway settled 且 status 不在 NEVER_TRIGGERED_STATUSES → completed", () => {
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      });
      const afterSettle = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(afterSettle)
        .mockReturnValueOnce(afterSettle);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        createMockInstance({
          status: "completed",
          autoPathwaySettled: "settled",
        }),
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settleAndSkipPath(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        afterSettle.id,
        "completed",
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      expect(() =>
        runExecutionService.settleAndSkipPath(
          makeRunContext(),
          sourcePodId,
          "auto",
        ),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("errorPodInstance", () => {
    it("更新 status 為 error 並帶入 errorMessage", () => {
      const instance = createMockInstance({ status: "running" });
      const errorInstance = createMockInstance({
        status: "error",
        errorMessage: "執行失敗",
        completedAt: new Date().toISOString(),
      });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        errorInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "error",
          completedAt: new Date().toISOString(),
        }),
      );

      runExecutionService.errorPodInstance(
        makeRunContext(),
        sourcePodId,
        "執行失敗",
      );

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        instance.id,
        "error",
        "執行失敗",
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ status: "error", errorMessage: "執行失敗" }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      expect(() =>
        runExecutionService.errorPodInstance(
          makeRunContext(),
          sourcePodId,
          "err",
        ),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("queuedPodInstance", () => {
    it("更新 status 為 queued 並發送 WebSocket 事件", () => {
      const instance = createMockInstance({ status: "pending" });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      runExecutionService.queuedPodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        instance.id,
        "queued",
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: sourcePodId, status: "queued" }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      expect(() =>
        runExecutionService.queuedPodInstance(makeRunContext(), sourcePodId),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("waitingPodInstance", () => {
    it("更新 status 為 waiting 並發送 WebSocket 事件", () => {
      const instance = createMockInstance({ status: "pending" });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );

      runExecutionService.waitingPodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        instance.id,
        "waiting",
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: sourcePodId, status: "waiting" }),
      );
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      expect(() =>
        runExecutionService.waitingPodInstance(makeRunContext(), sourcePodId),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("summarizingPodInstance", () => {
    it("更新 status 為 summarizing 並發送事件，不評估 run 狀態", () => {
      const instance = createMockInstance({ status: "running" });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([]);

      runExecutionService.summarizingPodInstance(makeRunContext(), sourcePodId);

      expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
        instance.id,
        "summarizing",
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
        expect.objectContaining({ podId: sourcePodId, status: "summarizing" }),
      );
      expect(runStore.getPodInstancesByRunId).not.toHaveBeenCalled();
    });

    it("找不到 instance 時 log warning 不拋錯", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      expect(() =>
        runExecutionService.summarizingPodInstance(
          makeRunContext(),
          sourcePodId,
        ),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("evaluateRunStatus（透過 settlePodTrigger 觸發）", () => {
    it("有 error 且無進行中的 instance → run 狀態變為 error", () => {
      const errorInstance = createMockInstance({
        status: "error",
        errorMessage: "失敗",
      });
      const skippedInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
        status: "skipped",
      });
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        errorInstance,
        skippedInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "error",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updateRunStatus).toHaveBeenCalledWith("run-1", "error");
    });

    it("有 pending instance 時不更新 run 狀態", () => {
      const runningInstance = createMockInstance({ status: "running" });
      const pendingInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
        status: "pending",
      });
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        runningInstance,
        pendingInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updateRunStatus).not.toHaveBeenCalled();
    });

    it("全部 instance 為 completed → run 狀態變為 completed", () => {
      const completedInstance1 = createMockInstance({ status: "completed" });
      const completedInstance2 = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
        status: "completed",
      });
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        completedInstance1,
        completedInstance2,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updateRunStatus).toHaveBeenCalledWith(
        "run-1",
        "completed",
      );
    });

    it("全部 instance 為 completed/skipped 混合 → run 狀態變為 completed", () => {
      const completedInstance = createMockInstance({ status: "completed" });
      const skippedInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
        status: "skipped",
      });
      const instance = createMockInstance({
        status: "running",
        autoPathwaySettled: "pending",
      });
      const settledInstance = createMockInstance({
        status: "running",
        autoPathwaySettled: "settled",
      });
      vi.spyOn(runStore, "getPodInstance")
        .mockReturnValueOnce(instance)
        .mockReturnValueOnce(settledInstance)
        .mockReturnValueOnce(settledInstance);
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        completedInstance,
        skippedInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.settlePodTrigger(
        makeRunContext(),
        sourcePodId,
        "auto",
      );

      expect(runStore.updateRunStatus).toHaveBeenCalledWith(
        "run-1",
        "completed",
      );
    });

    it("有 queued instance 時不更新 run 狀態", () => {
      const errorInstance = createMockInstance({
        status: "error",
        errorMessage: "失敗",
      });
      const queuedInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
        status: "queued",
      });
      const instance = createMockInstance({ status: "running" });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        errorInstance,
        queuedInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.errorPodInstance(
        makeRunContext(),
        sourcePodId,
        "失敗",
      );

      expect(runStore.updateRunStatus).not.toHaveBeenCalled();
    });

    it("有 waiting instance 時不更新 run 狀態", () => {
      const errorInstance = createMockInstance({
        status: "error",
        errorMessage: "失敗",
      });
      const waitingInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
        status: "waiting",
      });
      const instance = createMockInstance({ status: "running" });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        errorInstance,
        waitingInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.errorPodInstance(
        makeRunContext(),
        sourcePodId,
        "失敗",
      );

      expect(runStore.updateRunStatus).not.toHaveBeenCalled();
    });

    it("errorPodInstance 後有 error 且無進行中 → run 最終狀態更新為 error 並發送 RUN_STATUS_CHANGED", () => {
      const errorInstance = createMockInstance({
        status: "error",
        errorMessage: "執行錯誤",
      });
      const completedInstance = createMockInstance({
        id: "instance-2",
        podId: targetPodId,
        status: "completed",
      });
      const instance = createMockInstance({ status: "running" });
      vi.spyOn(runStore, "getPodInstance").mockReturnValueOnce(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        errorInstance,
        completedInstance,
      ]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({
          status: "error",
          completedAt: new Date().toISOString(),
        }),
      );
      vi.spyOn(connectionStore, "list").mockReturnValue([]);

      runExecutionService.errorPodInstance(
        makeRunContext(),
        sourcePodId,
        "執行錯誤",
      );

      expect(runStore.updateRunStatus).toHaveBeenCalledWith("run-1", "error");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
        expect.objectContaining({ status: "error" }),
      );
    });
  });

  describe("registerActiveStream / unregisterActiveStream", () => {
    it("register 後 unregister 正確清理 Map", () => {
      runExecutionService.registerActiveStream("run-x", "pod-1");
      runExecutionService.registerActiveStream("run-x", "pod-2");
      runExecutionService.unregisterActiveStream("run-x", "pod-1");
      runExecutionService.unregisterActiveStream("run-x", "pod-2");

      // deleteRun 呼叫時不應 abort 任何 pod（Map 已清空）
      vi.spyOn(claudeService, "abortQuery").mockReturnValue(false);
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: "run-x" }),
      );
      vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});

      runExecutionService.deleteRun("run-x");

      expect(claudeService.abortQuery).not.toHaveBeenCalled();
    });

    it("Set 為空時從 Map 移除 runId", () => {
      runExecutionService.registerActiveStream("run-y", "pod-1");
      runExecutionService.unregisterActiveStream("run-y", "pod-1");

      vi.spyOn(claudeService, "abortQuery").mockReturnValue(false);
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: "run-y" }),
      );
      vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});

      runExecutionService.deleteRun("run-y");

      expect(claudeService.abortQuery).not.toHaveBeenCalled();
    });
  });

  describe("deleteRun", () => {
    it("中斷活躍串流中的 pod 並刪除 run 發送事件", async () => {
      runExecutionService.registerActiveStream("run-del", "pod-active");
      vi.spyOn(claudeService, "abortQuery").mockReturnValue(true);
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: "run-del", canvasId }),
      );
      vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});
      vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);

      await runExecutionService.deleteRun("run-del");

      expect(claudeService.abortQuery).toHaveBeenCalledWith(
        "run-del:pod-active",
      );
      expect(runStore.deleteRun).toHaveBeenCalledWith("run-del");
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_DELETED,
        { runId: "run-del", canvasId },
      );
    });

    it("run 不存在時不發送 RUN_DELETED 事件", async () => {
      vi.spyOn(runStore, "getRun").mockReturnValue(undefined);
      vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});
      vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);

      await runExecutionService.deleteRun("run-ghost");

      expect(runStore.deleteRun).toHaveBeenCalledWith("run-ghost");
      expect(socketService.emitToCanvas).not.toHaveBeenCalled();
    });

    it("無活躍串流時不呼叫 abortQuery", async () => {
      vi.spyOn(claudeService, "abortQuery").mockReturnValue(false);
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: "run-no-stream", canvasId }),
      );
      vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});
      vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([]);

      await runExecutionService.deleteRun("run-no-stream");

      expect(claudeService.abortQuery).not.toHaveBeenCalled();
    });
  });
});
