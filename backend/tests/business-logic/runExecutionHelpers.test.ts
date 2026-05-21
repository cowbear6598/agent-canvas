import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isInstanceUnreachable,
  settleInstanceIfUnreachable,
} from "../../src/services/workflow/runExecutionService.js";
import type { RunPodInstance } from "../../src/services/runStore.js";
import type { Connection } from "../../src/types/index.js";

vi.mock("../../src/services/runStore.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/services/runStore.js")>();
  return {
    ...original,
    runStore: {
      settleAutoPathway: vi.fn(),
      settleDirectPathway: vi.fn(),
      updatePodInstanceStatus: vi.fn(),
    },
  };
});

function makeInstance(overrides?: Partial<RunPodInstance>): RunPodInstance {
  return {
    id: "i-1",
    runId: "run-1",
    podId: "pod-a",
    status: "pending",
    sessionId: null,
    errorMessage: null,
    triggeredAt: null,
    completedAt: null,
    autoPathwaySettled: "not-applicable",
    directPathwaySettled: "not-applicable",
    ...overrides,
  };
}

function makeConn(overrides?: Partial<Connection>): Connection {
  return {
    id: "c-1",
    sourcePodId: "pod-src",
    targetPodId: "pod-a",
    sourceAnchor: "right",
    targetAnchor: "left",
    triggerMode: "auto",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    ...overrides,
  };
}

describe("isInstanceUnreachable", () => {
  it("auto source skipped → autoUnreachable=true", () => {
    const instance = makeInstance({ autoPathwaySettled: "pending" });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "skipped",
      autoPathwaySettled: "settled",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "auto" });

    const result = isInstanceUnreachable(instance, [conn], [srcA, instance]);

    expect(result.autoUnreachable).toBe(true);
    expect(result.directUnreachable).toBe(false);
  });

  it("auto source error → autoUnreachable=true", () => {
    const instance = makeInstance({ autoPathwaySettled: "pending" });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "error",
      autoPathwaySettled: "settled",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "auto" });

    const result = isInstanceUnreachable(instance, [conn], [srcA, instance]);

    expect(result.autoUnreachable).toBe(true);
  });

  it("auto source 仍在執行中 → autoUnreachable=false", () => {
    const instance = makeInstance({ autoPathwaySettled: "pending" });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "running",
      autoPathwaySettled: "settled",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "auto" });

    const result = isInstanceUnreachable(instance, [conn], [srcA, instance]);

    expect(result.autoUnreachable).toBe(false);
  });

  it("direct：只有部分 source 失敗 → directUnreachable=false（需全部失敗）", () => {
    const instance = makeInstance({ directPathwaySettled: "pending" });
    const srcA = makeInstance({
      id: "i-a",
      podId: "pod-a-src",
      status: "error",
    });
    const srcB = makeInstance({
      id: "i-b",
      podId: "pod-b-src",
      status: "running",
    });
    const connA = makeConn({
      id: "c-a",
      sourcePodId: "pod-a-src",
      triggerMode: "direct",
    });
    const connB = makeConn({
      id: "c-b",
      sourcePodId: "pod-b-src",
      triggerMode: "direct",
    });

    const result = isInstanceUnreachable(
      instance,
      [connA, connB],
      [srcA, srcB, instance],
    );

    expect(result.directUnreachable).toBe(false);
  });

  it("direct：全部 source 失敗 → directUnreachable=true", () => {
    const instance = makeInstance({ directPathwaySettled: "pending" });
    const srcA = makeInstance({
      id: "i-a",
      podId: "pod-a-src",
      status: "error",
    });
    const srcB = makeInstance({
      id: "i-b",
      podId: "pod-b-src",
      status: "skipped",
    });
    const connA = makeConn({
      id: "c-a",
      sourcePodId: "pod-a-src",
      triggerMode: "direct",
    });
    const connB = makeConn({
      id: "c-b",
      sourcePodId: "pod-b-src",
      triggerMode: "direct",
    });

    const result = isInstanceUnreachable(
      instance,
      [connA, connB],
      [srcA, srcB, instance],
    );

    expect(result.directUnreachable).toBe(true);
  });

  it("directPathwaySettled 非 pending 時 directUnreachable=false（已結算，不須再處理）", () => {
    const instance = makeInstance({ directPathwaySettled: "settled" });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "skipped",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "direct" });

    const result = isInstanceUnreachable(instance, [conn], [srcA, instance]);

    expect(result.directUnreachable).toBe(false);
  });

  it("autoPathwaySettled 非 pending 時 autoUnreachable=false（已結算，不須再處理）", () => {
    const instance = makeInstance({ autoPathwaySettled: "settled" });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "skipped",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "auto" });

    const result = isInstanceUnreachable(instance, [conn], [srcA, instance]);

    expect(result.autoUnreachable).toBe(false);
  });

  it("無 incoming connections → autoUnreachable=false, directUnreachable=false", () => {
    const instance = makeInstance({
      autoPathwaySettled: "pending",
      directPathwaySettled: "pending",
    });

    const result = isInstanceUnreachable(instance, [], [instance]);

    expect(result.autoUnreachable).toBe(false);
    expect(result.directUnreachable).toBe(false);
  });
});

describe("settleInstanceIfUnreachable", () => {
  let mockRunStore: {
    settleAutoPathway: ReturnType<typeof vi.fn>;
    settleDirectPathway: ReturnType<typeof vi.fn>;
    updatePodInstanceStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/services/runStore.js");
    mockRunStore = mod.runStore as unknown as typeof mockRunStore;
  });

  it("instance 狀態非 NEVER_TRIGGERED 時應回傳 false", () => {
    const instance = makeInstance({
      status: "running",
      autoPathwaySettled: "pending",
    });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "skipped",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "auto" });
    const podIds = new Set(["pod-a", "pod-src"]);

    const result = settleInstanceIfUnreachable(
      instance,
      [conn],
      [srcA, instance],
      podIds,
    );

    expect(result).toBe(false);
    expect(mockRunStore.settleAutoPathway).not.toHaveBeenCalled();
    expect(mockRunStore.settleDirectPathway).not.toHaveBeenCalled();
  });

  it("autoUnreachable 時應 settle auto pathway 且回傳 true", () => {
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "pending",
      directPathwaySettled: "not-applicable",
    });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "skipped",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "auto" });
    const podIds = new Set(["pod-a", "pod-src"]);

    const result = settleInstanceIfUnreachable(
      instance,
      [conn],
      [srcA, instance],
      podIds,
    );

    expect(result).toBe(true);
    expect(mockRunStore.settleAutoPathway).toHaveBeenCalledWith("i-1");
    expect(instance.autoPathwaySettled).toBe("settled");
  });

  it("directUnreachable 時應 settle direct pathway 且回傳 true", () => {
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "not-applicable",
      directPathwaySettled: "pending",
    });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "error",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "direct" });
    const podIds = new Set(["pod-a", "pod-src"]);

    const result = settleInstanceIfUnreachable(
      instance,
      [conn],
      [srcA, instance],
      podIds,
    );

    expect(result).toBe(true);
    expect(mockRunStore.settleDirectPathway).toHaveBeenCalledWith("i-1");
    expect(instance.directPathwaySettled).toBe("settled");
  });

  it("兩者皆可達時應回傳 false", () => {
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "pending",
      directPathwaySettled: "pending",
    });
    const srcAuto = makeInstance({
      id: "i-auto",
      podId: "pod-auto",
      status: "running",
    });
    const srcDirect = makeInstance({
      id: "i-direct",
      podId: "pod-direct",
      status: "running",
    });
    const connAuto = makeConn({
      id: "c-auto",
      sourcePodId: "pod-auto",
      triggerMode: "auto",
    });
    const connDirect = makeConn({
      id: "c-direct",
      sourcePodId: "pod-direct",
      triggerMode: "direct",
    });
    const podIds = new Set(["pod-a", "pod-auto", "pod-direct"]);

    const result = settleInstanceIfUnreachable(
      instance,
      [connAuto, connDirect],
      [srcAuto, srcDirect, instance],
      podIds,
    );

    expect(result).toBe(false);
    expect(mockRunStore.settleAutoPathway).not.toHaveBeenCalled();
    expect(mockRunStore.settleDirectPathway).not.toHaveBeenCalled();
  });

  it("settle 後所有 pathway 皆 settled 時應更新 status 為 skipped", () => {
    // auto 已 settled + direct 即將被 settle → 全部 settled，status 為 pending（NEVER_TRIGGERED）→ skipped
    const instance = makeInstance({
      status: "pending",
      autoPathwaySettled: "settled",
      directPathwaySettled: "pending",
    });
    const srcA = makeInstance({
      id: "i-src",
      podId: "pod-src",
      status: "skipped",
    });
    const conn = makeConn({ sourcePodId: "pod-src", triggerMode: "direct" });
    const podIds = new Set(["pod-a", "pod-src"]);

    const result = settleInstanceIfUnreachable(
      instance,
      [conn],
      [srcA, instance],
      podIds,
    );

    expect(result).toBe(true);
    expect(mockRunStore.settleDirectPathway).toHaveBeenCalledWith("i-1");
    expect(mockRunStore.updatePodInstanceStatus).toHaveBeenCalledWith(
      "i-1",
      "skipped",
    );
    expect(instance.status).toBe("skipped");
  });
});
