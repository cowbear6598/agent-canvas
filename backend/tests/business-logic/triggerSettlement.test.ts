import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runStore } from "../../src/services/runStore.js";
import { socketService } from "../../src/services/socketService.js";
import { logger } from "../../src/utils/logger.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import { getDb } from "../../src/database/index.js";
import { v4 as uuidv4 } from "uuid";
import { podStore } from "../../src/services/podStore.js";
import { runWorkflowSnapshotStore } from "../../src/services/workflow/runWorkflowSnapshotStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import type { RunContext } from "../../src/types/run.js";
import { installRunWorkflowSnapshot } from "../helpers/workflowSnapshotHelper.js";

// --- 測試常數 ---
const CANVAS_ID = "canvas-settle-1";
const SOURCE_POD_ID = "pod-source";

// --- DB 初始化 Helper ---
function insertCanvas(id: string = CANVAS_ID): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(id, `canvas-${id}`, 0);
}

function insertPod(canvasId: string, podId: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO pods
       (id, canvas_id, name, workspace_path)
       VALUES (?, ?, ?, ?)`,
    )
    .run(podId, canvasId, podId, `/tmp/${podId}`);
}

function makeRunContext(runId: string): RunContext {
  const runContext = {
    runId,
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
  };
  if (!runWorkflowSnapshotStore.has(runId)) {
    installRunWorkflowSnapshot(runContext, {
      pods: podStore.list(CANVAS_ID),
      connections: connectionStore.list(CANVAS_ID),
    });
  }
  return runContext;
}

/**
 * 直接透過 SQL 插入 connection，繞過 connectionStore.create 的 pod 查找與 model 解析，
 * 確保測試資料建立不依賴 podStore。
 */
function insertConnection(
  canvasId: string,
  sourcePodId: string,
  targetPodId: string,
  triggerMode: "auto" | "direct" | "branch" = "auto",
  id?: string,
): string {
  insertPod(canvasId, sourcePodId);
  insertPod(canvasId, targetPodId);
  const connId = id ?? uuidv4();
  getDb()
    .prepare(
      `INSERT INTO connections
       (id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor,
        trigger_mode)
       VALUES (?, ?, ?, 'right', ?, 'left', ?)`,
    )
    .run(connId, canvasId, sourcePodId, targetPodId, triggerMode);
  return connId;
}

describe("calculatePathways（透過 createRun 測試）", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
    podStore.__clearCacheForTesting();
    runWorkflowSnapshotStore.clear();
    insertCanvas();
    insertPod(CANVAS_ID, SOURCE_POD_ID);
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("源頭 pod → autoPathwaySettled=pending, directPathwaySettled=not-applicable", async () => {
    // 源頭 pod 沒有任何 incoming connection
    const ctx = await runExecutionService.createRun(
      CANVAS_ID,
      SOURCE_POD_ID,
      "測試",
    );
    const instance = runStore.getPodInstance(ctx.runId, SOURCE_POD_ID);

    expect(instance).toBeDefined();
    expect(instance!.autoPathwaySettled).toBe("pending");
    expect(instance!.directPathwaySettled).toBe("not-applicable");
  });

  it("只有 auto connections → target auto=pending, direct=not-applicable", async () => {
    const targetPod = "pod-target";
    insertConnection(CANVAS_ID, SOURCE_POD_ID, targetPod, "auto");

    const ctx = await runExecutionService.createRun(
      CANVAS_ID,
      SOURCE_POD_ID,
      "測試",
    );
    const instance = runStore.getPodInstance(ctx.runId, targetPod);

    expect(instance).toBeDefined();
    expect(instance!.autoPathwaySettled).toBe("pending");
    expect(instance!.directPathwaySettled).toBe("not-applicable");
  });

  it("只有 branch connections → target auto=pending, direct=not-applicable", async () => {
    const targetPod = "pod-target";
    insertConnection(CANVAS_ID, SOURCE_POD_ID, targetPod, "branch");

    const ctx = await runExecutionService.createRun(
      CANVAS_ID,
      SOURCE_POD_ID,
      "測試",
    );
    const instance = runStore.getPodInstance(ctx.runId, targetPod);

    expect(instance).toBeDefined();
    // branch 歸類為 auto-triggerable
    expect(instance!.autoPathwaySettled).toBe("pending");
    expect(instance!.directPathwaySettled).toBe("not-applicable");
  });

  it("只有 direct connections → target auto=not-applicable, direct=pending", async () => {
    const targetPod = "pod-target";
    insertConnection(CANVAS_ID, SOURCE_POD_ID, targetPod, "direct");

    const ctx = await runExecutionService.createRun(
      CANVAS_ID,
      SOURCE_POD_ID,
      "測試",
    );
    const instance = runStore.getPodInstance(ctx.runId, targetPod);

    expect(instance).toBeDefined();
    expect(instance!.autoPathwaySettled).toBe("not-applicable");
    expect(instance!.directPathwaySettled).toBe("pending");
  });

  it("auto + direct connections（同一 source）→ target auto=pending, direct=pending", async () => {
    const targetPod = "pod-target";
    insertConnection(CANVAS_ID, SOURCE_POD_ID, targetPod, "auto");
    insertConnection(CANVAS_ID, SOURCE_POD_ID, targetPod, "direct");

    const ctx = await runExecutionService.createRun(
      CANVAS_ID,
      SOURCE_POD_ID,
      "測試",
    );
    const instance = runStore.getPodInstance(ctx.runId, targetPod);

    expect(instance).toBeDefined();
    expect(instance!.autoPathwaySettled).toBe("pending");
    expect(instance!.directPathwaySettled).toBe("pending");
  });

  it("不在 chain 內的 connection 不計算", async () => {
    const targetPod = "pod-target";
    // chain 中只有 SOURCE → target（auto），pod-not-in-chain → target（direct）不在 chain 中
    insertConnection(CANVAS_ID, SOURCE_POD_ID, targetPod, "auto");
    insertConnection(CANVAS_ID, "pod-not-in-chain", targetPod, "direct");

    const ctx = await runExecutionService.createRun(
      CANVAS_ID,
      SOURCE_POD_ID,
      "測試",
    );
    const instance = runStore.getPodInstance(ctx.runId, targetPod);

    expect(instance).toBeDefined();
    // pod-not-in-chain 不在 chain 中，direct 不被計算
    expect(instance!.autoPathwaySettled).toBe("pending");
    expect(instance!.directPathwaySettled).toBe("not-applicable");
  });
});

describe("settlePodTrigger", () => {
  let runId: string;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetStatements();
    initTestDb();
    podStore.__clearCacheForTesting();
    runWorkflowSnapshotStore.clear();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    emitSpy = vi
      .spyOn(socketService, "emitToCanvas")
      .mockImplementation(() => {});

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
    runId = run.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("只有 auto pathway、settle auto → pod completed, run completed", () => {
    const inst = runStore.createPodInstance(runId, "pod-a", "pending");
    runStore.updatePodInstanceStatus(inst.id, "running");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("completed");

    const run = runStore.getRun(runId);
    expect(run!.status).toBe("completed");
  });

  it("只有 direct pathway、settle direct → pod completed", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "not-applicable",
      "pending",
    );
    runStore.updatePodInstanceStatus(inst.id, "running");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "direct",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("completed");
  });

  it("auto + direct pathway：settle auto 但 direct 未結算 → 不 completed", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "pending",
    );
    runStore.updatePodInstanceStatus(inst.id, "running");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("running");
    expect(updated!.autoPathwaySettled).toBe("settled");
    expect(updated!.directPathwaySettled).toBe("pending");
  });

  it("auto + direct pathway：auto 已結算，再 settle direct → completed", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "pending",
    );
    runStore.updatePodInstanceStatus(inst.id, "running");
    // 先 settle auto
    runStore.settleAutoPathway(inst.id);

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "direct",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("completed");
  });

  it("status 為 pending 且 all pathways settled 時不應更新為 completed", () => {
    // status=pending 屬於 NEVER_TRIGGERED_STATUSES，settle 後不會標記 completed
    runStore.createPodInstance(runId, "pod-a", "pending");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("pending");
    expect(updated!.autoPathwaySettled).toBe("settled");
  });

  it("找不到 instance 時 log warning 不拋錯", () => {
    expect(() =>
      runExecutionService.settlePodTrigger(
        makeRunContext(runId),
        "pod-nonexistent",
        "auto",
      ),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("emit RUN_POD_STATUS_CHANGED 與 RUN_STATUS_CHANGED 事件", () => {
    const inst = runStore.createPodInstance(runId, "pod-a", "pending");
    runStore.updatePodInstanceStatus(inst.id, "running");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    expect(emitSpy).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
      expect.objectContaining({ status: "completed" }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_STATUS_CHANGED,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("部分 pathway settle 時不改變 instance status", () => {
    // auto=pending, direct=pending，settle direct 後 auto 仍為 pending → 尚未全 settled
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "pending",
    );
    runStore.updatePodInstanceStatus(inst.id, "running");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "direct",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("running");
    expect(updated!.directPathwaySettled).toBe("settled");
    expect(updated!.autoPathwaySettled).toBe("pending");
  });

  it("全部 pathway settle 後正常標記 completed", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "pending",
    );
    runStore.updatePodInstanceStatus(inst.id, "running");
    runStore.settleAutoPathway(inst.id);

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "direct",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("completed");
  });

  it("部分 pathway settle 但 instance status 非 running 時不回退（error 不應變回 pending）", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "pending",
    );
    runStore.updatePodInstanceStatus(inst.id, "error");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "direct",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("error");
  });
});

describe("settleAndSkipPath", () => {
  let runId: string;

  beforeEach(() => {
    resetStatements();
    initTestDb();
    podStore.__clearCacheForTesting();
    runWorkflowSnapshotStore.clear();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
    runId = run.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("settle auto，還有 direct 未結算 → 不動作（狀態維持 pending）", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "pending",
    );

    runExecutionService.settleAndSkipPath(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("pending");
    expect(updated!.autoPathwaySettled).toBe("settled");
    expect(updated!.directPathwaySettled).toBe("pending");
  });

  it("settle auto，direct 也已結算，status=pending → skipped", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "not-applicable",
    );
    // status=pending 屬於 NEVER_TRIGGERED_STATUSES → skipped

    runExecutionService.settleAndSkipPath(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("skipped");
  });

  it("settle auto，direct 也已結算，status=queued → skipped（排隊中視為未觸發）", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "not-applicable",
    );
    runStore.updatePodInstanceStatus(inst.id, "queued");

    runExecutionService.settleAndSkipPath(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("skipped");
  });

  it("settle auto，direct 也已結算，status=waiting → skipped（等待中視為未觸發）", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "not-applicable",
    );
    runStore.updatePodInstanceStatus(inst.id, "waiting");

    runExecutionService.settleAndSkipPath(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("skipped");
  });

  it("settle auto，direct 也已結算，status=deciding → skipped（AI 判斷中視為未觸發）", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "not-applicable",
    );
    runStore.updatePodInstanceStatus(inst.id, "deciding");

    runExecutionService.settleAndSkipPath(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("skipped");
  });

  it("settle auto，direct 也已結算，status=running → completed", () => {
    const inst = runStore.createPodInstance(
      runId,
      "pod-a",
      "pending",
      "not-applicable",
    );
    runStore.updatePodInstanceStatus(inst.id, "running");

    runExecutionService.settleAndSkipPath(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updated = runStore.getPodInstance(runId, "pod-a");
    expect(updated!.status).toBe("completed");
  });

  it("冪等：重複呼叫 settleAndSkipPath 不拋錯", () => {
    runStore.createPodInstance(runId, "pod-a", "pending", "not-applicable");

    expect(() => {
      runExecutionService.settleAndSkipPath(
        makeRunContext(runId),
        "pod-a",
        "auto",
      );
      runExecutionService.settleAndSkipPath(
        makeRunContext(runId),
        "pod-a",
        "auto",
      );
    }).not.toThrow();
  });

  it("找不到 instance 時 log warning 不拋錯", () => {
    expect(() =>
      runExecutionService.settleAndSkipPath(
        makeRunContext(runId),
        "pod-nonexistent",
        "auto",
      ),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("settleUnreachablePaths（透過 evaluateRunStatus 觸發）", () => {
  let runId: string;

  beforeEach(() => {
    resetStatements();
    initTestDb();
    podStore.__clearCacheForTesting();
    runWorkflowSnapshotStore.clear();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
    runId = run.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("線性鏈：A(skipped) → B(auto, pending) → B 被 skip", () => {
    const instA = runStore.createPodInstance(runId, "pod-a", "settled");
    runStore.updatePodInstanceStatus(instA.id, "skipped");

    runStore.createPodInstance(runId, "pod-b", "pending");
    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");

    // 透過 errorPodInstance 觸發 evaluateRunStatus（errorPodInstance 亦呼叫 evaluateRunStatus）
    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-a",
      "test error",
    );

    const instB = runStore.getPodInstance(runId, "pod-b");
    expect(instB!.status).toBe("skipped");
    expect(instB!.autoPathwaySettled).toBe("settled");
  });

  it("菱形 auto-only：B(skipped)→D, C(running)→D，B skipped → D auto settled，D skipped", () => {
    const instB = runStore.createPodInstance(runId, "pod-b", "settled");
    runStore.updatePodInstanceStatus(instB.id, "skipped");

    const instC = runStore.createPodInstance(runId, "pod-c", "pending");
    runStore.updatePodInstanceStatus(instC.id, "running");

    runStore.createPodInstance(runId, "pod-d", "pending");
    insertConnection(CANVAS_ID, "pod-b", "pod-d", "auto");
    insertConnection(CANVAS_ID, "pod-c", "pod-d", "auto");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-b",
      "test error",
    );

    const instD = runStore.getPodInstance(runId, "pod-d");
    // auto: ANY auto source skipped → auto settled，且 C 仍在跑，但 D 的 autoPathwaySettled 已 settled
    // D 只有 auto pathway → all settled → skipped
    expect(instD!.autoPathwaySettled).toBe("settled");
    expect(instD!.status).toBe("skipped");
  });

  it("Direct-only 部分 skip：B(direct,error)→D, C(direct,running)→D → D 不 skip（不是 ALL）", () => {
    const instB = runStore.createPodInstance(
      runId,
      "pod-b",
      "not-applicable",
      "settled",
    );
    runStore.updatePodInstanceStatus(instB.id, "error");

    const instC = runStore.createPodInstance(
      runId,
      "pod-c",
      "not-applicable",
      "pending",
    );
    runStore.updatePodInstanceStatus(instC.id, "running");

    runStore.createPodInstance(runId, "pod-d", "not-applicable", "pending");
    insertConnection(CANVAS_ID, "pod-b", "pod-d", "direct");
    insertConnection(CANVAS_ID, "pod-c", "pod-d", "direct");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-b",
      "test error",
    );

    const instD = runStore.getPodInstance(runId, "pod-d");
    expect(instD!.status).toBe("pending");
    expect(instD!.directPathwaySettled).toBe("pending");
  });

  it("Direct-only 全 error：B(direct,error), C(direct,error) → D skipped", () => {
    const instB = runStore.createPodInstance(
      runId,
      "pod-b",
      "not-applicable",
      "settled",
    );
    runStore.updatePodInstanceStatus(instB.id, "error");

    const instC = runStore.createPodInstance(
      runId,
      "pod-c",
      "not-applicable",
      "settled",
    );
    runStore.updatePodInstanceStatus(instC.id, "error");

    runStore.createPodInstance(runId, "pod-d", "not-applicable", "pending");
    insertConnection(CANVAS_ID, "pod-b", "pod-d", "direct");
    insertConnection(CANVAS_ID, "pod-c", "pod-d", "direct");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-b",
      "test error",
    );

    const instD = runStore.getPodInstance(runId, "pod-d");
    expect(instD!.status).toBe("skipped");
  });

  it("多層級聯：A(auto,skipped)→B→C→D 全 auto，A skipped → B/C/D 全 skip", () => {
    const instA = runStore.createPodInstance(runId, "pod-a", "settled");
    runStore.updatePodInstanceStatus(instA.id, "skipped");

    runStore.createPodInstance(runId, "pod-b", "pending");
    runStore.createPodInstance(runId, "pod-c", "pending");
    runStore.createPodInstance(runId, "pod-d", "pending");

    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");
    insertConnection(CANVAS_ID, "pod-b", "pod-c", "auto");
    insertConnection(CANVAS_ID, "pod-c", "pod-d", "auto");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-a",
      "test error",
    );

    expect(runStore.getPodInstance(runId, "pod-b")!.status).toBe("skipped");
    expect(runStore.getPodInstance(runId, "pod-c")!.status).toBe("skipped");
    expect(runStore.getPodInstance(runId, "pod-d")!.status).toBe("skipped");
  });

  it("deciding 狀態 pod 被偵測為不可達時，應標記為 skipped", () => {
    const instA = runStore.createPodInstance(runId, "pod-a", "settled");
    runStore.updatePodInstanceStatus(instA.id, "skipped");

    const instB = runStore.createPodInstance(runId, "pod-b", "pending");
    runStore.updatePodInstanceStatus(instB.id, "deciding");

    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-a",
      "test error",
    );

    const updB = runStore.getPodInstance(runId, "pod-b");
    expect(updB!.status).toBe("skipped");
    expect(updB!.autoPathwaySettled).toBe("settled");
  });

  it("已完成 pod 不受影響", () => {
    const instA = runStore.createPodInstance(runId, "pod-a", "settled");
    runStore.updatePodInstanceStatus(instA.id, "error");

    const instB = runStore.createPodInstance(runId, "pod-b", "settled");
    runStore.updatePodInstanceStatus(instB.id, "completed");

    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-a",
      "test error",
    );

    // B 已完成，不應被改變
    const updB = runStore.getPodInstance(runId, "pod-b");
    expect(updB!.status).toBe("completed");
  });

  it("source 為 error 狀態時也應觸發下游 auto skip", () => {
    const instA = runStore.createPodInstance(runId, "pod-a", "settled");
    runStore.updatePodInstanceStatus(instA.id, "error");

    runStore.createPodInstance(runId, "pod-b", "pending");
    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-a",
      "test error",
    );

    expect(runStore.getPodInstance(runId, "pod-b")!.status).toBe("skipped");
  });

  it("direct pathway 混合 error+skipped source 觸發 skip", () => {
    const instB = runStore.createPodInstance(
      runId,
      "pod-b",
      "not-applicable",
      "settled",
    );
    runStore.updatePodInstanceStatus(instB.id, "error");

    const instC = runStore.createPodInstance(
      runId,
      "pod-c",
      "not-applicable",
      "settled",
    );
    runStore.updatePodInstanceStatus(instC.id, "skipped");

    runStore.createPodInstance(runId, "pod-d", "not-applicable", "pending");
    insertConnection(CANVAS_ID, "pod-b", "pod-d", "direct");
    insertConnection(CANVAS_ID, "pod-c", "pod-d", "direct");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-b",
      "test error",
    );

    expect(runStore.getPodInstance(runId, "pod-d")!.status).toBe("skipped");
  });

  it("queued 狀態 pod 被偵測為不可達時，應標記為 skipped", () => {
    const instA = runStore.createPodInstance(runId, "pod-a", "settled");
    runStore.updatePodInstanceStatus(instA.id, "skipped");

    const instB = runStore.createPodInstance(runId, "pod-b", "pending");
    runStore.updatePodInstanceStatus(instB.id, "queued");

    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-a",
      "test error",
    );

    expect(runStore.getPodInstance(runId, "pod-b")!.status).toBe("skipped");
  });

  it("waiting 狀態 pod 被偵測為不可達時，應標記為 skipped", () => {
    const instA = runStore.createPodInstance(runId, "pod-a", "settled");
    runStore.updatePodInstanceStatus(instA.id, "skipped");

    const instB = runStore.createPodInstance(runId, "pod-b", "pending");
    runStore.updatePodInstanceStatus(instB.id, "waiting");

    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");

    runExecutionService.errorPodInstance(
      makeRunContext(runId),
      "pod-a",
      "test error",
    );

    expect(runStore.getPodInstance(runId, "pod-b")!.status).toBe("skipped");
  });

  it("source 為 deciding 狀態時不應觸發下游 auto skip", () => {
    // deciding 不是 skipped/error，不滿足 autoUnreachable 條件
    const instA = runStore.createPodInstance(runId, "pod-a", "pending");
    runStore.updatePodInstanceStatus(instA.id, "deciding");

    runStore.createPodInstance(runId, "pod-b", "pending");
    insertConnection(CANVAS_ID, "pod-a", "pod-b", "auto");

    runExecutionService.settlePodTrigger(
      makeRunContext(runId),
      "pod-a",
      "auto",
    );

    const updB = runStore.getPodInstance(runId, "pod-b");
    expect(updB!.status).toBe("pending");
  });
});

describe("雙 pathway pod 端到端", () => {
  let runId: string;

  beforeEach(() => {
    resetStatements();
    initTestDb();
    podStore.__clearCacheForTesting();
    runWorkflowSnapshotStore.clear();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
    runId = run.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto pathway settled 後 direct 未 settled → 不 completed；兩者都 settled → completed", () => {
    const runCtx = makeRunContext(runId);
    const inst = runStore.createPodInstance(
      runId,
      "pod-d",
      "pending",
      "pending",
    );
    runStore.updatePodInstanceStatus(inst.id, "running");

    // Step 1: settle auto pathway — direct 未 settled → 不應 completed
    runExecutionService.settlePodTrigger(runCtx, "pod-d", "auto");

    let updated = runStore.getPodInstance(runId, "pod-d");
    expect(updated!.status).toBe("running");
    expect(updated!.autoPathwaySettled).toBe("settled");

    // Step 2: settle direct pathway — both settled → Pod D completed
    runExecutionService.settlePodTrigger(runCtx, "pod-d", "direct");

    updated = runStore.getPodInstance(runId, "pod-d");
    expect(updated!.status).toBe("completed");

    const run = runStore.getRun(runId);
    expect(run!.status).toBe("completed");
  });

  it("pending pod：auto settled 後 direct 未 settled → 不 skip；兩者都 settled → skipped", () => {
    const runCtx = makeRunContext(runId);
    runStore.createPodInstance(runId, "pod-d", "pending", "pending");

    // Step 1: settle auto → direct 未 settled，不 skip
    runExecutionService.settleAndSkipPath(runCtx, "pod-d", "auto");

    let updated = runStore.getPodInstance(runId, "pod-d");
    expect(updated!.status).toBe("pending");

    // Step 2: settle direct → both settled, status=pending → skipped
    runExecutionService.settleAndSkipPath(runCtx, "pod-d", "direct");

    updated = runStore.getPodInstance(runId, "pod-d");
    expect(updated!.status).toBe("skipped");
  });
});

describe("端到端：AI-decide reject → settleAndSkipPath → evaluateRunStatus → run completed", () => {
  let runId: string;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetStatements();
    initTestDb();
    podStore.__clearCacheForTesting();
    runWorkflowSnapshotStore.clear();
    insertCanvas();
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    emitSpy = vi
      .spyOn(socketService, "emitToCanvas")
      .mockImplementation(() => {});

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "測試");
    runId = run.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("source pod 完成後 target pod 被 reject → run 完成", () => {
    const runCtx = makeRunContext(runId);

    // source 已完成
    const srcInst = runStore.createPodInstance(runId, SOURCE_POD_ID, "settled");
    runStore.updatePodInstanceStatus(srcInst.id, "completed");

    // target 為 pending，等待 AI-decide
    runStore.createPodInstance(runId, "pod-target", "pending");

    // AI-decide reject → settleAndSkipPath
    runExecutionService.settleAndSkipPath(runCtx, "pod-target", "auto");

    const target = runStore.getPodInstance(runId, "pod-target");
    expect(target!.status).toBe("skipped");
    expect(target!.autoPathwaySettled).toBe("settled");

    const run = runStore.getRun(runId);
    expect(run!.status).toBe("completed");

    expect(emitSpy).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_STATUS_CHANGED,
      expect.objectContaining({ status: "completed" }),
    );
  });
});
