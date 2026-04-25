// Import 真實模組
import { summaryService } from "../../src/services/summaryService.js";
import { commandService } from "../../src/services/commandService.js";
import { podStore } from "../../src/services/podStore.js";
import { messageStore } from "../../src/services/messageStore.js";
import { runStore } from "../../src/services/runStore.js";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { summaryPromptBuilder } from "../../src/services/summaryPromptBuilder.js";
import { logger } from "../../src/utils/logger.js";
import type { RunContext } from "../../src/types/run.js";

describe("SummaryService", () => {
  const mockSourcePod = {
    id: "source-pod",
    name: "Source Pod",
    model: "claude-sonnet-4-5-20250929" as const,
    sessionId: null,
    repositoryId: null,
    workspacePath: "/test/workspace",
    commandId: null,
    status: "idle" as const,
  } as any;

  const mockTargetPod = {
    id: "target-pod",
    name: "Target Pod",
    model: "claude-sonnet-4-5-20250929" as const,
    sessionId: null,
    repositoryId: null,
    workspacePath: "/test/workspace",
    commandId: null,
    status: "idle" as const,
  } as any;

  const mockMessages: any[] = [
    {
      id: "msg-1",
      role: "user" as const,
      content: "Hello",
      timestamp: new Date().toISOString(),
    },
    {
      id: "msg-2",
      role: "assistant" as const,
      content: "Hi there!",
      timestamp: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    // commandService
    vi.spyOn(commandService, "getContent").mockResolvedValue(null);

    // podStore
    vi.spyOn(podStore, "getById").mockImplementation(
      (_canvasId: string, podId: string) => {
        if (podId === "source-pod") return mockSourcePod;
        if (podId === "target-pod") return mockTargetPod;
        return undefined;
      },
    );

    // messageStore
    vi.spyOn(messageStore, "getMessages").mockReturnValue(mockMessages);

    // runStore
    vi.spyOn(runStore, "getRunMessages").mockReturnValue(mockMessages);

    // claudeService
    vi.spyOn(claudeService, "executeDisposableChat").mockResolvedValue({
      success: true,
      content: "Summary result",
    });

    // summaryPromptBuilder
    vi.spyOn(summaryPromptBuilder, "formatConversationHistory").mockReturnValue(
      "[User]: Hello\n\n[Assistant]: Hi",
    );
    vi.spyOn(summaryPromptBuilder, "buildSystemPrompt").mockReturnValue(
      "System prompt",
    );
    vi.spyOn(summaryPromptBuilder, "buildUserPrompt").mockReturnValue(
      "User prompt",
    );

    // logger
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateSummaryForTarget Command 讀取邏輯", () => {
    it("Target Pod 有 commandId 時，正確讀取 Command 內容", async () => {
      const targetPodWithCommand = {
        ...mockTargetPod,
        commandId: "review-command",
      };

      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          if (podId === "target-pod") return targetPodWithCommand;
          return null;
        },
      );

      (commandService.getContent as any).mockResolvedValue(
        "Review the code carefully.",
      );

      await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(commandService.getContent).toHaveBeenCalledWith("review-command");
      expect(summaryPromptBuilder.buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPodCommand: "Review the code carefully.",
        }),
      );
    });

    it("Target Pod commandId 為 null 時，不讀取 Command", async () => {
      await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(commandService.getContent).not.toHaveBeenCalled();
      expect(summaryPromptBuilder.buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPodCommand: null,
        }),
      );
    });

    it("commandService.getContent 回傳 null 時，降級處理", async () => {
      const targetPodWithCommand = {
        ...mockTargetPod,
        commandId: "nonexistent-command",
      };

      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          if (podId === "target-pod") return targetPodWithCommand;
          return null;
        },
      );

      (commandService.getContent as any).mockResolvedValue(null);

      const result = await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(commandService.getContent).toHaveBeenCalledWith(
        "nonexistent-command",
      );
      expect(summaryPromptBuilder.buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPodCommand: null,
        }),
      );
      expect(result.success).toBe(true);
    });

    it("正確傳遞 targetPodCommand 至 buildUserPrompt", async () => {
      const targetPodWithCommand = {
        ...mockTargetPod,
        commandId: "analyze-command",
      };

      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          if (podId === "target-pod") return targetPodWithCommand;
          return null;
        },
      );

      (commandService.getContent as any).mockResolvedValue(
        "Analyze the performance.",
      );

      await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(summaryPromptBuilder.buildUserPrompt).toHaveBeenCalledWith({
        sourcePodName: "Source Pod",
        targetPodName: "Target Pod",
        targetPodCommand: "Analyze the performance.",
        conversationHistory: "[User]: Hello\n\n[Assistant]: Hi",
      });
    });
  });

  describe("generateSummaryForTarget runContext 訊息來源選擇", () => {
    const mockRunContext: RunContext = {
      runId: "run-1",
      canvasId: "canvas-1",
      sourcePodId: "source-pod",
    };

    it("有 runContext 時從 runStore 讀取訊息", async () => {
      await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
        mockRunContext,
      );

      expect(runStore.getRunMessages).toHaveBeenCalledWith(
        "run-1",
        "source-pod",
      );
      expect(messageStore.getMessages).not.toHaveBeenCalled();
    });

    it("沒有 runContext 時從 messageStore 讀取訊息", async () => {
      await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(messageStore.getMessages).toHaveBeenCalledWith("source-pod");
      expect(runStore.getRunMessages).not.toHaveBeenCalled();
    });

    it("有 runContext 但 run 內無訊息時回傳錯誤", async () => {
      (runStore.getRunMessages as any).mockReturnValue([]);

      const result = await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
        mockRunContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("沒有訊息記錄");
    });
  });

  describe("generateSummaryForTarget 使用傳入的 summaryModel 參數", () => {
    it("呼叫 executeDisposableChat 時帶入傳入的 summaryModel", async () => {
      await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
        undefined,
        "opus",
      );

      expect(claudeService.executeDisposableChat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "opus" }),
      );
    });
  });

  describe("generateSummaryForTarget 錯誤處理", () => {
    it("Source Pod 不存在時回傳錯誤", async () => {
      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "target-pod") return mockTargetPod;
          return null;
        },
      );

      const result = await summaryService.generateSummaryForTarget(
        "canvas-1",
        "nonexistent",
        "target-pod",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("找不到來源 Pod：nonexistent");
    });

    it("Target Pod 不存在時回傳錯誤", async () => {
      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          return null;
        },
      );

      const result = await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "nonexistent",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("找不到目標 Pod：nonexistent");
    });

    it("Source Pod 沒有訊息時回傳錯誤", async () => {
      (messageStore.getMessages as any).mockReturnValue([]);

      const result = await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("沒有訊息記錄");
    });

    it("claude 執行失敗但有 fallback 訊息時，應回傳 success: true 並使用 fallback 內容", async () => {
      (claudeService.executeDisposableChat as any).mockResolvedValue({
        success: false,
        error: "claude 發生錯誤",
      });

      const messagesWithAssistant: any[] = [
        {
          id: "msg-1",
          role: "user" as const,
          content: "Hello",
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-2",
          role: "assistant" as const,
          content: "fallback content",
          timestamp: new Date().toISOString(),
        },
      ];
      (messageStore.getMessages as any).mockReturnValue(messagesWithAssistant);

      const result = await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(result.success).toBe(true);
      expect(result.summary).toBe("fallback content");
    });

    it("claude 執行失敗且無 fallback 訊息時，應回傳 success: false", async () => {
      (claudeService.executeDisposableChat as any).mockResolvedValue({
        success: false,
        error: "some error",
      });

      const messagesWithoutAssistant: any[] = [
        {
          id: "msg-1",
          role: "user" as const,
          content: "Hello",
          timestamp: new Date().toISOString(),
        },
      ];
      (messageStore.getMessages as any).mockReturnValue(
        messagesWithoutAssistant,
      );

      const result = await summaryService.generateSummaryForTarget(
        "canvas-1",
        "source-pod",
        "target-pod",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("some error");
    });
  });
});
