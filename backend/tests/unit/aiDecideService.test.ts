// Mock @anthropic-ai/claude-agent-sdk，讓 createSdkMcpServer 保留 tools 供測試訪問
vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "@anthropic-ai/claude-agent-sdk",
  )) as any;
  return {
    ...actual,
    createSdkMcpServer: vi.fn((options: { name: string; tools?: any[] }) => ({
      type: "sdk",
      name: options.name,
      tools: options.tools ?? [],
    })),
  };
});

import { aiDecideService } from "../../src/services/workflow";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { podStore } from "../../src/services/podStore.js";
import { messageStore } from "../../src/services/messageStore.js";
import { runStore } from "../../src/services/runStore.js";
import { commandService } from "../../src/services/commandService.js";
import { summaryPromptBuilder } from "../../src/services/summaryPromptBuilder.js";
import { logger } from "../../src/utils/logger.js";
import type { Connection } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";

describe("AiDecideService", () => {
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

  const mockMessages = [
    {
      id: "msg-1",
      podId: "source-pod",
      role: "user" as const,
      content: "Analyze this data",
      timestamp: new Date().toISOString(),
      toolUse: null,
    },
    {
      id: "msg-2",
      podId: "source-pod",
      role: "assistant" as const,
      content: "Analysis complete: found 3 issues",
      timestamp: new Date().toISOString(),
      toolUse: null,
    },
  ];

  const mockConnection: Connection = {
    id: "conn-1",
    sourcePodId: "source-pod",
    sourceAnchor: "right",
    targetPodId: "target-pod",
    targetAnchor: "left",
    triggerMode: "ai-decide",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    aiDecideModel: "sonnet",
  };

  beforeEach(() => {
    // podStore
    vi.spyOn(podStore, "getById").mockImplementation(
      (canvasId: string, podId: string) => {
        if (podId === "source-pod") return mockSourcePod;
        if (podId === "target-pod") return mockTargetPod;
        return undefined;
      },
    );

    // messageStore
    vi.spyOn(messageStore, "getMessages").mockReturnValue(mockMessages);

    // runStore
    vi.spyOn(runStore, "getRunMessages").mockReturnValue(mockMessages);

    // commandService
    vi.spyOn(commandService, "getContent").mockResolvedValue(null);

    // claudeService
    vi.spyOn(claudeService, "executeDisposableChat").mockResolvedValue({
      success: true,
      content: "Summary: Analysis found 3 issues",
    });

    // summaryPromptBuilder
    vi.spyOn(summaryPromptBuilder, "formatConversationHistory").mockReturnValue(
      "[User]: Hello\n\n[Assistant]: Hi",
    );

    // logger
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});

    vi.spyOn(claudeService, "executeMcpChat").mockReturnValue(
      (async function* () {
        yield { type: "result", subtype: "success" };
      })() as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AI Decide 單一 connection 判斷為觸發（shouldTrigger = true）", () => {
    it("正確回傳 shouldTrigger: true 和 reason", async () => {
      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                {
                  connectionId: "conn-1",
                  shouldTrigger: true,
                  reason: "上游分析結果與下游需求相關",
                },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].connectionId).toBe("conn-1");
      expect(result.results[0].shouldTrigger).toBe(true);
      expect(result.results[0].reason).toBe("上游分析結果與下游需求相關");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("AI Decide 單一 connection 判斷為不觸發（shouldTrigger = false），包含 reason", () => {
    it("正確回傳 shouldTrigger: false 和 reason", async () => {
      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                {
                  connectionId: "conn-1",
                  shouldTrigger: false,
                  reason: "上游產出與下游任務無關",
                },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].connectionId).toBe("conn-1");
      expect(result.results[0].shouldTrigger).toBe(false);
      expect(result.results[0].reason).toBe("上游產出與下游任務無關");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("AI Decide 批次判斷多條 connections，全部觸發", () => {
    it("正確回傳所有 connections 的判斷結果", async () => {
      const mockConnection2: Connection = {
        ...mockConnection,
        id: "conn-2",
        targetPodId: "target-pod-2",
      };
      const mockConnection3: Connection = {
        ...mockConnection,
        id: "conn-3",
        targetPodId: "target-pod-3",
      };

      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          if (podId.startsWith("target-pod"))
            return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
          return null;
        },
      );

      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                {
                  connectionId: "conn-1",
                  shouldTrigger: true,
                  reason: "相關任務 1",
                },
                {
                  connectionId: "conn-2",
                  shouldTrigger: true,
                  reason: "相關任務 2",
                },
                {
                  connectionId: "conn-3",
                  shouldTrigger: true,
                  reason: "相關任務 3",
                },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection, mockConnection2, mockConnection3],
      );

      expect(result.results).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(claudeService.executeMcpChat).toHaveBeenCalledTimes(1); // 批次處理，只呼叫一次
    });
  });

  describe("AI Decide 批次判斷多條 connections，部分觸發部分不觸發", () => {
    it("正確回傳混合的判斷結果", async () => {
      const mockConnection2: Connection = {
        ...mockConnection,
        id: "conn-2",
        targetPodId: "target-pod-2",
      };

      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          if (podId.startsWith("target-pod"))
            return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
          return null;
        },
      );

      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                {
                  connectionId: "conn-1",
                  shouldTrigger: true,
                  reason: "相關任務",
                },
                {
                  connectionId: "conn-2",
                  shouldTrigger: false,
                  reason: "不相關任務",
                },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection, mockConnection2],
      );

      expect(result.results).toHaveLength(2);
      expect(result.results[0].shouldTrigger).toBe(true);
      expect(result.results[1].shouldTrigger).toBe(false);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("AI Decide 批次判斷中缺少某條 connection 的結果（部分失敗）", () => {
    it("缺少結果的 connection 進入 errors 陣列", async () => {
      const mockConnection2: Connection = {
        ...mockConnection,
        id: "conn-2",
        targetPodId: "target-pod-2",
      };
      const mockConnection3: Connection = {
        ...mockConnection,
        id: "conn-3",
        targetPodId: "target-pod-3",
      };

      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          if (podId.startsWith("target-pod"))
            return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
          return null;
        },
      );

      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            // 只回傳 2 條結果，conn-3 缺失
            await decideTool.handler({
              decisions: [
                {
                  connectionId: "conn-1",
                  shouldTrigger: true,
                  reason: "相關任務 1",
                },
                {
                  connectionId: "conn-2",
                  shouldTrigger: false,
                  reason: "不相關任務 2",
                },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection, mockConnection2, mockConnection3],
      );

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-3");
      expect(result.errors[0].error).toBe("此連線未獲得 AI 決策結果");
    });
  });

  describe("Claude API 請求失敗時的錯誤處理", () => {
    it("所有 connections 進入 errors 陣列", async () => {
      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(() => {
        throw new Error("Claude API Error");
      });

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
      );

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-1");
      expect(result.errors[0].error).toContain("Claude API Error");
    });
  });

  describe("Custom Tool handler 未被呼叫時的錯誤處理", () => {
    it("所有 connections 進入 errors 陣列", async () => {
      // Mock executeMcpChat 但不呼叫 tool handler
      vi.spyOn(claudeService, "executeMcpChat").mockReturnValue(
        (async function* () {
          yield { type: "result", subtype: "success" };
        })() as any,
      );

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
      );

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-1");
      expect(result.errors[0].error).toBe("AI 決策工具未被執行");
    });
  });

  describe("正確組裝 prompt（包含 source 摘要、target Command）", () => {
    it("傳給 executeMcpChat 的 options 包含正確資訊", async () => {
      const targetPodWithResources = {
        ...mockTargetPod,
        commandId: "command-1",
      };

      (podStore.getById as any).mockImplementation(
        (canvasId: string, podId: string) => {
          if (podId === "source-pod") return mockSourcePod;
          if (podId === "target-pod") return targetPodWithResources;
          return null;
        },
      );

      (commandService.getContent as any).mockResolvedValue(
        "Review the code for bugs.",
      );

      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      await aiDecideService.decideConnections("canvas-1", "source-pod", [
        mockConnection,
      ]);

      expect(claudeService.executeMcpChat).toHaveBeenCalledTimes(1);
      const callOptions = (claudeService.executeMcpChat as any).mock
        .calls[0][0];

      expect(callOptions.prompt).toContain("Target Pod");
      expect(callOptions.systemPrompt).toContain("Workflow 觸發判斷者");
      expect(commandService.getContent).toHaveBeenCalledWith("command-1");
    });
  });

  describe("空的 ai-decide connections 陣列時直接回傳空結果", () => {
    it("不呼叫 Claude API，直接回傳空結果", async () => {
      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [],
      );

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(claudeService.executeMcpChat).not.toHaveBeenCalled();
    });
  });

  describe("executeDecision 使用 connection.aiDecideModel", () => {
    it("executeMcpChat 呼叫時帶入 connection.aiDecideModel", async () => {
      const connectionWithHaiku: Connection = {
        ...mockConnection,
        aiDecideModel: "haiku",
      };

      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      await aiDecideService.decideConnections("canvas-1", "source-pod", [
        connectionWithHaiku,
      ]);

      expect(claudeService.executeMcpChat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "haiku" }),
      );
    });
  });

  describe("generateSourceSummary 使用 connection.summaryModel", () => {
    it("generateSourceSummary 中 executeDisposableChat 帶入 connection.summaryModel", async () => {
      const connectionWithOpus: Connection = {
        ...mockConnection,
        summaryModel: "opus",
      };

      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      await aiDecideService.decideConnections("canvas-1", "source-pod", [
        connectionWithOpus,
      ]);

      expect(claudeService.executeDisposableChat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "opus" }),
      );
    });
  });

  describe("run 模式：generateSourceSummary 從 runStore 讀取訊息", () => {
    const mockRunContext: RunContext = {
      runId: "run-1",
      canvasId: "canvas-1",
      sourcePodId: "source-pod",
    };

    it("有 runContext 時從 runStore 讀取訊息，不呼叫 messageStore", async () => {
      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
        mockRunContext,
      );

      expect(runStore.getRunMessages).toHaveBeenCalledWith(
        "run-1",
        "source-pod",
      );
      expect(messageStore.getMessages).not.toHaveBeenCalled();
    });

    it("沒有 runContext 時從 messageStore 讀取訊息，不呼叫 runStore", async () => {
      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      await aiDecideService.decideConnections("canvas-1", "source-pod", [
        mockConnection,
      ]);

      expect(messageStore.getMessages).toHaveBeenCalledWith("source-pod");
      expect(runStore.getRunMessages).not.toHaveBeenCalled();
    });

    it("run 模式摘要失敗時，fallback 從 runStore 讀取最後一則 assistant 訊息", async () => {
      const runMessages = [
        {
          id: "rm-1",
          role: "user" as const,
          content: "請分析",
          timestamp: new Date().toISOString(),
        },
        {
          id: "rm-2",
          role: "assistant" as const,
          content: "run 模式分析結果",
          timestamp: new Date().toISOString(),
        },
      ];
      (runStore.getRunMessages as any).mockReturnValue(runMessages);

      vi.spyOn(claudeService, "executeDisposableChat").mockResolvedValue({
        success: false,
        content: "",
        error: "摘要失敗",
      });

      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
        (options: any) => {
          return (async function* () {
            const mcpServer = options.mcpServers["ai-decide"];
            const decideTool = mcpServer.tools[0];

            await decideTool.handler({
              decisions: [
                {
                  connectionId: "conn-1",
                  shouldTrigger: true,
                  reason: "備用摘要判斷",
                },
              ],
            });

            yield { type: "result", subtype: "success" };
          })() as any;
        },
      );

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
        mockRunContext,
      );

      expect(result.errors).toHaveLength(0);
      expect(result.results[0].shouldTrigger).toBe(true);

      const callOptions = (claudeService.executeMcpChat as any).mock
        .calls[0][0];
      expect(callOptions.prompt).toContain("run 模式分析結果");
    });

    it("run 模式下 runStore 回傳空訊息時應回傳錯誤", async () => {
      (runStore.getRunMessages as any).mockReturnValue([]);

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
        mockRunContext,
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-1");
      expect(claudeService.executeMcpChat).not.toHaveBeenCalled();
    });

    it("run 模式摘要失敗且無 assistant 訊息時應回傳錯誤", async () => {
      const runMessages = [
        {
          id: "rm-1",
          role: "user" as const,
          content: "請分析",
          timestamp: new Date().toISOString(),
        },
      ];
      (runStore.getRunMessages as any).mockReturnValue(runMessages);

      vi.spyOn(claudeService, "executeDisposableChat").mockResolvedValue({
        success: false,
        content: "",
        error: "摘要失敗",
      });

      const result = await aiDecideService.decideConnections(
        "canvas-1",
        "source-pod",
        [mockConnection],
        mockRunContext,
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-1");
      expect(claudeService.executeMcpChat).not.toHaveBeenCalled();
    });
  });
});
