import { describe, expect, it } from "vitest";
import {
  decidePodStatusAfterSkipSettlement,
  decidePodStatusAfterTriggerSettlement,
  decideRunQueueSettlement,
  decideRunTerminalStatus,
  decideSummaryFallback,
  isTerminalPodStatus,
  isTerminalRunStatus,
  isWorkflowTriggerEligible,
} from "../../src/services/workflow/workflowRunDecisions.js";
import type { RunPodInstanceStatus } from "../../src/services/runStore.js";
import type { PathwayState } from "../../src/types/run.js";

function makeInstance(
  status: RunPodInstanceStatus,
  autoPathwaySettled: PathwayState = "pending",
  directPathwaySettled: PathwayState = "not-applicable",
) {
  return { status, autoPathwaySettled, directPathwaySettled };
}

describe("workflowRunDecisions", () => {
  describe("trigger eligibility", () => {
    it.each([
      ["pending", true],
      ["deciding", true],
      ["queued", true],
      ["waiting", true],
      ["running", true],
      ["summarizing", false],
      ["completed", false],
      ["error", false],
      ["skipped", false],
    ] as const)(
      "status=%s 的 workflow trigger eligibility 為 %s",
      (status, expected) => {
        expect(isWorkflowTriggerEligible(status)).toBe(expected);
      },
    );
  });

  describe("terminal state", () => {
    it("辨識 pod 與 run 終態", () => {
      expect(isTerminalPodStatus("completed")).toBe(true);
      expect(isTerminalPodStatus("error")).toBe(true);
      expect(isTerminalPodStatus("running")).toBe(false);
      expect(isTerminalRunStatus("completed")).toBe(true);
      expect(isTerminalRunStatus("cancelled")).toBe(true);
      expect(isTerminalRunStatus("running")).toBe(false);
    });

    it("所有 pod completed/skipped 時 run 決策為 completed", () => {
      expect(
        decideRunTerminalStatus([
          { status: "completed" },
          { status: "skipped" },
        ]),
      ).toBe("completed");
    });

    it("有 error 且無進行中 pod 時 run 決策為 error", () => {
      expect(
        decideRunTerminalStatus([
          { status: "error" },
          { status: "completed" },
        ]),
      ).toBe("error");
    });

    it("有 queued/waiting/deciding 等進行中 pod 時 run 不進入終態", () => {
      expect(
        decideRunTerminalStatus([
          { status: "error" },
          { status: "queued" },
        ]),
      ).toBeNull();
    });
  });

  describe("summary fallback decision", () => {
    it("摘要成功時使用 summary 結果", () => {
      expect(decideSummaryFallback(true, "fallback", "無法生成摘要")).toEqual({
        kind: "summary",
      });
    });

    it("摘要失敗但有最後 assistant 訊息時使用 fallback", () => {
      expect(decideSummaryFallback(false, "最後回覆", "無法生成摘要")).toEqual({
        kind: "fallback",
        content: "最後回覆",
      });
    });

    it("摘要失敗且無 fallback 時回傳失敗決策", () => {
      expect(decideSummaryFallback(false, null, "無法生成摘要")).toEqual({
        kind: "failed",
        errorMessage: "無法生成摘要",
      });
    });
  });

  describe("queue settlement rules", () => {
    it("pathway 全 settled、已觸發且 queue 空時 pod completed", () => {
      expect(
        decidePodStatusAfterTriggerSettlement(
          makeInstance("running", "settled", "not-applicable"),
          0,
        ),
      ).toBe("completed");
    });

    it("queue 尚有項目時不提前 completed", () => {
      expect(
        decidePodStatusAfterTriggerSettlement(
          makeInstance("running", "settled", "not-applicable"),
          1,
        ),
      ).toBeNull();
    });

    it("未觸發狀態完成 skip settlement 時變 skipped，已觸發狀態變 completed", () => {
      expect(
        decidePodStatusAfterSkipSettlement(
          makeInstance("queued", "settled", "not-applicable"),
        ),
      ).toBe("skipped");
      expect(
        decidePodStatusAfterSkipSettlement(
          makeInstance("running", "settled", "not-applicable"),
        ),
      ).toBe("completed");
    });

    it("run queue 有活躍 stream 或空佇列時不處理，否則處理下一項", () => {
      expect(decideRunQueueSettlement(true, 1)).toBe(
        "wait-for-active-stream",
      );
      expect(decideRunQueueSettlement(false, 0)).toBe("empty");
      expect(decideRunQueueSettlement(false, 1)).toBe("process-next");
    });
  });
});
