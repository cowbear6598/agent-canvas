import type { PersistedMessage } from "../../src/types";

let summaryPromptBuilder: any;

beforeAll(async () => {
  vi.resetModules();
  const module = await import("../../src/services/summaryPromptBuilder.js");
  summaryPromptBuilder = module.summaryPromptBuilder;
});

describe("SummaryPromptBuilder", () => {
  const mockMessages: PersistedMessage[] = [
    {
      id: "msg-1",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    },
    {
      id: "msg-2",
      role: "assistant",
      content: "Hi there!",
      timestamp: new Date().toISOString(),
    },
  ];

  const conversationHistory = "[User]: Hello\n\n[Assistant]: Hi there!";

  describe("buildUserPrompt 優先權規則", () => {
    it("有 targetPodCommand 時，使用 Command 內容篩選", () => {
      const context = {
        sourcePodName: "Source Pod",
        targetPodName: "Target Pod",
        targetPodCommand: "Review the code for bugs.",
        conversationHistory,
      };

      const result = summaryPromptBuilder.buildUserPrompt(context);

      expect(result).toContain("Source Pod");
      expect(result).toContain("Target Pod");
      expect(result).toContain("Review the code for bugs.");
      expect(result).toContain("指令內容");
    });

    it("沒有 targetPodCommand 時，使用預設完整摘要", () => {
      const context = {
        sourcePodName: "Source Pod",
        targetPodName: "Target Pod",
        targetPodCommand: null,
        conversationHistory,
      };

      const result = summaryPromptBuilder.buildUserPrompt(context);

      expect(result).toContain("Source Pod");
      expect(result).toContain("完整摘要");
      expect(result).not.toContain("指令內容");
    });

    it("targetPodCommand 為空字串時，視為沒有 Command，走預設完整摘要", () => {
      const context = {
        sourcePodName: "Source Pod",
        targetPodName: "Target Pod",
        targetPodCommand: "   ",
        conversationHistory,
      };

      const result = summaryPromptBuilder.buildUserPrompt(context);

      expect(result).toContain("完整摘要");
      expect(result).not.toContain("指令內容");
    });
  });

  describe("buildSystemPrompt", () => {
    it("使用預設的內容摘要助手 prompt", () => {
      const result = summaryPromptBuilder.buildSystemPrompt();

      expect(result).toContain("專業的內容摘要助手");
    });
  });

  describe("formatConversationHistory", () => {
    it("正確格式化訊息歷史", () => {
      const result =
        summaryPromptBuilder.formatConversationHistory(mockMessages);

      expect(result).toBe("[User]: Hello\n\n[Assistant]: Hi there!");
    });

    it("空陣列回傳空字串", () => {
      const result = summaryPromptBuilder.formatConversationHistory([]);

      expect(result).toBe("");
    });
  });
});
