/**
 * chatEmitStrategy 單元測試
 *
 * 移除 vi.mock("socketService")，改用 vi.spyOn 觀察 emitToCanvas 呼叫。
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { createChatEmitStrategy } from "../../src/services/chatEmitStrategy.js";
import { socketService } from "../../src/services/socketService.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";

describe("chatEmitStrategy", () => {
  const canvasId = "test-canvas";
  const podId = "test-pod";
  const messageId = "msg-001";

  beforeEach(() => {
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createChatEmitStrategy", () => {
    const runId = "test-run";

    it("emitText 應呼叫 emitToCanvas 帶 RUN_MESSAGE，payload 含 runId", () => {
      const strategy = createChatEmitStrategy(runId);
      strategy.emitText({ canvasId, podId, messageId, content: "Run 訊息" });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          runId,
          canvasId,
          podId,
          messageId,
          content: "Run 訊息",
          isPartial: true,
          role: "assistant",
        }),
      );
    });

    it("emitToolUse 應呼叫 emitToCanvas 帶 RUN_CHAT_TOOL_USE，payload 含 runId", () => {
      const strategy = createChatEmitStrategy(runId);
      strategy.emitToolUse({
        canvasId,
        podId,
        messageId,
        toolUseId: "tool-run-1",
        toolName: "Write",
        input: { content: "test" },
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CHAT_TOOL_USE,
        expect.objectContaining({
          runId,
          canvasId,
          podId,
          messageId,
          toolUseId: "tool-run-1",
          toolName: "Write",
        }),
      );
    });

    it("emitToolResult 應呼叫 emitToCanvas 帶 RUN_CHAT_TOOL_RESULT，payload 含 runId", () => {
      const strategy = createChatEmitStrategy(runId);
      strategy.emitToolResult({
        canvasId,
        podId,
        messageId,
        toolUseId: "tool-run-1",
        toolName: "Write",
        output: "成功寫入",
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CHAT_TOOL_RESULT,
        expect.objectContaining({
          runId,
          canvasId,
          podId,
          messageId,
          toolUseId: "tool-run-1",
          toolName: "Write",
          output: "成功寫入",
        }),
      );
    });

    it("emitComplete 應呼叫 emitToCanvas 帶 RUN_CHAT_COMPLETE，payload 含 runId", () => {
      const strategy = createChatEmitStrategy(runId);
      strategy.emitComplete({
        canvasId,
        podId,
        messageId,
        fullContent: "Run 完整內容",
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CHAT_COMPLETE,
        expect.objectContaining({
          runId,
          canvasId,
          podId,
          messageId,
          fullContent: "Run 完整內容",
        }),
      );
    });
  });
});
