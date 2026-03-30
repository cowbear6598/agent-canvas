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
import { socketService } from "../../src/services/socketService.js";
import { logger } from "../../src/utils/logger.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import type { RunPodInstance } from "../../src/services/runStore.js";
import type { Connection } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";

const RUN_ID = "run-1";
const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "pod-source";

function makeRunContext(): RunContext {
  return { runId: RUN_ID, canvasId: CANVAS_ID, sourcePodId: SOURCE_POD_ID };
}

function makeInstance(overrides?: Partial<RunPodInstance>): RunPodInstance {
  return {
    id: "instance-1",
    runId: RUN_ID,
    podId: "pod-a",
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

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-1",
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: "pod-a",
    targetAnchor: "left",
    triggerMode: "auto",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    ...overrides,
  };
}

describe("calculatePathways（透過 createRun 測試）", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    vi.spyOn(runStore, "createRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "測試",
      status: "running",
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);
    vi.spyOn(runStore, "getOldestCompletedRunIds").mockReturnValue([]);
    vi.spyOn({ getById: vi.fn() }, "getById").mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("源頭 pod → auto_pathway_settled=false, direct_pathway_settled=null", async () => {
    vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
    vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);
    const createPodInstanceSpy = vi
      .spyOn(runStore, "createPodInstance")
      .mockReturnValue(makeInstance());
    const { podStore } = await import("../../src/services/podStore.js");
    vi.spyOn(podStore, "getById").mockReturnValue(undefined);

    await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

    expect(createPodInstanceSpy).toHaveBeenCalledWith(
      RUN_ID,
      SOURCE_POD_ID,
      "pending",
      "not-applicable",
      null,
    );
  });

  it("只有 auto connections → auto=false, direct=null", async () => {
    const targetPod = "pod-target";
    vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
      (_, podId) =>
        podId === SOURCE_POD_ID
          ? [
              makeConnection({
                id: "c1",
                sourcePodId: SOURCE_POD_ID,
                targetPodId: targetPod,
                triggerMode: "auto",
              }),
            ]
          : [],
    );
    vi.spyOn(connectionStore, "findByTargetPodId").mockImplementation(
      (_, podId) =>
        podId === targetPod
          ? [
              makeConnection({
                id: "c1",
                sourcePodId: SOURCE_POD_ID,
                targetPodId: targetPod,
                triggerMode: "auto",
              }),
            ]
          : [],
    );
    const createPodInstanceSpy = vi
      .spyOn(runStore, "createPodInstance")
      .mockReturnValue(makeInstance());
    const { podStore } = await import("../../src/services/podStore.js");
    vi.spyOn(podStore, "getById").mockReturnValue(undefined);

    await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

    expect(createPodInstanceSpy).toHaveBeenCalledWith(
      RUN_ID,
      targetPod,
      "pending",
      "not-applicable",
      null,
    );
  });

  it("只有 ai-decide connections → auto=pending, direct=not-applicable", async () => {
    const targetPod = "pod-target";
    vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
      (_, podId) =>
        podId === SOURCE_POD_ID
          ? [
              makeConnection({
                id: "c1",
                sourcePodId: SOURCE_POD_ID,
                targetPodId: targetPod,
                triggerMode: "ai-decide",
              }),
            ]
          : [],
    );
    vi.spyOn(connectionStore, "findByTargetPodId").mockImplementation(
      (_, podId) =>
        podId === targetPod
          ? [
              makeConnection({
                id: "c1",
                sourcePodId: SOURCE_POD_ID,
                targetPodId: targetPod,
                triggerMode: "ai-decide",
              }),
            ]
          : [],
    );
    const createPodInstanceSpy = vi
      .spyOn(runStore, "createPodInstance")
      .mockReturnValue(makeInstance());
    const { podStore } = await import("../../src/services/podStore.js");
    vi.spyOn(podStore, "getById").mockReturnValue(undefined);

    await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

    expect(createPodInstanceSpy).toHaveBeenCalledWith(
      RUN_ID,
      targetPod,
      "pending",
      "not-applicable",
      null,
    );
  });

  it("只有 direct connections → auto=not-applicable, direct=pending", async () => {
    const targetPod = "pod-target";
    vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
      (_, podId) =>
        podId === SOURCE_POD_ID
          ? [
              makeConnection({
                id: "c1",
                sourcePodId: SOURCE_POD_ID,
                targetPodId: targetPod,
                triggerMode: "direct",
              }),
            ]
          : [],
    );
    vi.spyOn(connectionStore, "findByTargetPodId").mockImplementation(
      (_, podId) =>
        podId === targetPod
          ? [
              makeConnection({
                id: "c1",
                sourcePodId: SOURCE_POD_ID,
                targetPodId: targetPod,
                triggerMode: "direct",
              }),
            ]
          : [],
    );
    const createPodInstanceSpy = vi
      .spyOn(runStore, "createPodInstance")
      .mockReturnValue(makeInstance());
    const { podStore } = await import("../../src/services/podStore.js");
    vi.spyOn(podStore, "getById").mockReturnValue(undefined);

    await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

    expect(createPodInstanceSpy).toHaveBeenCalledWith(
      RUN_ID,
      targetPod,
      "not-applicable",
      "pending",
      null,
    );
  });

  it("auto + direct connections（同一 source）→ auto=pending, direct=pending", async () => {
    const targetPod = "pod-target";
    // SOURCE_POD_ID 同時有 auto 和 direct 兩條到 targetPod 的 connections
    const conns = [
      makeConnection({
        id: "c1",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: targetPod,
        triggerMode: "auto",
      }),
      makeConnection({
        id: "c2",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: targetPod,
        triggerMode: "direct",
      }),
    ];
    vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
      (_, podId) => (podId === SOURCE_POD_ID ? conns : []),
    );
    vi.spyOn(connectionStore, "findByTargetPodId").mockImplementation(
      (_, podId) => (podId === targetPod ? conns : []),
    );
    const createPodInstanceSpy = vi
      .spyOn(runStore, "createPodInstance")
      .mockReturnValue(makeInstance());
    const { podStore } = await import("../../src/services/podStore.js");
    vi.spyOn(podStore, "getById").mockReturnValue(undefined);

    await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

    expect(createPodInstanceSpy).toHaveBeenCalledWith(
      RUN_ID,
      targetPod,
      "pending",
      "pending",
      null,
    );
  });

  it("不在 chain 內的 connection 不計算", async () => {
    const targetPod = "pod-target";
    // pod-other 不在 chain 中（SOURCE_POD_ID 沒有到 pod-other 的 connection）
    const conns = [
      makeConnection({
        id: "c1",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: targetPod,
        triggerMode: "auto",
      }),
      makeConnection({
        id: "c2",
        sourcePodId: "pod-not-in-chain",
        targetPodId: targetPod,
        triggerMode: "direct",
      }),
    ];
    vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
      (_, podId) => (podId === SOURCE_POD_ID ? [conns[0]] : []),
    );
    vi.spyOn(connectionStore, "findByTargetPodId").mockImplementation(
      (_, podId) => (podId === targetPod ? conns : []),
    );
    const createPodInstanceSpy = vi
      .spyOn(runStore, "createPodInstance")
      .mockReturnValue(makeInstance());
    const { podStore } = await import("../../src/services/podStore.js");
    vi.spyOn(podStore, "getById").mockReturnValue(undefined);

    await runExecutionService.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");

    // pod-not-in-chain 不在 chainPodIds 中，所以 direct 不被計算
    expect(createPodInstanceSpy).toHaveBeenCalledWith(
      RUN_ID,
      targetPod,
      "pending",
      "not-applicable",
      null,
    );
  });
});

describe("settlePodTrigger", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("只有 auto pathway、settle auto → completed", () => {
    const instance = makeInstance({
      status: "running",
      autoPathwaySettled: "pending",
    });
    const settledInstance = makeInstance({
      status: "running",
      autoPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(settledInstance)
      .mockReturnValueOnce(settledInstance);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({ status: "completed", autoPathwaySettled: "settled" }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-a", "auto");

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith(instance.id);
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      settledInstance.id,
      "completed",
    );
  });

  it("只有 direct pathway、settle direct → completed", () => {
    const instance = makeInstance({
      status: "running",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "pending",
    });
    const settledInstance = makeInstance({
      status: "running",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(settledInstance)
      .mockReturnValueOnce(settledInstance);
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        status: "completed",
        autoPathwaySettled: "not-applicable",
        directPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-a", "direct");

    expect(runStore.settleDirectPathway).toHaveBeenCalledWith(instance.id);
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      settledInstance.id,
      "completed",
    );
  });

  it("auto + direct pathway：settle auto 但 direct 未結算 → 不 completed", () => {
    const instance = makeInstance({
      status: "running",
      autoPathwaySettled: "pending",
      directPathwaySettled: "pending",
    });
    const afterSettleAuto = makeInstance({
      status: "running",
      autoPathwaySettled: "settled",
      directPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(afterSettleAuto);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-a", "auto");

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith(instance.id);
    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
  });

  it("auto + direct pathway：auto 已結算，再 settle direct → completed", () => {
    const instance = makeInstance({
      status: "running",
      autoPathwaySettled: "settled",
      directPathwaySettled: "pending",
    });
    const settledInstance = makeInstance({
      status: "running",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(settledInstance)
      .mockReturnValueOnce(settledInstance);
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        status: "completed",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-a", "direct");

    expect(runStore.settleDirectPathway).toHaveBeenCalledWith(instance.id);
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      settledInstance.id,
      "completed",
    );
  });

  it("status 為 pending 且 all pathways settled 時不應更新為 completed", () => {
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "pending",
      directPathwaySettled: "not-applicable",
    });
    const settledInstance = makeInstance({
      status: "pending",
      autoPathwaySettled: "settled",
      directPathwaySettled: "not-applicable",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(settledInstance);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-a", "auto");

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith(instance.id);
    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
  });
});

describe("settleAndSkipPath", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("settle auto，還有 direct 未結算 → 不動作", () => {
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "pending",
      directPathwaySettled: "pending",
    });
    // 第二次查詢 auto 已 settle，direct 還是 pending
    const afterSettle = makeInstance({
      status: "pending",
      autoPathwaySettled: "settled",
      directPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(afterSettle);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith(instance.id);
    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalled();
  });

  it("settle auto，direct 也已結算，status=pending → skipped", () => {
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "pending",
      directPathwaySettled: "settled",
    });
    const afterSettle = makeInstance({
      status: "pending",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(afterSettle)
      .mockReturnValueOnce(afterSettle);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        status: "skipped",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      afterSettle.id,
      "skipped",
    );
  });

  it("settle auto，direct 也已結算，status=queued → skipped（排隊中視為未觸發）", () => {
    const instance = makeInstance({
      status: "queued",
      autoPathwaySettled: "pending",
      directPathwaySettled: "settled",
    });
    const afterSettle = makeInstance({
      status: "queued",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(afterSettle)
      .mockReturnValueOnce(afterSettle);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        status: "skipped",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      afterSettle.id,
      "skipped",
    );
  });

  it("settle auto，direct 也已結算，status=waiting → skipped（等待中視為未觸發）", () => {
    const instance = makeInstance({
      status: "waiting",
      autoPathwaySettled: "pending",
      directPathwaySettled: "settled",
    });
    const afterSettle = makeInstance({
      status: "waiting",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(afterSettle)
      .mockReturnValueOnce(afterSettle);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        status: "skipped",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      afterSettle.id,
      "skipped",
    );
  });

  it("settle auto，direct 也已結算，status=deciding → skipped（AI 判斷中視為未觸發）", () => {
    const instance = makeInstance({
      status: "deciding",
      autoPathwaySettled: "pending",
      directPathwaySettled: "settled",
    });
    const afterSettle = makeInstance({
      status: "deciding",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(afterSettle)
      .mockReturnValueOnce(afterSettle);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        status: "skipped",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      afterSettle.id,
      "skipped",
    );
  });

  it("settle auto，direct 也已結算，status=running → completed", () => {
    const instance = makeInstance({
      status: "running",
      autoPathwaySettled: "pending",
      directPathwaySettled: "settled",
    });
    const afterSettle = makeInstance({
      status: "running",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instance)
      .mockReturnValueOnce(afterSettle)
      .mockReturnValueOnce(afterSettle);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        status: "completed",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      afterSettle.id,
      "completed",
    );
  });

  it("冪等：重複呼叫 settleAndSkipPath 不拋錯", () => {
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "settled",
      directPathwaySettled: "not-applicable",
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instance);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({ status: "skipped", autoPathwaySettled: "settled" }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    expect(() => {
      runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");
      runExecutionService.settleAndSkipPath(makeRunContext(), "pod-a", "auto");
    }).not.toThrow();
  });
});

describe("settleUnreachablePaths（透過 evaluateRunStatus 觸發）", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("線性鏈：A(skipped) → B(auto, pending) → B 被 skip", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "skipped",
      autoPathwaySettled: "settled",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    // 透過 errorPodInstance 觸發 evaluateRunStatus（使用已有的 instance mock 先取得 instanceA）
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceA);
    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-a",
      "test error",
    );

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-b");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
  });

  it("菱形 auto-only：B(skipped)→D(auto), C(running)→D(auto)，B skipped → D auto settled，但 C 還在跑，D 不 skip", () => {
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "skipped",
      autoPathwaySettled: "settled",
    });
    const instanceC = makeInstance({
      id: "i-c",
      podId: "pod-c",
      status: "running",
      autoPathwaySettled: "pending",
    });
    const instanceD = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceB,
      instanceC,
      instanceD,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-b",
        targetPodId: "pod-d",
        triggerMode: "auto",
      }),
      makeConnection({
        id: "c2",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceB);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-b",
      "test error",
    );

    // D 的 auto pathway 未 settle：ANY auto source skipped，但 C 還在跑不是 skipped/error
    // → autoConns.some(src.status === skipped/error) 中 B 確實是 skipped，所以 D 應該被 settle
    // 但 D 的 autoPathwaySettled 被 settle 後仍然是 all settled（只有 auto），所以 D 會被 skipped
    // 等等 - C 不是 skipped/error，所以 autoUnreachable 判定是 ANY，B 是 skipped，所以 autoUnreachable = true
    // D 只有 auto pathway (autoPathwaySettled=false, directPathwaySettled=null)
    // → after settle: autoPathwaySettled=true, directPathwaySettled=null → all settled → skipped
    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-d");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-d",
      "skipped",
    );
  });

  it("Direct-only 部分 skip：B(direct,error)→D, C(direct,running)→D → D 不 skip（不是 ALL）", () => {
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "error",
      autoPathwaySettled: "not-applicable",
    });
    const instanceC = makeInstance({
      id: "i-c",
      podId: "pod-c",
      status: "running",
      autoPathwaySettled: "not-applicable",
    });
    const instanceD = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceB,
      instanceC,
      instanceD,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-b",
        targetPodId: "pod-d",
        triggerMode: "direct",
      }),
      makeConnection({
        id: "c2",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
        triggerMode: "direct",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceB);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-b",
      "test error",
    );

    expect(runStore.settleDirectPathway).not.toHaveBeenCalledWith("i-d");
    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalledWith(
      "i-d",
      "skipped",
    );
  });

  it("Direct-only 全 error：B(direct,error), C(direct,error) → D skipped", () => {
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "error",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "settled",
    });
    const instanceC = makeInstance({
      id: "i-c",
      podId: "pod-c",
      status: "error",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "settled",
    });
    const instanceD = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceB,
      instanceC,
      instanceD,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-b",
        targetPodId: "pod-d",
        triggerMode: "direct",
      }),
      makeConnection({
        id: "c2",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
        triggerMode: "direct",
      }),
    ]);
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceB);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-b",
      "test error",
    );

    expect(runStore.settleDirectPathway).toHaveBeenCalledWith("i-d");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-d",
      "skipped",
    );
  });

  it("多層級聯：A(auto,skipped)→B→C→D 全 auto，A skipped → B/C/D 全 skip", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "skipped",
      autoPathwaySettled: "settled",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    const instanceC = makeInstance({
      id: "i-c",
      podId: "pod-c",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    const instanceD = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
      instanceC,
      instanceD,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c-ab",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
      makeConnection({
        id: "c-bc",
        sourcePodId: "pod-b",
        targetPodId: "pod-c",
        triggerMode: "auto",
      }),
      makeConnection({
        id: "c-cd",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceA);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-a",
      "test error",
    );

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-b");
    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-c");
    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-d");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-c",
      "skipped",
    );
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-d",
      "skipped",
    );
  });

  it("deciding 狀態 pod 被偵測為不可達時，應標記為 skipped", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "skipped",
      autoPathwaySettled: "settled",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "deciding",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceA);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-a",
      "test error",
    );

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-b");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
  });

  it("已完成 pod 不受影響", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "error",
      autoPathwaySettled: "settled",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "completed",
      autoPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c-ab",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceA);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-a",
      "test error",
    );

    expect(runStore.settleAutoPathway).not.toHaveBeenCalledWith("i-b");
    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
  });

  it("source 為 error 狀態時也應觸發下游 auto skip", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "error",
      autoPathwaySettled: "settled",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceA);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-a",
      "test error",
    );

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-b");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
  });

  it("direct pathway 混合 error+skipped source 觸發 skip", () => {
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "error",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "settled",
    });
    const instanceC = makeInstance({
      id: "i-c",
      podId: "pod-c",
      status: "skipped",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "settled",
    });
    const instanceD = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceB,
      instanceC,
      instanceD,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-b",
        targetPodId: "pod-d",
        triggerMode: "direct",
      }),
      makeConnection({
        id: "c2",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
        triggerMode: "direct",
      }),
    ]);
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceB);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-b",
      "test error",
    );

    expect(runStore.settleDirectPathway).toHaveBeenCalledWith("i-d");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-d",
      "skipped",
    );
  });

  it("queued 狀態 pod 被偵測為不可達時，應標記為 skipped", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "skipped",
      autoPathwaySettled: "settled",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "queued",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceA);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-a",
      "test error",
    );

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-b");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
  });

  it("waiting 狀態 pod 被偵測為不可達時，應標記為 skipped", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "skipped",
      autoPathwaySettled: "settled",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "waiting",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(instanceA);

    runExecutionService.errorPodInstance(
      makeRunContext(),
      "pod-a",
      "test error",
    );

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-b");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
  });

  it("source 為 deciding 狀態時不應觸發下游 auto skip", () => {
    const instanceA = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "deciding",
      autoPathwaySettled: "pending",
    });
    const instanceB = makeInstance({
      id: "i-b",
      podId: "pod-b",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceA,
      instanceB,
    ]);
    vi.spyOn(connectionStore, "list").mockReturnValue([
      makeConnection({
        id: "c1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      }),
    ]);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    // deciding 狀態的 pod 觸發 evaluateRunStatus（透過 settlePodTrigger 進入）
    const instanceASettled = makeInstance({
      id: "i-a",
      podId: "pod-a",
      status: "deciding",
      autoPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instanceA)
      .mockReturnValueOnce(instanceASettled)
      .mockReturnValueOnce(instanceASettled);

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-a", "auto");

    expect(runStore.settleAutoPathway).not.toHaveBeenCalledWith("i-b");
    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalledWith(
      "i-b",
      "skipped",
    );
  });
});

describe("雙 pathway pod 端到端", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto pathway settled 後 direct 未 settled → 不 completed；兩者都 settled → completed", () => {
    const instanceD = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "running",
      autoPathwaySettled: "pending",
      directPathwaySettled: "pending",
    });
    const instanceDAutoSettled = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "running",
      autoPathwaySettled: "settled",
      directPathwaySettled: "pending",
    });
    const instanceDBothSettled = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "running",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });

    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceDBothSettled,
    ]);
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    // Step 1: settle auto pathway — direct 未 settled → 不應 completed
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instanceD)
      .mockReturnValueOnce(instanceDAutoSettled);

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-d", "auto");

    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalledWith(
      "i-d",
      "completed",
    );

    vi.restoreAllMocks();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    // evaluateRunStatus 呼叫 getPodInstancesByRunId，需回傳全部已完成的狀態讓 run 結算
    const instanceDCompleted = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "completed",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceDCompleted,
    ]);
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    // Step 2: settle direct pathway — both settled → Pod D completed
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instanceDAutoSettled)
      .mockReturnValueOnce(instanceDBothSettled)
      .mockReturnValueOnce(instanceDBothSettled);

    runExecutionService.settlePodTrigger(makeRunContext(), "pod-d", "direct");

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-d",
      "completed",
    );
    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_STATUS_CHANGED,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("pending pod：auto settled 後 direct 未 settled → 不 skip；兩者都 settled → skipped", () => {
    const instanceD = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "pending",
      directPathwaySettled: "pending",
    });
    const instanceDAutoSettled = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "settled",
      directPathwaySettled: "pending",
    });
    const instanceDBothSettled = makeInstance({
      id: "i-d",
      podId: "pod-d",
      status: "pending",
      autoPathwaySettled: "settled",
      directPathwaySettled: "settled",
    });

    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    // Step 1: settle auto pathway — direct 未 settled → 不應 skip
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instanceD)
      .mockReturnValueOnce(instanceDAutoSettled);

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-d", "auto");

    expect(runStore.updatePodInstanceStatus).not.toHaveBeenCalledWith(
      "i-d",
      "skipped",
    );

    vi.restoreAllMocks();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      instanceDBothSettled,
    ]);
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    // Step 2: settle direct pathway — both settled, status=pending → Pod D skipped
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(instanceDAutoSettled)
      .mockReturnValueOnce(instanceDBothSettled)
      .mockReturnValueOnce(instanceDBothSettled);

    runExecutionService.settleAndSkipPath(makeRunContext(), "pod-d", "direct");

    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-d",
      "skipped",
    );
  });
});

describe("端到端：AI-decide reject → settleAndSkipPath → evaluateRunStatus → run completed", () => {
  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("source pod 完成後 target pod 被 reject → run 完成", () => {
    const sourceInstance = makeInstance({
      id: "i-source",
      podId: SOURCE_POD_ID,
      status: "running",
      autoPathwaySettled: "pending",
    });
    const targetInstance = makeInstance({
      id: "i-target",
      podId: "pod-target",
      status: "pending",
      autoPathwaySettled: "pending",
    });
    const sourceSettled = makeInstance({
      id: "i-source",
      podId: SOURCE_POD_ID,
      status: "running",
      autoPathwaySettled: "settled",
    });
    const targetSettled = makeInstance({
      id: "i-target",
      podId: "pod-target",
      status: "pending",
      autoPathwaySettled: "settled",
    });

    // settleAndSkipPath 呼叫順序：1st (targetInstance), 2nd (targetSettled), 3rd via updateAndEmitPodInstanceStatus (targetSettled)
    vi.spyOn(runStore, "getPodInstance")
      .mockReturnValueOnce(targetInstance)
      .mockReturnValueOnce(targetSettled)
      .mockReturnValueOnce(targetSettled);
    vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
    // After skip: source is completed, target is skipped
    vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
      makeInstance({
        id: "i-source",
        podId: SOURCE_POD_ID,
        status: "completed",
        autoPathwaySettled: "settled",
      }),
      makeInstance({
        id: "i-target",
        podId: "pod-target",
        status: "skipped",
        autoPathwaySettled: "settled",
      }),
    ]);
    vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      triggerMessage: "",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([]);

    runExecutionService.settleAndSkipPath(
      makeRunContext(),
      "pod-target",
      "auto",
    );

    expect(runStore.settleAutoPathway).toHaveBeenCalledWith("i-target");
    expect(runStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-target",
      "skipped",
    );
    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_STATUS_CHANGED,
      expect.objectContaining({ status: "completed" }),
    );
  });
});
