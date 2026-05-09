/**
 * branchPromptBuilder 單元測試（Phase 6A 對齊）
 *
 * 原 aiDecidePromptBuilder.test.ts 已對齊至新 branchPromptBuilder。
 */

import { describe, it, expect } from "vitest";
import { branchPromptBuilder } from "../../src/services/workflow/branchPromptBuilder.js";

describe("BranchPromptBuilder", () => {
  describe("buildSystemPrompt 包含正確的角色定義", () => {
    it("回傳包含 branch decision selector 角色定義的系統提示詞", () => {
      const result = branchPromptBuilder.buildSystemPrompt();

      expect(result).toContain("branch decision selector");
      expect(result).toContain("selectedLabel");
      expect(result).toContain("None");
    });
  });

  describe("buildUserPrompt 帶入 source 訊息內容", () => {
    it("正確包含 source Pod 名稱和訊息", () => {
      const result = branchPromptBuilder.buildUserPrompt({
        sourcePodName: "Analysis Pod",
        recentMessages: [
          {
            id: "m1",
            role: "assistant",
            content: "Analysis complete: found 3 issues.",
            timestamp: new Date().toISOString(),
          },
        ],
        branches: [
          {
            label: "Checklist",
            targetPodName: "Review Pod",
          },
        ],
      });

      expect(result).toContain("Analysis Pod");
      expect(result).toContain("Analysis complete: found 3 issues.");
      expect(result).toContain("Review Pod");
    });
  });

  describe("buildUserPrompt 帶入多個 branch 的資訊", () => {
    it("正確包含所有 branch 的 label 和 targetPodName", () => {
      const result = branchPromptBuilder.buildUserPrompt({
        sourcePodName: "Source Pod",
        recentMessages: [
          {
            id: "m1",
            role: "user",
            content: "Run tests.",
            timestamp: new Date().toISOString(),
          },
        ],
        branches: [
          { label: "Review", targetPodName: "Review Pod" },
          { label: "Test", targetPodName: "Test Pod" },
          {
            label: "Deploy",
            description: "Deploy to staging",
            targetPodName: "Deploy Pod",
          },
        ],
      });

      expect(result).toContain("Review");
      expect(result).toContain("Test");
      expect(result).toContain("Deploy");
      expect(result).toContain("Review Pod");
      expect(result).toContain("Test Pod");
      expect(result).toContain("Deploy Pod");
      expect(result).toContain("Deploy to staging");
    });
  });

  describe("branch 沒有 description 時的降級處理", () => {
    it("正確顯示無 description 的 branch，不出現空說明", () => {
      const result = branchPromptBuilder.buildUserPrompt({
        sourcePodName: "Source Pod",
        recentMessages: [
          {
            id: "m1",
            role: "assistant",
            content: "Task done.",
            timestamp: new Date().toISOString(),
          },
        ],
        branches: [{ label: "Simple", targetPodName: "Simple Target" }],
      });

      expect(result).toContain("Simple Target");
      expect(result).toContain("Simple");
      // 應包含 selectedLabel JSON 格式指示
      expect(result).toContain("selectedLabel");
    });
  });
});
