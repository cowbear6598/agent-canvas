import type { Mock } from "vitest";

vi.mock("../../src/services/claude/claudeService.js", () => ({
  claudeService: {
    sendMessage: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: vi.fn(() => {}),
  },
}));

vi.mock("../../src/services/messageStore.js", () => ({
  messageStore: {
    upsertMessage: vi.fn(() => {}),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    setStatus: vi.fn(() => {}),
    getById: vi.fn(() => undefined),
    getByIdGlobal: vi.fn(() => undefined),
    setClaudeSessionId: vi.fn(() => {}),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
}));

vi.mock("../../src/services/workflow/runExecutionService.js", () => ({
  runExecutionService: {
    registerActiveStream: vi.fn(() => {}),
    unregisterActiveStream: vi.fn(() => {}),
    errorPodInstance: vi.fn(() => {}),
  },
}));

vi.mock("../../src/services/runStore.js", () => ({
  runStore: {
    getPodInstance: vi.fn(() => undefined),
    upsertRunMessage: vi.fn(() => {}),
    updatePodInstanceClaudeSessionId: vi.fn(() => {}),
  },
}));

import { executeStreamingChat } from "../../src/services/claude/streamingChatExecutor.js";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { socketService } from "../../src/services/socketService.js";
import { messageStore } from "../../src/services/messageStore.js";
import { podStore } from "../../src/services/podStore.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { logger } from "../../src/utils/logger.js";
import { WebSocketResponseEvents } from "../../src/schemas";
import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { NormalModeExecutionStrategy } from "../../src/services/normalExecutionStrategy.js";
import { RunModeExecutionStrategy } from "../../src/services/executionStrategy.js";
import type { RunContext } from "../../src/types/run.js";

/** 取得 mock 函式的型別化引用，避免重複的 `as Mock<any>` 轉型 */
function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

describe("executeStreamingChat", () => {
  const canvasId = "test-canvas";
  const podId = "test-pod";
  const message = "test message";

  /** 建立測試用的 Normal mode strategy */
  function makeStrategy() {
    return new NormalModeExecutionStrategy(canvasId);
  }

  // Helper: 設定 sendMessage mock 來產生特定事件序列
  function mockSendMessageWithEvents(
    events: Array<{ type: string; [key: string]: unknown }>,
  ) {
    asMock(claudeService.sendMessage).mockImplementation(
      async (...args: any[]) => {
        const callback = args[2] as (event: any) => void;
        for (const event of events) {
          callback(event);
        }
        return {};
      },
    );
  }

  // Helper: 設定 sendMessage mock 拋出 AbortError
  function mockSendMessageWithAbort(
    eventsBeforeAbort: Array<{ type: string; [key: string]: unknown }> = [],
  ) {
    asMock(claudeService.sendMessage).mockImplementation(
      async (...args: any[]) => {
        const callback = args[2] as (event: any) => void;
        for (const event of eventsBeforeAbort) {
          callback(event);
        }
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      },
    );
  }

  // Helper: 設定 sendMessage mock 拋出一般錯誤
  function mockSendMessageWithError(error: Error) {
    asMock(claudeService.sendMessage).mockImplementation(async () => {
      throw error;
    });
  }

  beforeEach(() => {
    // 重置所有 mock
    asMock(claudeService.sendMessage).mockClear();
    asMock(socketService.emitToCanvas).mockClear();
    asMock(messageStore.upsertMessage).mockClear();
    asMock(podStore.setStatus).mockClear();
    asMock(logger.log).mockClear();
    asMock(logger.error).mockClear();

    asMock(claudeService.sendMessage).mockImplementation(() =>
      Promise.resolve({}),
    );
  });

  describe("streaming event 處理", () => {
    it("text event 正確累積內容並廣播 POD_CLAUDE_CHAT_MESSAGE", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
        { type: "complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledTimes(3); // 2 text + 1 complete

      expect(socketService.emitToCanvas).toHaveBeenNthCalledWith(
        1,
        canvasId,
        WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
        expect.objectContaining({
          canvasId,
          podId,
          messageId: expect.any(String),
          content: "Hello",
          isPartial: true,
          role: "assistant",
        }),
      );

      expect(socketService.emitToCanvas).toHaveBeenNthCalledWith(
        2,
        canvasId,
        WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
        expect.objectContaining({
          canvasId,
          podId,
          messageId: expect.any(String),
          content: "Hello World",
          isPartial: true,
          role: "assistant",
        }),
      );

      expect(result.content).toBe("Hello World");
      expect(result.hasContent).toBe(true);
      expect(result.aborted).toBe(false);
    });

    it("tool_use event 正確處理並廣播 POD_CHAT_TOOL_USE", async () => {
      mockSendMessageWithEvents([
        {
          type: "tool_use",
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
        { type: "complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_TOOL_USE,
        expect.objectContaining({
          canvasId,
          podId,
          messageId: expect.any(String),
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        }),
      );
    });

    it("tool_result event 正確處理並廣播 POD_CHAT_TOOL_RESULT", async () => {
      mockSendMessageWithEvents([
        {
          type: "tool_use",
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
        {
          type: "tool_result",
          toolUseId: "tu1",
          toolName: "Read",
          output: "file content",
        },
        { type: "complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_TOOL_RESULT,
        expect.objectContaining({
          canvasId,
          podId,
          messageId: expect.any(String),
          toolUseId: "tu1",
          toolName: "Read",
          output: "file content",
        }),
      );
    });

    it("complete event 觸發 flush 並廣播 POD_CHAT_COMPLETE", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Hello" },
        { type: "complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_COMPLETE,
        expect.objectContaining({
          canvasId,
          podId,
          messageId: expect.any(String),
          fullContent: "Hello",
        }),
      );
    });

    it("每個 streaming event 都呼叫 persistStreamingMessage（upsert）", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Hello" },
        {
          type: "tool_use",
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
        {
          type: "tool_result",
          toolUseId: "tu1",
          toolName: "Read",
          output: "file content",
        },
        { type: "complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // streaming 中 3 次（text, tool_use, tool_result）+ 完成後最終 persist 1 次
      expect(messageStore.upsertMessage).toHaveBeenCalledTimes(4);
    });

    it("error event 記錄 logger 但不中斷", async () => {
      mockSendMessageWithEvents([
        { type: "error", error: "測試錯誤" },
        { type: "text", content: "Hello" },
        { type: "complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(logger.error).toHaveBeenCalledWith(
        "Chat",
        "Error",
        "Pod test-pod streaming 過程發生錯誤",
      );

      expect(result.hasContent).toBe(true);
      expect(result.content).toBe("Hello");
    });
  });

  describe("成功完成", () => {
    it("完成後正確呼叫 upsertMessage + setStatus idle", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Hello" },
        { type: "complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(messageStore.upsertMessage).toHaveBeenCalled();
      expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, "idle");
    });

    it("完成後正確呼叫 onComplete callback", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Hello" },
        { type: "complete" },
      ]);

      const onComplete = vi.fn(() => {});

      await executeStreamingChat(
        {
          canvasId,
          podId,
          message,
          abortable: false,
          strategy: makeStrategy(),
        },
        {
          onComplete,
        },
      );

      expect(onComplete).toHaveBeenCalledWith(canvasId, podId);
    });

    it("無 assistant content 時不呼叫 upsertMessage", async () => {
      mockSendMessageWithEvents([{ type: "complete" }]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(messageStore.upsertMessage).not.toHaveBeenCalled();
      expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, "idle");
    });
  });

  describe("AbortError 處理", () => {
    it("AbortError + abortable=true 時正確處理", async () => {
      mockSendMessageWithAbort([{ type: "text", content: "Hello" }]);

      const onAborted = vi.fn(() => {});

      const result = await executeStreamingChat(
        {
          canvasId,
          podId,
          message,
          abortable: true,
          strategy: makeStrategy(),
        },
        {
          onAborted,
        },
      );

      expect(result.aborted).toBe(true);
      expect(result.content).toBe("Hello");
      expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, "idle");
      expect(messageStore.upsertMessage).toHaveBeenCalled();
      expect(onAborted).toHaveBeenCalledWith(
        canvasId,
        podId,
        expect.any(String),
      );
    });

    it("AbortError + abortable=false 時 re-throw", async () => {
      mockSendMessageWithAbort();

      const onAborted = vi.fn(() => {});

      await expect(
        executeStreamingChat(
          {
            canvasId,
            podId,
            message,
            abortable: false,
            strategy: makeStrategy(),
          },
          {
            onAborted,
          },
        ),
      ).rejects.toThrow("查詢已被中斷");

      expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, "idle");
      expect(onAborted).not.toHaveBeenCalled();
    });

    it("SDK AbortError 實例也正確處理", async () => {
      asMock(claudeService.sendMessage).mockImplementation(
        async (...args: any[]) => {
          const callback = args[2] as (event: any) => void;
          callback({ type: "text", content: "Hello" });
          throw new AbortError("SDK abort");
        },
      );

      const onAborted = vi.fn(() => {});

      const result = await executeStreamingChat(
        {
          canvasId,
          podId,
          message,
          abortable: true,
          strategy: makeStrategy(),
        },
        {
          onAborted,
        },
      );

      expect(result.aborted).toBe(true);
      expect(onAborted).toHaveBeenCalled();
    });
  });

  describe("一般錯誤處理", () => {
    it("一般錯誤時呼叫 onError callback 並 re-throw", async () => {
      const testError = new Error("Claude API 錯誤");
      mockSendMessageWithError(testError);

      const onError = vi.fn(() => {});

      await expect(
        executeStreamingChat(
          {
            canvasId,
            podId,
            message,
            abortable: false,
            strategy: makeStrategy(),
          },
          {
            onError,
          },
        ),
      ).rejects.toThrow("Claude API 錯誤");

      expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, "idle");
      expect(onError).toHaveBeenCalledWith(
        canvasId,
        podId,
        expect.objectContaining({ message: "Claude API 錯誤" }),
      );
    });
  });

  describe("Run mode (RunModeExecutionStrategy)", () => {
    const runId = "test-run-id";
    const runContext: RunContext = {
      runId,
      canvasId,
      sourcePodId: "source-pod",
    };

    /** 建立測試用的 Run mode strategy */
    function makeRunStrategy() {
      return new RunModeExecutionStrategy(canvasId, runContext);
    }

    beforeEach(() => {
      // 重置 run mode 相關的 mock
      asMock(runExecutionService.registerActiveStream).mockClear();
      asMock(runExecutionService.unregisterActiveStream).mockClear();
      asMock(runExecutionService.errorPodInstance).mockClear();
      asMock(runStore.getPodInstance).mockClear();
      asMock(runStore.upsertRunMessage).mockClear();
      asMock(runStore.updatePodInstanceClaudeSessionId).mockClear();
    });

    it("正常串流完成：呼叫 onStreamStart → sendMessage → onStreamComplete", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Run 回應" },
        { type: "complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      // onStreamStart：向 runExecutionService 註冊 active stream
      expect(runExecutionService.registerActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );

      // sendMessage 應被呼叫
      expect(claudeService.sendMessage).toHaveBeenCalled();

      // onStreamComplete：取消註冊 active stream
      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );

      expect(result.content).toBe("Run 回應");
      expect(result.aborted).toBe(false);
    });

    it("串流中斷（AbortError）：呼叫 onStreamAbort，包含 unregisterActiveStream + errorPodInstance", async () => {
      mockSendMessageWithAbort([{ type: "text", content: "部分內容" }]);

      const result = await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: true,
        strategy: makeRunStrategy(),
      });

      // onStreamAbort 應呼叫 unregisterActiveStream
      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );

      // onStreamAbort 應呼叫 errorPodInstance
      expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
        runContext,
        podId,
        "使用者中斷執行",
      );

      expect(result.aborted).toBe(true);
      expect(result.content).toBe("部分內容");
    });

    it("串流錯誤（一般 Error）：呼叫 onStreamError，包含 unregisterActiveStream", async () => {
      const testError = new Error("Run mode 執行錯誤");
      mockSendMessageWithError(testError);

      await expect(
        executeStreamingChat({
          canvasId,
          podId,
          message,
          abortable: false,
          strategy: makeRunStrategy(),
        }),
      ).rejects.toThrow("Run mode 執行錯誤");

      // onStreamError 應呼叫 unregisterActiveStream
      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );

      // onStreamError 不應呼叫 errorPodInstance（由上層處理）
      expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
    });

    it("事件發送：text event 廣播 RUN_MESSAGE 而非 POD 事件", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Run 文字" },
        { type: "complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      // 應廣播 RUN_MESSAGE 事件
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          runId,
          canvasId,
          podId,
          content: "Run 文字",
          isPartial: true,
          role: "assistant",
        }),
      );

      // 不應廣播 POD_CLAUDE_CHAT_MESSAGE 事件
      expect(socketService.emitToCanvas).not.toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
        expect.anything(),
      );
    });

    it("訊息持久化：persistMessage 呼叫 runStore.upsertRunMessage 而非 messageStore", async () => {
      mockSendMessageWithEvents([
        { type: "text", content: "Run 內容" },
        { type: "complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      // 應寫入 runStore
      expect(runStore.upsertRunMessage).toHaveBeenCalledWith(
        runId,
        podId,
        expect.objectContaining({ role: "assistant" }),
      );

      // 不應寫入 messageStore
      expect(messageStore.upsertMessage).not.toHaveBeenCalled();
    });
  });
});
