import {
  aiDecidePromptBuilder,
  type AiDecidePromptContext,
} from "../../src/services/workflow/aiDecidePromptBuilder.js";

describe("AiDecidePromptBuilder", () => {
  describe("buildSystemPrompt 包含正確的角色定義", () => {
    it("回傳包含 Workflow 觸發判斷者角色定義的系統提示詞", () => {
      const result = aiDecidePromptBuilder.buildSystemPrompt();

      expect(result).toContain("Workflow 觸發判斷者");
      expect(result).toContain("上游任務");
      expect(result).toContain("下游任務");
      expect(result).toContain("判斷標準");
    });
  });

  describe("buildUserPrompt 帶入 source 摘要內容", () => {
    it("正確包含 source Pod 名稱和摘要", () => {
      const context: AiDecidePromptContext = {
        sourcePodName: "Analysis Pod",
        sourceSummary: "Completed analysis of 100 records, found 5 issues.",
        targets: [
          {
            connectionId: "conn-1",
            targetPodId: "target-1",
            targetPodName: "Review Pod",
            targetPodCommand: null,
          },
        ],
      };

      const result = aiDecidePromptBuilder.buildUserPrompt(context);

      expect(result).toContain("Analysis Pod");
      expect(result).toContain(
        "Completed analysis of 100 records, found 5 issues.",
      );
      expect(result).toContain("Review Pod");
    });
  });

  describe("buildUserPrompt 帶入單一 target Pod 的 Command", () => {
    it("正確包含 Command 資訊", () => {
      const context: AiDecidePromptContext = {
        sourcePodName: "Source Pod",
        sourceSummary: "Task completed successfully.",
        targets: [
          {
            connectionId: "conn-1",
            targetPodId: "target-1",
            targetPodName: "Target Pod",
            targetPodCommand: "Review the code for security vulnerabilities.",
          },
        ],
      };

      const result = aiDecidePromptBuilder.buildUserPrompt(context);

      expect(result).toContain("Review the code for security vulnerabilities.");
      expect(result).toContain("Command");
      expect(result).toContain("conn-1");
    });
  });

  describe("buildUserPrompt 帶入多個 target Pod 的資訊", () => {
    it("正確包含所有 target Pods 的資訊", () => {
      const context: AiDecidePromptContext = {
        sourcePodName: "Source Pod",
        sourceSummary: "Analysis complete.",
        targets: [
          {
            connectionId: "conn-1",
            targetPodId: "target-1",
            targetPodName: "Review Pod",
            targetPodCommand: "Review the code.",
          },
          {
            connectionId: "conn-2",
            targetPodId: "target-2",
            targetPodName: "Test Pod",
            targetPodCommand: "Run tests.",
          },
          {
            connectionId: "conn-3",
            targetPodId: "target-3",
            targetPodName: "Deploy Pod",
            targetPodCommand: null,
          },
        ],
      };

      const result = aiDecidePromptBuilder.buildUserPrompt(context);

      expect(result).toContain("Review Pod");
      expect(result).toContain("Test Pod");
      expect(result).toContain("Deploy Pod");

      expect(result).toContain("conn-1");
      expect(result).toContain("conn-2");
      expect(result).toContain("conn-3");

      expect(result).toContain("Review the code.");
      expect(result).toContain("Run tests.");
    });
  });

  describe("target Pod 沒有 Command 時的降級處理", () => {
    it("正確顯示「無」標記", () => {
      const context: AiDecidePromptContext = {
        sourcePodName: "Source Pod",
        sourceSummary: "Task done.",
        targets: [
          {
            connectionId: "conn-1",
            targetPodId: "target-1",
            targetPodName: "Simple Target",
            targetPodCommand: null,
          },
        ],
      };

      const result = aiDecidePromptBuilder.buildUserPrompt(context);

      expect(result).toContain("Simple Target");
      expect(result).toContain("Command：無");
    });

    it("包含使用 decide_triggers tool 的指示", () => {
      const context: AiDecidePromptContext = {
        sourcePodName: "Source Pod",
        sourceSummary: "Task done.",
        targets: [
          {
            connectionId: "conn-1",
            targetPodId: "target-1",
            targetPodName: "Target Pod",
            targetPodCommand: null,
          },
        ],
      };

      const result = aiDecidePromptBuilder.buildUserPrompt(context);

      expect(result).toContain("decide_triggers");
      expect(result).toContain("shouldTrigger");
      expect(result).toContain("reason");
    });
  });
});
