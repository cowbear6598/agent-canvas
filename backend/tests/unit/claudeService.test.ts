import type { ContentBlock } from "../../src/types";

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

import {
  claudeService,
  resolveResumeSessionId,
  type StreamEvent,
} from "../../src/services/claude/claudeService.js";
import * as claudeAgentSdk from "@anthropic-ai/claude-agent-sdk";
import { podStore } from "../../src/services/podStore.js";
import { outputStyleService } from "../../src/services/outputStyleService.js";
import { logger } from "../../src/utils/logger.js";
import { config } from "../../src/config";

describe("ClaudeService", () => {
  let streamEvents: StreamEvent[];
  let originalRepositoriesRoot: string;

  let originalCanvasRoot: string;

  beforeEach(() => {
    streamEvents = [];
    mockQueryGenerator = null;

    originalRepositoriesRoot = config.repositoriesRoot;
    originalCanvasRoot = config.canvasRoot;
    (config as any).repositoriesRoot = "/test/repos";
    (config as any).canvasRoot = "/test/canvas";

    vi.spyOn(podStore, "getByIdGlobal").mockReturnValue(null as any);
    vi.spyOn(podStore, "setClaudeSessionId").mockImplementation(() => {});
    vi.spyOn(outputStyleService, "getContent").mockResolvedValue(null);
    vi.spyOn(logger, "log").mockImplementation(() => {});

    (claudeAgentSdk.query as any).mockClear();
  });

  afterEach(() => {
    (config as any).repositoriesRoot = originalRepositoriesRoot;
    (config as any).canvasRoot = originalCanvasRoot;
    vi.restoreAllMocks();
  });

  const createMockPod = (overrides = {}) => ({
    id: "test-pod-id",
    name: "Test Pod",
    model: "claude-sonnet-4-5-20250929" as const,
    claudeSessionId: null,
    repositoryId: null,
    workspacePath: "/test/canvas/workspace",
    commandId: null,
    outputStyleId: null,
    status: "idle" as const,
    pluginIds: [] as string[],
    ...overrides,
  });

  const onStreamCallback = (event: StreamEvent) => {
    streamEvents.push(event);
  };

  describe("sendMessage", () => {
    it("成功發送訊息並接收文字回應", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "new-session-123",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello, " }],
          },
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "how can I help?" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Hello, how can I help?",
        };
      };

      const result = await claudeService.sendMessage(
        "test-pod-id",
        "Hello",
        onStreamCallback,
      );

      expect(streamEvents).toHaveLength(3);
      expect(streamEvents[0]).toEqual({ type: "text", content: "Hello, " });
      expect(streamEvents[1]).toEqual({
        type: "text",
        content: "how can I help?",
      });
      expect(streamEvents[2]).toEqual({ type: "complete" });

      expect(result.role).toBe("assistant");
      expect(result.content).toBe("Hello, how can I help?");
      expect(result.podId).toBe("test-pod-id");

      expect(podStore.setClaudeSessionId).toHaveBeenCalledWith(
        "test-canvas",
        "test-pod-id",
        "new-session-123",
      );
    });

    it("成功發送訊息並接收工具使用回應", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "session-with-tool",
        };

        yield {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-123",
                name: "Read",
                input: { file_path: "/test/file.txt" },
              },
            ],
          },
        };

        yield {
          type: "tool_progress",
          tool_use_id: "tool-123",
          output: "File content here",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I read the file." }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "I read the file.",
        };
      };

      const result = await claudeService.sendMessage(
        "test-pod-id",
        "Read the file",
        onStreamCallback,
      );

      expect(streamEvents).toHaveLength(4);
      expect(streamEvents[0]).toEqual({
        type: "tool_use",
        toolUseId: "tool-123",
        toolName: "Read",
        input: { file_path: "/test/file.txt" },
      });
      expect(streamEvents[1]).toEqual({
        type: "tool_result",
        toolUseId: "tool-123",
        toolName: "Read",
        output: "File content here",
      });
      expect(streamEvents[2]).toEqual({
        type: "text",
        content: "I read the file.",
      });
      expect(streamEvents[3]).toEqual({ type: "complete" });

      expect(result.toolUse).toEqual({
        toolUseId: "tool-123",
        toolName: "Read",
        input: { file_path: "/test/file.txt" },
        output: "File content here",
      });
    });

    it("Pod 不存在時拋出錯誤", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      (podStore.getByIdGlobal as any).mockReturnValue(null);

      await expect(
        claudeService.sendMessage("nonexistent-pod", "Hello", onStreamCallback),
      ).rejects.toThrow("找不到 Pod nonexistent-pod");
    });

    it("session resume 錯誤時清除 session ID 並重試", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const { logger } = await import("../../src/utils/logger.js");
      const mockPod = createMockPod({
        claudeSessionId: "old-invalid-session",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      let callCount = 0;

      mockQueryGenerator = async function* () {
        callCount++;

        if (callCount === 1) {
          yield {
            type: "system",
            subtype: "init",
            session_id: "old-invalid-session",
          };

          yield {
            type: "result",
            subtype: "error",
            errors: ["Invalid session ID or session expired"],
          };
        } else {
          yield {
            type: "system",
            subtype: "init",
            session_id: "new-valid-session",
          };

          yield {
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Retry successful" }],
            },
          };

          yield {
            type: "result",
            subtype: "success",
            result: "Retry successful",
          };
        }
      };

      const result = await claudeService.sendMessage(
        "test-pod-id",
        "Test retry",
        onStreamCallback,
      );

      expect(logger.log).toHaveBeenCalledWith(
        "Chat",
        "Update",
        expect.stringContaining("Session 恢復失敗"),
      );

      expect(podStore.setClaudeSessionId).toHaveBeenCalledWith(
        "test-canvas",
        "test-pod-id",
        "",
      );

      expect(result.content).toBe("Retry successful");
      expect(callCount).toBe(2);
    });

    it("非 session 錯誤時直接拋出不重試", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "test-session",
        };

        yield {
          type: "result",
          subtype: "error",
          errors: ["Network error occurred"],
        };
      };

      await expect(
        claudeService.sendMessage("test-pod-id", "Test", onStreamCallback),
      ).rejects.toThrow("Network error occurred");

      expect(streamEvents[0]).toEqual({
        type: "text",
        content: "\n\n⚠️ 與 Claude 通訊時發生錯誤，請稍後再試",
      });

      const calls = (podStore.setClaudeSessionId as any).mock.calls || [];
      const hasEmptyStringCall = calls.some((call: any[]) => call[2] === "");
      expect(hasEmptyStringCall).toBe(false);
    });

    it("連續兩次 session error 時在第一次重試失敗後直接拋出", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const { logger } = await import("../../src/utils/logger.js");
      const mockPod = createMockPod({
        claudeSessionId: "old-invalid-session",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      let callCount = 0;

      mockQueryGenerator = async function* () {
        callCount++;

        yield {
          type: "system",
          subtype: "init",
          session_id: callCount === 1 ? "old-invalid-session" : "new-session",
        };

        yield {
          type: "result",
          subtype: "error",
          errors: ["Invalid session ID or session expired"],
        };
      };

      await expect(
        claudeService.sendMessage(
          "test-pod-id",
          "Test retry limit",
          onStreamCallback,
        ),
      ).rejects.toThrow("Invalid session ID or session expired");

      expect(callCount).toBe(2);

      expect(podStore.setClaudeSessionId).toHaveBeenCalledWith(
        "test-canvas",
        "test-pod-id",
        "",
      );

      expect(logger.log).toHaveBeenCalledWith(
        "Chat",
        "Update",
        expect.stringContaining("Session 恢復失敗"),
      );

      const textEvents = streamEvents.filter((e) => e.type === "text");
      expect(textEvents.length).toBeGreaterThan(0);
      expect(textEvents[textEvents.length - 1]).toEqual({
        type: "text",
        content: "\n\n⚠️ 與 Claude 通訊時發生錯誤，請稍後再試",
      });
    });

    it("正確轉換包含圖片的 ContentBlock[] 為 Claude 格式", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "image-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I see the image." }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "I see the image.",
        };
      };

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "What is in this image?" },
        {
          type: "image",
          mediaType: "image/png",
          base64Data:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      ];

      await claudeService.sendMessage(
        "test-pod-id",
        contentBlocks,
        onStreamCallback,
      );

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(Object),
          options: expect.objectContaining({
            cwd: "/test/canvas/workspace",
          }),
        }),
      );
    });

    it("處理包含多個圖片的 ContentBlock[]", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "multi-image-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I see multiple images." }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "I see multiple images.",
        };
      };

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "Compare these images:" },
        {
          type: "image",
          mediaType: "image/png",
          base64Data: "base64data1",
        },
        {
          type: "image",
          mediaType: "image/jpeg",
          base64Data: "base64data2",
        },
      ];

      const result = await claudeService.sendMessage(
        "test-pod-id",
        contentBlocks,
        onStreamCallback,
      );

      expect(result.content).toBe("I see multiple images.");
    });

    it("空文字區塊被過濾掉", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "empty-text-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Response" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Response",
        };
      };

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "   " },
        {
          type: "image",
          mediaType: "image/png",
          base64Data: "base64data",
        },
      ];

      const result = await claudeService.sendMessage(
        "test-pod-id",
        contentBlocks,
        onStreamCallback,
      );

      expect(result.content).toBe("Response");
    });

    it("所有內容為空時使用預設訊息", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "default-message-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "OK" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "OK",
        };
      };

      const contentBlocks: ContentBlock[] = [{ type: "text", text: "   " }];

      await claudeService.sendMessage(
        "test-pod-id",
        contentBlocks,
        onStreamCallback,
      );

      expect(claudeAgentSdk.query).toHaveBeenCalled();
    });

    it("Pod 有 commandId 時添加前綴到字串訊息", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod({
        commandId: "review",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "command-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Reviewing code..." }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Reviewing code...",
        };
      };

      await claudeService.sendMessage(
        "test-pod-id",
        "the code",
        onStreamCallback,
      );

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "/review the code",
        }),
      );
    });

    it("Pod 有 commandId 時添加前綴到 ContentBlock[] 的第一個文字區塊", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod({
        commandId: "analyze",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "analyze-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Analysis result" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Analysis result",
        };
      };

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "this image" },
        {
          type: "image",
          mediaType: "image/png",
          base64Data: "base64data",
        },
      ];

      await claudeService.sendMessage(
        "test-pod-id",
        contentBlocks,
        onStreamCallback,
      );

      expect(claudeAgentSdk.query).toHaveBeenCalled();
    });

    it("沒有 commandId 時不添加前綴", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod({
        commandId: null,
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "no-command-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Response" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Response",
        };
      };

      await claudeService.sendMessage(
        "test-pod-id",
        "normal message",
        onStreamCallback,
      );

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "normal message",
        }),
      );
    });

    it("空訊息搭配 commandId 時只添加 command 前綴", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod({
        commandId: "start",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "empty-with-command-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Started" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Started",
        };
      };

      await claudeService.sendMessage("test-pod-id", "", onStreamCallback);

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "/start ",
        }),
      );
    });

    it("有 repositoryId 時使用 repositories root 作為 cwd", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod({
        repositoryId: "my-repo",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "repo-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "OK" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "OK",
        };
      };

      await claudeService.sendMessage("test-pod-id", "test", onStreamCallback);

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            cwd: "/test/repos/my-repo",
          }),
        }),
      );
    });

    it("有 outputStyleId 時設定 systemPrompt", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const { outputStyleService } =
        await import("../../src/services/outputStyleService.js");
      const mockPod = createMockPod({
        outputStyleId: "style-123",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      (outputStyleService.getContent as any).mockResolvedValue(
        "Custom system prompt",
      );

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "style-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Styled response" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Styled response",
        };
      };

      await claudeService.sendMessage("test-pod-id", "test", onStreamCallback);

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            systemPrompt: "Custom system prompt",
          }),
        }),
      );
    });

    it("沒有 outputStyleId 時不設定 systemPrompt", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod({
        outputStyleId: null,
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "no-style-session",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Response" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Response",
        };
      };

      await claudeService.sendMessage("test-pod-id", "test", onStreamCallback);

      const callArgs = (claudeAgentSdk.query as any).mock.calls[0][0];
      expect(callArgs.options).not.toHaveProperty("systemPrompt");
    });

    it("repositoryId 含路徑穿越字元時應拋出錯誤", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const maliciousPod = createMockPod({
        repositoryId: "../../etc",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: maliciousPod,
      });

      await expect(
        claudeService.sendMessage("test-pod-id", "hello", onStreamCallback),
      ).rejects.toThrow("非法的工作目錄路徑");
    });

    it("workspacePath 超出 canvasRoot 時應拋出錯誤", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const maliciousPod = createMockPod({
        repositoryId: null,
        workspacePath: "/etc/passwd",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: maliciousPod,
      });

      await expect(
        claudeService.sendMessage("test-pod-id", "hello", onStreamCallback),
      ).rejects.toThrow("非法的工作目錄路徑");
    });

    it("有 claudeSessionId 時設定 resume 選項", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod({
        claudeSessionId: "existing-session-123",
      });

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "existing-session-123",
        };

        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Resumed conversation" }],
          },
        };

        yield {
          type: "result",
          subtype: "success",
          result: "Resumed conversation",
        };
      };

      await claudeService.sendMessage(
        "test-pod-id",
        "continue",
        onStreamCallback,
      );

      expect(claudeAgentSdk.query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: "existing-session-123",
          }),
        }),
      );
    });
  });

  describe("abortAllQueries", () => {
    it("有 active queries 時應中止所有並回傳正確數量", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod1 = createMockPod({ id: "pod-abort-all-1" });
      const mockPod2 = createMockPod({ id: "pod-abort-all-2" });

      (podStore.getByIdGlobal as any).mockImplementation((podId: string) => {
        if (podId === "pod-abort-all-1")
          return { canvasId: "test-canvas", pod: mockPod1 };
        if (podId === "pod-abort-all-2")
          return { canvasId: "test-canvas", pod: mockPod2 };
        return null;
      });

      let resolveStream1!: () => void;
      let resolveStream2!: () => void;
      const streamPromise1 = new Promise<void>((resolve) => {
        resolveStream1 = resolve;
      });
      const streamPromise2 = new Promise<void>((resolve) => {
        resolveStream2 = resolve;
      });

      mockQueryGenerator = async function* () {
        yield { type: "system", subtype: "init", session_id: "session-all-1" };
        await streamPromise1;
      };

      const sendPromise1 = claudeService.sendMessage(
        "pod-abort-all-1",
        "test1",
        onStreamCallback,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      mockQueryGenerator = async function* () {
        yield { type: "system", subtype: "init", session_id: "session-all-2" };
        await streamPromise2;
      };

      const sendPromise2 = claudeService.sendMessage(
        "pod-abort-all-2",
        "test2",
        onStreamCallback,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = claudeService.abortAllQueries();
      expect(count).toBe(2);

      resolveStream1();
      resolveStream2();
      await Promise.all([
        sendPromise1.catch(() => {}),
        sendPromise2.catch(() => {}),
      ]);
    });

    it("無 active queries 時應回傳 0", () => {
      const count = claudeService.abortAllQueries();
      expect(count).toBe(0);
    });
  });

  describe("abortQuery", () => {
    it("中止存在的查詢應回傳 true", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      let resolveStream!: () => void;
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve;
      });

      mockQueryGenerator = async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "abort-session",
        };

        await streamPromise;
      };

      const sendPromise = claudeService.sendMessage(
        "test-pod-id",
        "test",
        onStreamCallback,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      const aborted = claudeService.abortQuery("test-pod-id");
      expect(aborted).toBe(true);

      resolveStream();
      await sendPromise.catch(() => {});
    });

    it("中止不存在的查詢應回傳 false", () => {
      const result = claudeService.abortQuery("non-existent-pod");
      expect(result).toBe(false);
    });
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
    it("sendMessage 呼叫 query() 時包含基礎 options", async () => {
      const { podStore } = await import("../../src/services/podStore.js");
      const mockPod = createMockPod();

      (podStore.getByIdGlobal as any).mockReturnValue({
        canvasId: "test-canvas",
        pod: mockPod,
      });

      mockQueryGenerator = async function* () {
        yield { type: "system", subtype: "init", session_id: "session-1" };
        yield { type: "result", subtype: "success", result: "done" };
      };

      await claudeService.sendMessage("test-pod-id", "test", onStreamCallback);

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

describe("resolveResumeSessionId", () => {
  const podSessionId = "pod-global-session";

  it("Run mode + 無 sessionId：應回傳 null，不 fallback 到 pod session", () => {
    const result = resolveResumeSessionId(
      { queryKey: "run1:pod1" },
      podSessionId,
    );
    expect(result).toBeNull();
  });

  it("Run mode + 有 sessionId：應回傳 runOptions.sessionId", () => {
    const result = resolveResumeSessionId(
      { queryKey: "run1:pod1", sessionId: "session-abc" },
      podSessionId,
    );
    expect(result).toBe("session-abc");
  });

  it("Normal mode + runOptions 為 undefined：應 fallback 到 pod.claudeSessionId", () => {
    const result = resolveResumeSessionId(undefined, podSessionId);
    expect(result).toBe(podSessionId);
  });

  it("Normal mode + runOptions 無 sessionId（空物件）：應 fallback 到 pod.claudeSessionId", () => {
    const result = resolveResumeSessionId({}, podSessionId);
    expect(result).toBe(podSessionId);
  });

  it("Normal mode + 有 sessionId：應優先使用 runOptions.sessionId，不使用 pod session", () => {
    const result = resolveResumeSessionId(
      { sessionId: "session-xyz" },
      podSessionId,
    );
    expect(result).toBe("session-xyz");
  });

  it("Normal mode + pod.claudeSessionId 為 null：應回傳 null", () => {
    const result = resolveResumeSessionId(undefined, null);
    expect(result).toBeNull();
  });
});
