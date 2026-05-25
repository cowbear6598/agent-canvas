import { describe, expect, it } from "vitest";
import { MAX_RUNS_PER_CANVAS } from "@/lib/constants";
import { normalizeRunHistoryResponse } from "@/stores/run/runHistoryNormalizer";
import type { WorkflowRun } from "@/types/run";

function createRun(id: string): WorkflowRun {
  return {
    id,
    canvasId: "canvas-1",
    sourcePodId: "pod-1",
    sourcePodName: "Pod 1",
    triggerMessage: "Hello",
    status: "completed",
    podInstances: [],
    createdAt: "2026-05-25T10:00:00.000Z",
  };
}

describe("runHistoryNormalizer", () => {
  it("成功回應應轉成 runsById 使用的 Map", () => {
    const normalized = normalizeRunHistoryResponse({
      success: true,
      runs: [createRun("run-1"), createRun("run-2")],
    });

    expect(normalized).toBeInstanceOf(Map);
    expect(normalized?.get("run-1")?.id).toBe("run-1");
    expect(normalized?.get("run-2")?.id).toBe("run-2");
  });

  it("失敗或缺少 runs 時應回傳 null", () => {
    expect(normalizeRunHistoryResponse({ success: false })).toBeNull();
    expect(normalizeRunHistoryResponse({ success: true })).toBeNull();
  });

  it("應限制最多 MAX_RUNS_PER_CANVAS 筆", () => {
    const normalized = normalizeRunHistoryResponse({
      success: true,
      runs: Array.from({ length: MAX_RUNS_PER_CANVAS + 5 }, (_, index) =>
        createRun(`run-${index}`),
      ),
    });

    expect(normalized?.size).toBe(MAX_RUNS_PER_CANVAS);
    expect(normalized?.has(`run-${MAX_RUNS_PER_CANVAS}`)).toBe(false);
  });
});
