/**
 * streamingChatExecutor 單元測試
 *
 * Phase 5B 更新：
 *   - claudeService.sendMessage 已移除，executor 統一走 getProvider("xxx").chat 路徑
 *   - claudeService 模組已從測試移除（executor 本身不再 import claudeService）
 */

import type { Mock } from "vitest";

// mock getProvider：預設回傳無 chat 事件的 stub，測試中再覆寫
vi.mock("../../src/services/provider/index.js", () => ({
  getProvider: vi.fn(() => ({
    chat: vi.fn(async function* () {}),
    cancel: vi.fn(() => false),
    buildOptions: vi.fn().mockResolvedValue({}),
  })),
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
    setSessionId: vi.fn(() => {}),
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
    updatePodInstanceSessionId: vi.fn(() => {}),
  },
}));

import { executeStreamingChat } from "../../src/services/claude/streamingChatExecutor.js";
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
import { getProvider } from "../../src/services/provider/index.js";
import type { NormalizedEvent } from "../../src/services/provider/types.js";

/** 取得 mock 函式的型別化引用，避免重複的 `as Mock<any>` 轉型 */
function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

/** 把 NormalizedEvent 陣列包裝成 async generator（供 mock provider.chat 使用） */
async function* makeEventStream(events: Array<NormalizedEvent>) {
  for (const ev of events) {
    yield ev;
  }
}

/**
 * 建立帶有 provider=claude 的假 podResult，供 podStore.getByIdGlobal 回傳。
 * Phase 4 起 Claude 路徑需要 podResult 非 null。
 */
function makeClaudePodResult() {
  return {
    canvasId: "test-canvas",
    pod: {
      id: "test-pod",
      canvasId: "test-canvas",
      name: "claude-pod",
      provider: "claude" as const,
      workspacePath: "/tmp/workspace",
      providerConfig: { model: "opus" },
      sessionId: null,
      status: "idle" as const,
      outputStyleId: null,
      mcpServerIds: [],
      pluginIds: [],
      integrationBindings: [],
      commandId: null,
      repositoryId: null,
    },
  };
}

/**
 * 建立帶有 provider=codex 的假 podResult，供 podStore.getByIdGlobal 回傳。
 */
function makeCodexPodResult() {
  return {
    canvasId: "test-canvas",
    pod: {
      id: "test-pod",
      canvasId: "test-canvas",
      name: "codex-pod",
      provider: "codex" as const,
      workspacePath: "/tmp/workspace",
      providerConfig: null,
      sessionId: null,
      status: "idle" as const,
      outputStyleId: null,
      mcpServerIds: [],
      pluginIds: [],
      integrationBindings: [],
      commandId: null,
      repositoryId: null,
    },
  };
}

/**
 * 設定 getProvider mock，讓 provider.buildOptions 回傳空 options，
 * provider.chat 產生指定的 NormalizedEvent 序列。
 */
function setupProviderMock(events: Array<NormalizedEvent>) {
  const chatMock = vi.fn(() => makeEventStream(events));
  asMock(getProvider).mockReturnValue({
    chat: chatMock,
    cancel: vi.fn(() => false),
    buildOptions: vi.fn().mockResolvedValue({}),
  });
  return { chatMock };
}

describe("executeStreamingChat", () => {
  const canvasId = "test-canvas";
  const podId = "test-pod";
  const message = "test message";

  /** 建立測試用的 Normal mode strategy */
  function makeStrategy() {
    return new NormalModeExecutionStrategy(canvasId);
  }

  beforeEach(() => {
    // 重置所有 mock
    asMock(socketService.emitToCanvas).mockClear();
    asMock(messageStore.upsertMessage).mockClear();
    asMock(podStore.setStatus).mockClear();
    asMock(logger.log).mockClear();
    asMock(logger.error).mockClear();
    asMock(getProvider).mockClear();

    // Phase 4：預設回傳 Claude pod，讓 Claude 路徑能正確進入
    asMock(podStore.getByIdGlobal).mockReturnValue(makeClaudePodResult());

    // 預設 provider mock：無事件（測試中再覆寫）
    asMock(getProvider).mockReturnValue({
      chat: vi.fn(async function* () {}),
      cancel: vi.fn(() => false),
      buildOptions: vi.fn().mockResolvedValue({}),
    });
  });

  describe("streaming event 處理（Claude 路徑）", () => {
    it("text event 正確累積內容並廣播 POD_CLAUDE_CHAT_MESSAGE", async () => {
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // 2 text + 1 complete = 3 次廣播
      expect(socketService.emitToCanvas).toHaveBeenCalledTimes(3);

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

    it("tool_call_start event 正確處理並廣播 POD_CHAT_TOOL_USE", async () => {
      setupProviderMock([
        {
          type: "tool_call_start",
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
        { type: "turn_complete" },
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

    it("tool_call_result event 正確處理並廣播 POD_CHAT_TOOL_RESULT", async () => {
      setupProviderMock([
        {
          type: "tool_call_start",
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
        {
          type: "tool_call_result",
          toolUseId: "tu1",
          toolName: "Read",
          output: "file content",
        },
        { type: "turn_complete" },
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

    it("turn_complete event 觸發 flush 並廣播 POD_CHAT_COMPLETE", async () => {
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
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
      setupProviderMock([
        { type: "text", content: "Hello" },
        {
          type: "tool_call_start",
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
        {
          type: "tool_call_result",
          toolUseId: "tu1",
          toolName: "Read",
          output: "file content",
        },
        { type: "turn_complete" },
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

    it("error event（fatal=true）拋出例外終止串流", async () => {
      setupProviderMock([
        { type: "error", message: "某致命錯誤", fatal: true },
      ]);

      await expect(
        executeStreamingChat({
          canvasId,
          podId,
          message,
          abortable: false,
          strategy: makeStrategy(),
        }),
      ).rejects.toThrow("某致命錯誤");
    });

    it("error event（fatal=false）不拋出、繼續消費後續事件", async () => {
      setupProviderMock([
        { type: "error", message: "某警告", fatal: false },
        { type: "text", content: "後續文字" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(result.aborted).toBe(false);
      expect(result.content).toContain("後續文字");
    });
  });

  describe("成功完成", () => {
    it("完成後正確呼叫 upsertMessage + setStatus idle", async () => {
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
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
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
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
      setupProviderMock([{ type: "turn_complete" }]);

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
      // 讓 chat generator 先 yield 一個 text event，再拋出 AbortError
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "Hello" };
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

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
      const chatMock = vi.fn(async function* () {
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

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
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "Hello" };
        throw new AbortError("SDK abort");
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

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
      const chatMock = vi.fn(async function* () {
        throw testError;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

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

  describe("Codex 路徑（統一 provider.chat 路徑）", () => {
    /**
     * 設定 getProvider mock：讓 provider.chat 產生指定的 NormalizedEvent 序列。
     * 同時讓 podStore.getByIdGlobal 回傳 codex pod。
     */
    function setupCodexMock(events: Array<NormalizedEvent>) {
      const chatMock = vi.fn(() => makeEventStream(events));
      // getProvider 為同步函式，改用 mockReturnValue；
      // 同時加入 buildOptions mock（executor 會呼叫此方法取得執行時選項）
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi
          .fn()
          .mockResolvedValue({ model: "gpt-5.4", resumeMode: "cli" }),
      });
      asMock(podStore.getByIdGlobal).mockReturnValue(makeCodexPodResult());
      return { chatMock };
    }

    beforeEach(() => {
      // 每個 case 前重置相關 mock
      asMock(getProvider).mockClear();
      // 預設讓 getByIdGlobal 回傳 codex pod（setupCodexMock 會再覆寫）
      asMock(podStore.getByIdGlobal).mockReturnValue(makeCodexPodResult());
    });

    afterEach(() => {
      // 清理 codex pod mock，確保後續其他 describe 的 test 看到的是 claude pod（預設值）
      asMock(podStore.getByIdGlobal).mockReturnValue(makeClaudePodResult());
    });

    // ── Case 1 ────────────────────────────────────────────────────────────────
    it("provider=codex 時走統一 provider.chat 路徑：呼叫 getProvider('codex').chat，不呼叫 sendMessage", async () => {
      const { chatMock } = setupCodexMock([{ type: "turn_complete" }]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // codex provider 的 chat 應被呼叫
      expect(chatMock).toHaveBeenCalledTimes(1);
    });

    // ── Case 2 ────────────────────────────────────────────────────────────────
    it("session_started 事件被暫存並傳入 finalizeAfterStream → onStreamComplete 帶 sessionId", async () => {
      setupCodexMock([
        { type: "session_started", sessionId: "thread_abc" },
        { type: "turn_complete" },
      ]);

      // 用 spy 追蹤 strategy.onStreamComplete 的呼叫
      const strategy = makeStrategy();
      const completeSpy = vi.spyOn(strategy, "onStreamComplete");

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy,
      });

      // onStreamComplete 應帶入暫存的 sessionId
      expect(completeSpy).toHaveBeenCalledWith(podId, "thread_abc");
    });

    // ── Case 3 ────────────────────────────────────────────────────────────────
    it("error 事件 fatal=true → 先廣播 ⚠️ 文字，再拋出 Error", async () => {
      setupCodexMock([{ type: "error", message: "某致命錯誤", fatal: true }]);

      const collectedPayloads: unknown[] = [];
      asMock(socketService.emitToCanvas).mockImplementation(
        (_cId: string, _event: string, payload: unknown) => {
          collectedPayloads.push(payload);
        },
      );

      await expect(
        executeStreamingChat({
          canvasId,
          podId,
          message,
          abortable: false,
          strategy: makeStrategy(),
        }),
      ).rejects.toThrow("某致命錯誤");

      // streamingCallback 應收到含 ⚠️ 的 text 廣播
      const textPayloads = collectedPayloads.filter(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          "content" in p &&
          typeof (p as { content: unknown }).content === "string" &&
          (p as { content: string }).content.includes("⚠️"),
      );
      expect(textPayloads.length).toBeGreaterThan(0);
    });

    // ── Case 4 ────────────────────────────────────────────────────────────────
    it("error 事件 fatal=false → 不拋出、繼續消費後續事件直到 turn_complete", async () => {
      setupCodexMock([
        { type: "error", message: "某警告", fatal: false },
        { type: "text", content: "continued" },
        { type: "turn_complete" },
      ]);

      const emittedContents: string[] = [];
      asMock(socketService.emitToCanvas).mockImplementation(
        (_cId: string, event: string, payload: unknown) => {
          // 收集所有 text 廣播的 content
          if (
            event === WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE &&
            typeof payload === "object" &&
            payload !== null &&
            "content" in payload
          ) {
            emittedContents.push((payload as { content: string }).content);
          }
        },
      );

      const result = await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // 不應拋出例外
      expect(result.aborted).toBe(false);

      // 應有 ⚠️ 警告文字廣播
      expect(emittedContents.some((c) => c.includes("⚠️"))).toBe(true);

      // 也應收到 'continued' 文字
      expect(emittedContents.some((c) => c.includes("continued"))).toBe(true);

      // complete 廣播應被呼叫
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_COMPLETE,
        expect.anything(),
      );
    });

    // ── Case 5 ────────────────────────────────────────────────────────────────
    it("thinking 事件轉為 text 廣播", async () => {
      setupCodexMock([
        { type: "thinking", content: "思考中..." },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // thinking 應映射成 POD_CLAUDE_CHAT_MESSAGE（text 路徑）
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
        expect.objectContaining({
          content: expect.stringContaining("思考中..."),
        }),
      );
    });

    // ── Case 6 ────────────────────────────────────────────────────────────────
    it("tool_call_start / tool_call_result 映射為 POD_CHAT_TOOL_USE / POD_CHAT_TOOL_RESULT", async () => {
      setupCodexMock([
        {
          type: "tool_call_start",
          toolUseId: "cu1",
          toolName: "Bash",
          input: { command: "ls" },
        },
        {
          type: "tool_call_result",
          toolUseId: "cu1",
          toolName: "Bash",
          output: "file1\nfile2",
        },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // tool_call_start → tool_use 廣播
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_TOOL_USE,
        expect.objectContaining({
          toolUseId: "cu1",
          toolName: "Bash",
          input: { command: "ls" },
        }),
      );

      // tool_call_result → tool_result 廣播
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_TOOL_RESULT,
        expect.objectContaining({
          toolUseId: "cu1",
          toolName: "Bash",
          output: "file1\nfile2",
        }),
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
      asMock(runStore.updatePodInstanceSessionId).mockClear();
      // Run mode 測試也使用 Claude pod
      asMock(podStore.getByIdGlobal).mockReturnValue(makeClaudePodResult());
    });

    it("正常串流完成：呼叫 onStreamStart → chat → onStreamComplete", async () => {
      setupProviderMock([
        { type: "text", content: "Run 回應" },
        { type: "turn_complete" },
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

      // onStreamComplete：取消註冊 active stream
      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );

      expect(result.content).toBe("Run 回應");
      expect(result.aborted).toBe(false);
    });

    it("串流中斷（AbortError）：呼叫 onStreamAbort，包含 unregisterActiveStream + errorPodInstance", async () => {
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "部分內容" };
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

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
      const chatMock = vi.fn(async function* () {
        throw testError;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

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
      setupProviderMock([
        { type: "text", content: "Run 文字" },
        { type: "turn_complete" },
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
      setupProviderMock([
        { type: "text", content: "Run 內容" },
        { type: "turn_complete" },
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
