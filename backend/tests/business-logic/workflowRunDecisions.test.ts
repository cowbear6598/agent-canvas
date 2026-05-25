import { describe, expect, it } from "vitest";
import {
  decideSummaryFallback,
  decideWorkflowSummary,
} from "../../src/services/workflow/workflowRunDecisions.js";

describe("workflowRunDecisions", () => {
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

  describe("workflow summary decision", () => {
    it("summary 成功時組出完成事件與已摘要結果", () => {
      expect(
        decideWorkflowSummary(
          true,
          "摘要內容",
          "claude-sonnet",
          "最後回覆",
          "無法生成摘要",
        ),
      ).toEqual({
        kind: "complete",
        event: "summary-complete",
        content: "摘要內容",
        isSummarized: true,
        resolvedModel: "claude-sonnet",
      });
    });

    it("summary 失敗但有 fallback 時仍組出完成事件且不標記為已摘要", () => {
      expect(
        decideWorkflowSummary(
          false,
          "",
          undefined,
          "最後回覆",
          "無法生成摘要",
        ),
      ).toEqual({
        kind: "complete",
        event: "summary-complete",
        content: "最後回覆",
        isSummarized: false,
      });
    });

    it("summary 失敗且沒有 fallback 時組出失敗事件", () => {
      expect(
        decideWorkflowSummary(false, "", undefined, null, "無法生成摘要"),
      ).toEqual({
        kind: "failed",
        event: "summary-failed",
        errorMessage: "無法生成摘要",
      });
    });
  });
});
