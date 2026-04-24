/**
 * streamingChatExecutor 單元測試
 *
 * Phase 5B 更新：
 *   - claudeService.sendMessage 已移除，executor 統一走 getProvider("xxx").chat 路徑
 *   - claudeService 模組已從測試移除（executor 本身不再 import claudeService）
 */

import path from "path";
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
import { abortRegistry } from "../../src/services/provider/abortRegistry.js";
import { config } from "../../src/config/index.js";

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
 * workspacePath 必須位於 config.repositoriesRoot 之下，以通過路徑安全驗證。
 */
function makeClaudePodResult() {
  return {
    canvasId: "test-canvas",
    pod: {
      id: "test-pod",
      canvasId: "test-canvas",
      name: "claude-pod",
      provider: "claude" as const,
      workspacePath: path.join(config.repositoriesRoot, "test-workspace"),
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
 * workspacePath 必須位於 config.repositoriesRoot 之下，以通過路徑安全驗證。
 */
function makeCodexPodResult() {
  return {
    canvasId: "test-canvas",
    pod: {
      id: "test-pod",
      canvasId: "test-canvas",
      name: "codex-pod",
      provider: "codex" as const,
      workspacePath: path.join(config.repositoriesRoot, "test-workspace"),
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

    it("串流完成後最終 persist 確保寫入（throttle 節流中間呼叫，finalize 保證最終落盤）", async () => {
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

      // 因 throttle 節流，中間呼叫次數不確定；但 finalize 必定呼叫一次最終 persist
      // 驗收重點：upsertMessage 至少被呼叫一次，且最後一次帶有正確的最終狀態
      expect(messageStore.upsertMessage).toHaveBeenCalled();
      // upsertMessage 簽名：(canvasId, podId, message)
      expect(messageStore.upsertMessage).toHaveBeenLastCalledWith(
        canvasId,
        podId,
        expect.objectContaining({
          role: "assistant",
          content: "Hello",
        }),
      );
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
      ).rejects.toThrow("串流處理發生嚴重錯誤");
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

    it("break-style abort（signal.aborted 但不拋 AbortError）正確走 handleStreamAbort 路徑", async () => {
      // 模擬 Codex-style abort：provider 的 async generator 在收到 signal 後以 break 結束，
      // 不拋出 AbortError，對應實作第 515-516 行的 signal.aborted 檢查分支。
      const chatMock = vi.fn(async function* () {
        // 先 yield 部分文字（模擬已有進度）
        yield { type: "text" as const, content: "部分回應" };

        // 以 NormalModeExecutionStrategy 的 queryKey 格式（= podId）觸發 abort，
        // 這樣 abortController.signal.aborted 在 for-await 結束後會是 true
        abortRegistry.abort(podId);

        // 直接 return（break-style），不拋 AbortError
        return;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

      const onAborted = vi.fn(() => {});
      const onComplete = vi.fn(() => {});

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
          onComplete,
        },
      );

      // 應回傳 aborted=true（走 handleStreamAbort 而非正常結束）
      expect(result.aborted).toBe(true);

      // 應保留已 yield 的部分文字
      expect(result.content).toBe("部分回應");

      // podStore.setStatus 應設為 idle（onStreamAbort 觸發）
      expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, "idle");

      // onAborted callback 應被呼叫（帶 messageId）
      expect(onAborted).toHaveBeenCalledWith(
        canvasId,
        podId,
        expect.any(String),
      );

      // 正常完成的 onComplete 不應被呼叫
      expect(onComplete).not.toHaveBeenCalled();

      // finalizeAfterStream 不應被執行，因此 setSessionId 不應被呼叫
      // （避免把半成品 sessionId 寫入 DB，這是此 patch 的核心目的）
      expect(podStore.setSessionId).not.toHaveBeenCalled();
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

  describe("Pod 不存在錯誤處理", () => {
    it("podStore.getByIdGlobal 回傳 null 時，executeStreamingChat reject 並帶有通用錯誤訊息（不含 podId），且 provider.chat 未被呼叫", async () => {
      // 局部覆寫：模擬 Pod 不存在的情境（不影響其他 test case，因 beforeEach 會重置）
      asMock(podStore.getByIdGlobal).mockReturnValue(null);

      // 獨立建立 chatMock，用以驗證 provider.chat 完全未被呼叫
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應看到此內容" };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

      // 應以 rejection 結束，且錯誤訊息包含「找不到 Pod」（不含 podId，避免洩漏給 client）
      await expect(
        executeStreamingChat({
          canvasId,
          podId,
          message,
          abortable: false,
          strategy: makeStrategy(),
        }),
      ).rejects.toThrow(/找不到 Pod/);

      // provider.chat 在 Pod 查找失敗後不應被呼叫
      expect(chatMock).not.toHaveBeenCalled();
    });

    it("podStore.getByIdGlobal 回傳 undefined 時，同樣 reject 並帶有通用錯誤訊息（不含 podId）", async () => {
      // 局部覆寫：mock 回傳 undefined（與 null 分別測試，確保兩種 falsy 值都被防護）
      asMock(podStore.getByIdGlobal).mockReturnValue(undefined);

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應看到此內容" };
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
          strategy: makeStrategy(),
        }),
      ).rejects.toThrow(/找不到 Pod/);

      expect(chatMock).not.toHaveBeenCalled();
    });
  });

  describe("pod.workspacePath 路徑安全驗證", () => {
    it("pod.workspacePath 不在 repositoriesRoot 內時，拋出「工作目錄驗證失敗」且 provider.chat 未被呼叫", async () => {
      // 設定帶有非法 workspacePath 的 pod（不在 repositoriesRoot 下）
      asMock(podStore.getByIdGlobal).mockReturnValue({
        canvasId: "test-canvas",
        pod: {
          id: "test-pod",
          canvasId: "test-canvas",
          name: "claude-pod",
          provider: "claude" as const,
          workspacePath: "/tmp/evil-workspace",
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
      });

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應看到此內容" };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

      // 驗證應在 provider.chat 執行前就擋下，拋出通用錯誤訊息
      await expect(
        executeStreamingChat({
          canvasId,
          podId,
          message,
          abortable: false,
          strategy: makeStrategy(),
        }),
      ).rejects.toThrow("工作目錄驗證失敗");

      // provider.chat 不應被呼叫
      expect(chatMock).not.toHaveBeenCalled();
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
      ).rejects.toThrow("串流處理發生嚴重錯誤");

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

    it("resolveWorkspacePath：runContext 存在且 instance.worktreePath 合法時，provider.chat 收到的 workspacePath 為 worktreePath 而非 pod.workspacePath", async () => {
      // 合法路徑：位於測試用 config.repositoriesRoot（由 testConfig 覆蓋的 tmp 目錄）之下
      const validWorktreePath = path.join(
        config.repositoriesRoot,
        "some-repo",
        "worktree-branch",
      );

      // mock runStore.getPodInstance 回傳帶有合法 worktreePath 的 instance
      asMock(runStore.getPodInstance).mockReturnValue({
        worktreePath: validWorktreePath,
      });

      // 捕捉 provider.chat 收到的 ctx 參數
      const capturedCtxList: unknown[] = [];
      const chatMock = vi.fn(async function* (ctx: unknown) {
        capturedCtxList.push(ctx);
        yield { type: "text" as const, content: "worktree 回應" };
        yield { type: "turn_complete" as const };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

      await executeStreamingChat({
        canvasId,
        podId,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      // provider.chat 應被呼叫一次
      expect(chatMock).toHaveBeenCalledTimes(1);

      // ctx.workspacePath 應為 worktreePath，而非 pod.workspacePath
      expect(chatMock).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: validWorktreePath }),
      );

      // 確認確實不是 pod.workspacePath（位於 repositoriesRoot/test-workspace）
      expect(capturedCtxList[0]).not.toMatchObject({
        workspacePath: path.join(config.repositoriesRoot, "test-workspace"),
      });

      // 不應拋出「Run Instance 的工作目錄路徑不合法」錯誤（隱含在 await 成功完成）
    });

    it("resolveWorkspacePath：worktreePath 不在 repositoriesRoot 內時，拋出「工作目錄驗證失敗」並且 provider.chat 未被呼叫", async () => {
      // 非法路徑：/tmp/evil-path 不在 config.repositoriesRoot（~/Documents/ClaudeCanvas/repositories）之下
      const illegalWorktreePath = "/tmp/evil-path";

      // mock runStore.getPodInstance 回傳帶有非法 worktreePath 的 instance
      asMock(runStore.getPodInstance).mockReturnValue({
        worktreePath: illegalWorktreePath,
      });

      // 建立 chatMock 並注入 provider，用來驗證安全驗證是否在 provider 執行前就擋下
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應該看到這個" };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

      // 應拋出安全驗證錯誤
      await expect(
        executeStreamingChat({
          canvasId,
          podId,
          message,
          abortable: false,
          strategy: makeRunStrategy(),
        }),
      ).rejects.toThrow("工作目錄驗證失敗");

      // 安全驗證應在 provider.chat 執行前就擋下，不能讓攻擊者繞過驗證
      expect(chatMock).not.toHaveBeenCalled();
    });
  });
});
