let mockQueryGenerator: any;

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...original,
    query: vi.fn((...args: any[]) => mockQueryGenerator(...args)),
  };
});

vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: vi.fn(() => "/usr/local/bin/claude"),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { claudeService } from "../../src/services/claude/claudeService.js";
import * as claudeAgentSdk from "@anthropic-ai/claude-agent-sdk";

describe("ClaudeService", () => {
  beforeEach(() => {
    mockQueryGenerator = null;
    (claudeAgentSdk.query as any).mockClear();
  });

  describe("executeDisposableChat", () => {
    const defaultOptions = {
      systemPrompt: "你是一個助理",
      userMessage: "你好",
      workspacePath: "/workspace",
    };

    beforeEach(() => {
      mockQueryGenerator = async function* () {};
    });

    it("成功執行一次性 Chat：應回傳 { success: true, content }", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "你好，我是助理！" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          result: "你好，我是助理！",
        };
      };

      const result = await claudeService.executeDisposableChat(defaultOptions);

      expect(result.success).toBe(true);
      expect(result.content).toBe("你好，我是助理！");
      expect(result.error).toBeUndefined();
    });

    it("SDK 回傳 result:error 時應回傳 { success: false, error }", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "result",
          subtype: "error",
          errors: ["執行失敗", "權限不足"],
        };
      };

      const result = await claudeService.executeDisposableChat(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.error).toBe("執行失敗, 權限不足");
    });

    it("SDK 拋出例外時應回傳 { success: false, error } 而不是讓例外往上傳", async () => {
      mockQueryGenerator = async function* () {
        throw new Error("網路連線失敗");
        yield {};
      };

      const result = await claudeService.executeDisposableChat(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.error).toBe("網路連線失敗");
    });

    it("多個 assistant message 的文字應正確累加", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "第一段，" }],
          },
        };
        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "第二段，" }],
          },
        };
        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "第三段。" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          result: "最終結果",
        };
      };

      const result = await claudeService.executeDisposableChat(defaultOptions);

      expect(result.success).toBe(true);
      expect(result.content).toBe("最終結果");
    });
  });

  describe("executeMcpChat", () => {
    it("成功呼叫 query 並回傳 AsyncIterable stream", () => {
      const mockStream = (async function* () {
        yield { type: "result", subtype: "success", result: "MCP response" };
      })();

      mockQueryGenerator = () => mockStream;

      const result = claudeService.executeMcpChat({
        prompt: "MCP 測試訊息",
        systemPrompt: "你是 MCP 助理",
        cwd: "/mcp/workspace",
      });

      expect(claudeAgentSdk.query).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockStream);
    });

    it("應使用 buildBaseOptions 的共用 options（包含 pathToClaudeCodeExecutable、settingSources 等）", () => {
      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      claudeService.executeMcpChat({
        prompt: "測試",
        cwd: "/mcp/workspace",
        mcpServers: {
          testServer: { type: "stdio", command: "npx", args: ["test"] },
        },
        allowedTools: ["Read"],
        model: "claude-sonnet-4-5-20250929",
      });

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "測試",
          options: expect.objectContaining({
            cwd: "/mcp/workspace",
            settingSources: ["project"],
            permissionMode: "bypassPermissions",
            includePartialMessages: true,
            pathToClaudeCodeExecutable: "/usr/local/bin/claude",
            allowedTools: ["Read"],
            model: "claude-sonnet-4-5-20250929",
          }),
        }),
      );
    });
  });

  describe("buildBaseOptions 共用 options 一致性", () => {
    it("executeDisposableChat 呼叫 query() 時包含基礎 options", async () => {
      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      await claudeService.executeDisposableChat({
        systemPrompt: "測試",
        userMessage: "你好",
        workspacePath: "/workspace",
      });

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            settingSources: ["project"],
            permissionMode: "bypassPermissions",
            includePartialMessages: true,
            pathToClaudeCodeExecutable: "/usr/local/bin/claude",
          }),
        }),
      );
    });

    it("executeMcpChat 呼叫 query() 時包含基礎 options", () => {
      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      claudeService.executeMcpChat({
        prompt: "測試",
        cwd: "/mcp/workspace",
      });

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            settingSources: ["project"],
            permissionMode: "bypassPermissions",
            includePartialMessages: true,
            pathToClaudeCodeExecutable: "/usr/local/bin/claude",
          }),
        }),
      );
    });
  });
});
