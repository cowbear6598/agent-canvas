import { describe, expect, it } from "vitest";
import {
  decidePodStartStatus,
  decidePodStatusAfterPathwaySettlement,
  decidePodStatusAfterTriggerSettlement,
  decideRunQueueSettlement,
  decideRunTerminalStatus,
  shouldIgnorePodStatusUpdateForRun,
  shouldMarkRunCancelled,
} from "../../src/services/workflow/runStatusMachine.js";
import type {
  RunPodInstanceStatus,
  RunStatus,
} from "../../src/services/runStore.js";
import type { PathwayState } from "../../src/types/run.js";

function makeInstance(
  status: RunPodInstanceStatus,
  autoPathwaySettled: PathwayState = "pending",
  directPathwaySettled: PathwayState = "not-applicable",
) {
  return { status, autoPathwaySettled, directPathwaySettled };
}

function makeRun(status: RunStatus) {
  return { status };
}

describe("runStatusMachine", () => {
  describe("run 開始", () => {
    it("非終態 pod 可進入 running，終態 pod 不重啟", () => {
      expect(decidePodStartStatus("pending")).toBe("running");
      expect(decidePodStartStatus("waiting")).toBe("running");
      expect(decidePodStartStatus("completed")).toBeNull();
      expect(decidePodStartStatus("error")).toBeNull();
      expect(decidePodStartStatus("skipped")).toBeNull();
    });
  });

  describe("run 完成與失敗", () => {
    it("全部 pod completed/skipped 時 run 決策為 completed", () => {
      expect(
        decideRunTerminalStatus([
          { status: "completed" },
          { status: "skipped" },
        ]),
      ).toBe("completed");
    });

    it("有 error 且沒有進行中 pod 時 run 決策為 error", () => {
      expect(
        decideRunTerminalStatus([
          { status: "error" },
          { status: "completed" },
        ]),
      ).toBe("error");
    });

    it("有 blocked 且沒有進行中 pod 時 run 決策也收斂為 error", () => {
      expect(
        decideRunTerminalStatus([
          { status: "blocked" },
          { status: "completed" },
        ]),
      ).toBe("error");
    });

    it("有 error 但仍有進行中 pod 時 run 不進入終態", () => {
      expect(
        decideRunTerminalStatus([
          { status: "error" },
          { status: "summarizing" },
        ]),
      ).toBeNull();
    });

    it("有 blocked 但仍有進行中 pod 時 run 不進入終態", () => {
      expect(
        decideRunTerminalStatus([
          { status: "blocked" },
          { status: "summarizing" },
        ]),
      ).toBeNull();
    });
  });

  describe("run 取消", () => {
    it("已取消或不存在的 run 會忽略後續 pod status update", () => {
      expect(shouldIgnorePodStatusUpdateForRun(null)).toBe(true);
      expect(shouldIgnorePodStatusUpdateForRun(makeRun("cancelled"))).toBe(
        true,
      );
      expect(shouldIgnorePodStatusUpdateForRun(makeRun("running"))).toBe(
        false,
      );
    });

    it("只有非終態 run 需要標記為 cancelled", () => {
      expect(shouldMarkRunCancelled(makeRun("running"))).toBe(true);
      expect(shouldMarkRunCancelled(makeRun("completed"))).toBe(false);
      expect(shouldMarkRunCancelled(makeRun("error"))).toBe(false);
      expect(shouldMarkRunCancelled(makeRun("cancelled"))).toBe(false);
      expect(shouldMarkRunCancelled(null)).toBe(false);
    });
  });

  describe("settlement decision", () => {
    it("skip settlement 對未觸發狀態回傳 skipped，已觸發狀態回傳 completed", () => {
      expect(
        decidePodStatusAfterPathwaySettlement(
          makeInstance("queued", "settled", "not-applicable"),
        ),
      ).toBe("skipped");
      expect(
        decidePodStatusAfterPathwaySettlement(
          makeInstance("running", "settled", "not-applicable"),
        ),
      ).toBe("completed");
    });

    it("重複 settle 已 skipped 的 branch 路徑時應維持 skipped", () => {
      expect(
        decidePodStatusAfterPathwaySettlement(
          makeInstance("skipped", "settled", "not-applicable"),
        ),
      ).toBe("skipped");
    });

    it("trigger settlement 需 pathway 全 settled 且 queue 為空才 completed", () => {
      expect(
        decidePodStatusAfterTriggerSettlement(
          makeInstance("running", "settled", "not-applicable"),
          0,
        ),
      ).toBe("completed");
      expect(
        decidePodStatusAfterTriggerSettlement(
          makeInstance("running", "settled", "not-applicable"),
          1,
        ),
      ).toBeNull();
      expect(
        decidePodStatusAfterTriggerSettlement(
          makeInstance("pending", "settled", "not-applicable"),
          0,
        ),
      ).toBeNull();
    });

    it("Pod 的 trigger settlement 完成後一律回到 completed", () => {
      expect(
        decidePodStatusAfterTriggerSettlement(
          makeInstance("running", "settled", "not-applicable"),
          0,
        ),
      ).toBe("completed");
    });

    it("run queue settlement 保留既有 active stream、empty 與 process-next 決策", () => {
      expect(decideRunQueueSettlement(true, 1)).toBe(
        "wait-for-active-stream",
      );
      expect(decideRunQueueSettlement(false, 0)).toBe("empty");
      expect(decideRunQueueSettlement(false, 2)).toBe("process-next");
    });
  });
});
