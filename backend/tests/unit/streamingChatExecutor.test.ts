/**
 * streamingChatExecutor 單元測試（Phase 5B 後）
 *
 * 保留合理 boundary mock：
 *   - getProvider（SDK boundary：Claude/Codex provider）
 *   - logger（side-effect only）
 * 移除 store / service mock，改用 initTestDb + 真實 store + vi.spyOn 觀察呼叫。
 */

import path from "path";
import { randomUUID } from "crypto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// SDK boundary mock（保留：getProvider 是外部 SDK 邊界；providerRegistry 保留真實值供 resolveProvider 使用）
// metadata 必須一起提供，否則 providerConfigResolver.warnIfModelOutOfRange / ensureModelField
// 在 buildPodFromRow 讀取路徑上也會呼叫 getProvider(provider).metadata 而丟出 TypeError
vi.mock("../../src/services/provider/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/services/provider/index.js")
    >();
  return {
    ...actual,
    getProvider: vi.fn(() => ({
      chat: vi.fn(async function* () {}),
      cancel: vi.fn(() => false),
      buildOptions: vi.fn().mockResolvedValue({}),
      metadata: {
        availableModelValues: new Set(["opus", "sonnet", "haiku"]),
        defaultOptions: { model: "opus" },
        availableModels: [
          { label: "Opus", value: "opus" },
          { label: "Sonnet", value: "sonnet" },
          { label: "Haiku", value: "haiku" },
        ],
      },
    })),
  };
});

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
}));

import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { executeStreamingChat } from "../../src/services/claude/streamingChatExecutor.js";
import { socketService } from "../../src/services/socketService.js";
import { messageStore } from "../../src/services/messageStore.js";
import { podStore } from "../../src/services/podStore.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { WebSocketResponseEvents } from "../../src/schemas";
import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { NormalModeExecutionStrategy } from "../../src/services/normalExecutionStrategy.js";
import { RunModeExecutionStrategy } from "../../src/services/executionStrategy.js";
import type { RunContext } from "../../src/types/run.js";
import { getProvider } from "../../src/services/provider/index.js";
import type { NormalizedEvent } from "../../src/services/provider/types.js";
import { abortRegistry } from "../../src/services/provider/abortRegistry.js";
import { config } from "../../src/config/index.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

async function* makeEventStream(events: Array<NormalizedEvent>) {
  for (const ev of events) {
    yield ev;
  }
}

function setupProviderMock(events: Array<NormalizedEvent>) {
  const chatMock = vi.fn(() => makeEventStream(events));
  // metadata 必須一起提供，否則 providerConfigResolver（buildPodFromRow 讀取路徑）
  // 呼叫 getProvider(provider).metadata 會拋出 TypeError
  asMock(getProvider).mockReturnValue({
    chat: chatMock,
    cancel: vi.fn(() => false),
    buildOptions: vi.fn().mockResolvedValue({}),
    metadata: {
      availableModelValues: new Set(["opus", "sonnet", "haiku"]),
      defaultOptions: { model: "opus" },
      availableModels: [
        { label: "Opus", value: "opus" },
        { label: "Sonnet", value: "sonnet" },
        { label: "Haiku", value: "haiku" },
      ],
    },
  });
  return { chatMock };
}

// --- DB helpers ---

const CANVAS_ID = "test-canvas";
const POD_ID = "test-pod";

/** 清除 podStore 內部動態 PreparedStatement LRU 快取，防止跨測試 DB 污染 */
function clearPodStoreCache(): void {
  type PodStoreTestHooks = { stmtCache: Map<string, unknown> };
  (podStore as unknown as PodStoreTestHooks).stmtCache.clear();
}

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, `canvas-${CANVAS_ID}`, 0);
}

/**
 * 直接用 SQL 插入 pod，繞過 sanitizeProviderConfigStrict 對 getProvider.metadata 的依賴。
 * workspacePath 預設在 canvasRoot/CANVAS_ID 之下，確保 resolvePodCwd 路徑驗證通過。
 */
function insertPodViaSQL(opts: {
  provider: "claude" | "codex";
  providerConfigJson?: string;
  workspacePath?: string;
  repositoryId?: string | null;
  multiInstance?: boolean;
}) {
  const id = randomUUID();
  const workspacePath =
    opts.workspacePath ?? path.join(config.canvasRoot, CANVAS_ID, `pod-${id}`);
  getDb()
    .prepare(
      `INSERT INTO pods (id, canvas_id, name, status, x, y, rotation, workspace_path,
       session_id, repository_id, command_id, multi_instance,
       schedule_json, provider, provider_config_json)
       VALUES (?, ?, ?, 'idle', 0, 0, 0, ?, NULL, ?, NULL, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      CANVAS_ID,
      `${opts.provider}-pod-${id.slice(0, 8)}`,
      workspacePath,
      opts.repositoryId ?? null,
      opts.multiInstance ? 1 : 0,
      opts.provider,
      opts.providerConfigJson ??
        (opts.provider === "claude" ? JSON.stringify({ model: "opus" }) : null),
    );
  // 回傳最精簡的 pod 結構（getByIdGlobal 需要的欄位）
  return podStore.getByIdGlobal(id)!.pod;
}

function insertClaudePod(
  overrides: { workspacePath?: string; repositoryId?: string } = {},
) {
  return insertPodViaSQL({ provider: "claude", ...overrides });
}

function insertCodexPod() {
  return insertPodViaSQL({
    provider: "codex",
    providerConfigJson: null as unknown as undefined,
  });
}

describe("executeStreamingChat", () => {
  const canvasId = CANVAS_ID;
  const message = "test message";

  function makeStrategy() {
    return new NormalModeExecutionStrategy(canvasId);
  }

  beforeEach(() => {
    closeDb();
    clearPodStoreCache();
    resetStatements();
    initTestDb();
    insertCanvas();

    // spyOn store methods（保留真實邏輯，只觀察呼叫）
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    vi.spyOn(runExecutionService, "registerActiveStream").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "unregisterActiveStream").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "errorPodInstance").mockImplementation(
      () => {},
    );
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
    vi.spyOn(runStore, "upsertRunMessage").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceSessionId").mockImplementation(
      () => {},
    );

    asMock(getProvider).mockClear();
    // metadata 必須一起提供，否則 providerConfigResolver（buildPodFromRow 讀取路徑）
    // 呼叫 getProvider(provider).metadata 會拋出 TypeError
    asMock(getProvider).mockReturnValue({
      chat: vi.fn(async function* () {}),
      cancel: vi.fn(() => false),
      buildOptions: vi.fn().mockResolvedValue({}),
      metadata: {
        availableModelValues: new Set(["opus", "sonnet", "haiku"]),
        defaultOptions: { model: "opus" },
        availableModels: [
          { label: "Opus", value: "opus" },
          { label: "Sonnet", value: "sonnet" },
          { label: "Haiku", value: "haiku" },
        ],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    clearPodStoreCache();
  });

  describe("streaming event 處理（Claude 路徑）", () => {
    it("text event 正確累積內容並廣播 POD_CLAUDE_CHAT_MESSAGE", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
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
          podId: pod.id,
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
          content: "Hello World",
          isPartial: true,
        }),
      );
      expect(result.content).toBe("Hello World");
      expect(result.hasContent).toBe(true);
      expect(result.aborted).toBe(false);
    });

    it.each([
      {
        label: "tool_call_start 廣播 POD_CHAT_TOOL_USE",
        events: [
          {
            type: "tool_call_start" as const,
            toolUseId: "tu1",
            toolName: "Read",
            input: { path: "/test" },
          },
          { type: "turn_complete" as const },
        ],
        expectedEvent: WebSocketResponseEvents.POD_CHAT_TOOL_USE,
        expectedPayload: {
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
      },
      {
        label: "tool_call_result 廣播 POD_CHAT_TOOL_RESULT",
        events: [
          {
            type: "tool_call_start" as const,
            toolUseId: "tu1",
            toolName: "Read",
            input: {},
          },
          {
            type: "tool_call_result" as const,
            toolUseId: "tu1",
            toolName: "Read",
            output: "file content",
          },
          { type: "turn_complete" as const },
        ],
        expectedEvent: WebSocketResponseEvents.POD_CHAT_TOOL_RESULT,
        expectedPayload: { toolUseId: "tu1", output: "file content" },
      },
    ])("$label", async ({ events, expectedEvent, expectedPayload }) => {
      const pod = insertClaudePod();
      setupProviderMock(events);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        expectedEvent,
        expect.objectContaining({
          canvasId,
          podId: pod.id,
          ...expectedPayload,
        }),
      );
    });

    it("turn_complete 廣播 POD_CHAT_COMPLETE", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CHAT_COMPLETE,
        expect.objectContaining({
          canvasId,
          podId: pod.id,
          fullContent: "Hello",
        }),
      );
    });

    it("error event（fatal=true）拋出例外終止串流", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "error", message: "某致命錯誤", fatal: true },
      ]);

      await expect(
        executeStreamingChat({
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        }),
      ).rejects.toThrow("串流處理發生嚴重錯誤");
    });

    it("error event（fatal=false）不拋出、繼續消費後續事件", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "error", message: "某警告", fatal: false },
        { type: "text", content: "後續文字" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(result.aborted).toBe(false);
      expect(result.content).toContain("後續文字");
    });
  });

  describe("成功完成", () => {
    it("完成後 upsertMessage 寫入 DB 且 podStore.setStatus 設為 idle", async () => {
      const pod = insertClaudePod();
      const upsertSpy = vi.spyOn(messageStore, "upsertMessage");
      const setStatusSpy = vi.spyOn(podStore, "setStatus");

      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(upsertSpy).toHaveBeenCalledWith(
        canvasId,
        pod.id,
        expect.objectContaining({ role: "assistant", content: "Hello" }),
      );
      expect(setStatusSpy).toHaveBeenCalledWith(canvasId, pod.id, "idle");
    });

    it("完成後正確呼叫 onComplete callback", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
      ]);

      const onComplete = vi.fn(() => {});
      await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        },
        { onComplete },
      );

      expect(onComplete).toHaveBeenCalledWith(canvasId, pod.id);
    });

    it("無 assistant content 時不呼叫 upsertMessage 但仍設 idle", async () => {
      const pod = insertClaudePod();
      const upsertSpy = vi.spyOn(messageStore, "upsertMessage");
      const setStatusSpy = vi.spyOn(podStore, "setStatus");

      setupProviderMock([{ type: "turn_complete" }]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(upsertSpy).not.toHaveBeenCalled();
      expect(setStatusSpy).toHaveBeenCalledWith(canvasId, pod.id, "idle");
    });
  });

  describe("AbortError 處理", () => {
    it("AbortError + abortable=true 時正確處理，onAborted 被呼叫", async () => {
      const pod = insertClaudePod();
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
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      const result = await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: true,
          strategy: makeStrategy(),
        },
        { onAborted },
      );

      expect(result.aborted).toBe(true);
      expect(result.content).toBe("Hello");
      expect(onAborted).toHaveBeenCalledWith(
        canvasId,
        pod.id,
        expect.any(String),
      );
    });

    it("AbortError + abortable=false 時 re-throw，onAborted 不被呼叫", async () => {
      const pod = insertClaudePod();
      const chatMock = vi.fn(async function* () {
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      await expect(
        executeStreamingChat(
          {
            canvasId,
            podId: pod.id,
            message,
            abortable: false,
            strategy: makeStrategy(),
          },
          { onAborted },
        ),
      ).rejects.toThrow("查詢已被中斷");

      expect(onAborted).not.toHaveBeenCalled();
    });

    it("break-style abort（signal.aborted 但不拋 AbortError）走 handleStreamAbort 路徑", async () => {
      const pod = insertClaudePod();
      const setStatusSpy = vi.spyOn(podStore, "setStatus");
      const setSessionIdSpy = vi.spyOn(podStore, "setSessionId");

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "部分回應" };
        abortRegistry.abort(pod.id);
        return;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      const onComplete = vi.fn(() => {});
      const strategy = makeStrategy();
      const onStreamCompleteSpy = vi.spyOn(strategy, "onStreamComplete");

      const result = await executeStreamingChat(
        { canvasId, podId: pod.id, message, abortable: true, strategy },
        { onAborted, onComplete },
      );

      expect(result.aborted).toBe(true);
      expect(result.content).toBe("部分回應");
      expect(setStatusSpy).toHaveBeenCalledWith(canvasId, pod.id, "idle");
      expect(onAborted).toHaveBeenCalledWith(
        canvasId,
        pod.id,
        expect.any(String),
      );
      expect(onComplete).not.toHaveBeenCalled();
      expect(onStreamCompleteSpy).not.toHaveBeenCalled();
      expect(setSessionIdSpy).not.toHaveBeenCalled();
    });

    it("SDK AbortError 實例也正確處理", async () => {
      const pod = insertClaudePod();
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "Hello" };
        throw new AbortError("SDK abort");
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      const result = await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: true,
          strategy: makeStrategy(),
        },
        { onAborted },
      );

      expect(result.aborted).toBe(true);
      expect(onAborted).toHaveBeenCalled();
    });
  });

  describe("Pod 不存在錯誤處理", () => {
    it.each([
      { label: "回傳 null", value: null },
      { label: "回傳 undefined", value: undefined },
    ])(
      "getByIdGlobal $label → 透過 emitToCanvas 發送 POD_ERROR（code: POD_NOT_FOUND），provider.chat 未被呼叫",
      async ({ value }) => {
        const chatMock = vi.fn(async function* () {
          yield { type: "text" as const, content: "不應看到" };
        });
        asMock(getProvider).mockReturnValue({
          chat: chatMock,
          cancel: vi.fn(() => false),
          buildOptions: vi.fn().mockResolvedValue({}),
          metadata: {
            availableModelValues: new Set(["opus", "sonnet", "haiku"]),
            defaultOptions: { model: "opus" },
          },
        });

        // 不插入 pod，讓 getByIdGlobal 真實返回 undefined；或 mock 返回 null
        const spy = vi
          .spyOn(podStore, "getByIdGlobal")
          .mockReturnValue(value as any);

        // 新行為：executeStreamingChat 攔截錯誤，透過 emitToCanvas 回報給前端，不再向上拋錯
        const result = await executeStreamingChat({
          canvasId,
          podId: POD_ID,
          message,
          abortable: false,
          strategy: makeStrategy(),
        });

        expect(result.aborted).toBe(false);
        expect(socketService.emitToCanvas).toHaveBeenCalledWith(
          canvasId,
          WebSocketResponseEvents.POD_ERROR,
          expect.objectContaining({
            podId: POD_ID,
            success: false,
            code: "POD_NOT_FOUND",
          }),
        );
        expect(chatMock).not.toHaveBeenCalled();
        spy.mockRestore();
      },
    );
  });

  describe("resolvePodCwd 路徑驗證", () => {
    it("綁定 Repository 時，provider.chat 收到的 workspacePath 為 repositoriesRoot/repositoryId", async () => {
      const pod = insertPodViaSQL({
        provider: "claude",
        repositoryId: "test-repo",
      });

      let capturedCtx: unknown;
      const chatMock = vi.fn(async function* (ctx: unknown) {
        capturedCtx = ctx;
        yield { type: "turn_complete" as const };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(chatMock).toHaveBeenCalledTimes(1);
      const expectedCwd = path.resolve(
        path.join(config.repositoriesRoot, "test-repo"),
      );
      expect(capturedCtx).toMatchObject({ workspacePath: expectedCwd });
    });

    it("未綁定 Repository 時，provider.chat 收到的 workspacePath 為 pod.workspacePath（canvasRoot 內）", async () => {
      const pod = insertClaudePod();

      let capturedCtx: unknown;
      const chatMock = vi.fn(async function* (ctx: unknown) {
        capturedCtx = ctx;
        yield { type: "turn_complete" as const };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(capturedCtx).toMatchObject({
        workspacePath: path.resolve(pod.workspacePath),
      });
    });

    it("workspacePath 不在 canvasRoot 內時，透過 emitToCanvas 發送 POD_ERROR（code: INVALID_PATH）且 provider.chat 未被呼叫", async () => {
      // 直接插入帶非法 workspacePath 的 pod（繞過 canvasRoot 驗證，測試 resolvePodCwd 攔截）
      const pod = insertPodViaSQL({
        provider: "claude",
        workspacePath: "/tmp/evil-path",
      });

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應看到" };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      // 新行為：路徑穿越/非法路徑錯誤被 handleStreamError 攔截，透過 emitToCanvas 回報，不再拋出
      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(result.aborted).toBe(false);
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_ERROR,
        expect.objectContaining({
          podId: pod.id,
          success: false,
          code: "INVALID_PATH",
        }),
      );
      expect(chatMock).not.toHaveBeenCalled();
    });
  });

  describe("一般錯誤處理", () => {
    it("一般錯誤時呼叫 onError callback 並 re-throw，podStore.setStatus 設為 idle", async () => {
      const pod = insertClaudePod();
      const setStatusSpy = vi.spyOn(podStore, "setStatus");

      const testError = new Error("Claude API 錯誤");
      const chatMock = vi.fn(async function* () {
        throw testError;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onError = vi.fn(() => {});
      await expect(
        executeStreamingChat(
          {
            canvasId,
            podId: pod.id,
            message,
            abortable: false,
            strategy: makeStrategy(),
          },
          { onError },
        ),
      ).rejects.toThrow("Claude API 錯誤");

      expect(setStatusSpy).toHaveBeenCalledWith(canvasId, pod.id, "idle");
      expect(onError).toHaveBeenCalledWith(
        canvasId,
        pod.id,
        expect.objectContaining({ message: "Claude API 錯誤" }),
      );
    });
  });

  describe("Codex 路徑（統一 provider.chat）", () => {
    it("provider=codex 時走 provider.chat，不呼叫 sendMessage", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([{ type: "turn_complete" }]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi
          .fn()
          .mockResolvedValue({ model: "gpt-5.4", resumeMode: "cli" }),
        metadata: {
          availableModelValues: new Set(["gpt-5.4", "gpt-5.5", "gpt-5.4-mini"]),
          defaultOptions: { model: "gpt-5.4" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(chatMock).toHaveBeenCalledTimes(1);
    });

    it("session_started 事件暫存 sessionId 並傳入 onStreamComplete", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([
          { type: "session_started", sessionId: "thread_abc" },
          { type: "turn_complete" },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const strategy = makeStrategy();
      const completeSpy = vi.spyOn(strategy, "onStreamComplete");

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy,
      });

      expect(completeSpy).toHaveBeenCalledWith(pod.id, "thread_abc");
    });

    it("thinking 事件映射為 POD_CLAUDE_CHAT_MESSAGE 廣播", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([
          { type: "thinking", content: "思考中..." },
          { type: "turn_complete" },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
        expect.objectContaining({
          content: expect.stringContaining("思考中..."),
        }),
      );
    });

    it("error fatal=true 先廣播 ⚠️ 文字再拋出 Error", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([
          { type: "error", message: "某致命錯誤", fatal: true },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const collectedPayloads: unknown[] = [];
      vi.spyOn(socketService, "emitToCanvas").mockImplementation(
        (_cId: string, _event: string, payload: unknown) => {
          collectedPayloads.push(payload);
        },
      );

      await expect(
        executeStreamingChat({
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        }),
      ).rejects.toThrow("串流處理發生嚴重錯誤");

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
  });

  describe("Run mode (RunModeExecutionStrategy)", () => {
    const runId = "test-run-id";
    const runContext: RunContext = {
      runId,
      canvasId,
      sourcePodId: "source-pod",
    };

    function makeRunStrategy() {
      return new RunModeExecutionStrategy(canvasId, runContext);
    }

    it("正常串流完成：registerActiveStream → chat → unregisterActiveStream", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Run 回應" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(runExecutionService.registerActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(result.content).toBe("Run 回應");
      expect(result.aborted).toBe(false);
    });

    it("AbortError → unregisterActiveStream + errorPodInstance", async () => {
      const pod = insertClaudePod();
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
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: true,
        strategy: makeRunStrategy(),
      });

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
        runContext,
        pod.id,
        "使用者中斷執行",
      );
      expect(result.aborted).toBe(true);
    });

    it("一般 Error → unregisterActiveStream，不呼叫 errorPodInstance", async () => {
      const pod = insertClaudePod();
      const testError = new Error("Run mode 執行錯誤");
      const chatMock = vi.fn(async function* () {
        throw testError;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await expect(
        executeStreamingChat({
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeRunStrategy(),
        }),
      ).rejects.toThrow("Run mode 執行錯誤");

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
    });

    it("text event 廣播 RUN_MESSAGE 而非 POD_CLAUDE_CHAT_MESSAGE", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Run 文字" },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          runId,
          canvasId,
          podId: pod.id,
          content: "Run 文字",
        }),
      );
      expect(socketService.emitToCanvas).not.toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
        expect.anything(),
      );
    });

    it("persistMessage 呼叫 runStore.upsertRunMessage 而非 messageStore.upsertMessage", async () => {
      const pod = insertClaudePod();
      const upsertMessageSpy = vi.spyOn(messageStore, "upsertMessage");
      setupProviderMock([
        { type: "text", content: "Run 內容" },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(runStore.upsertRunMessage).toHaveBeenCalledWith(
        runId,
        pod.id,
        expect.objectContaining({ role: "assistant" }),
      );
      expect(upsertMessageSpy).not.toHaveBeenCalled();
    });

    it("instance.worktreePath 合法時，provider.chat 收到的 workspacePath 為 worktreePath", async () => {
      const pod = insertClaudePod();
      const validWorktreePath = path.join(
        config.repositoriesRoot,
        "some-repo",
        "worktree-branch",
      );

      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        worktreePath: validWorktreePath,
      } as any);

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
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(chatMock).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: validWorktreePath }),
      );
    });

    it("worktreePath 不在 repositoriesRoot 內時，透過 emitToCanvas 發送 POD_ERROR（code: INVALID_PATH）且 provider.chat 未被呼叫", async () => {
      const pod = insertClaudePod();
      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        worktreePath: "/tmp/evil-path",
      } as any);

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應看到" };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      // 新行為：worktreePath 非法錯誤被 handleStreamError 攔截，透過 emitToCanvas 回報，不再拋出
      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(result.aborted).toBe(false);
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.POD_ERROR,
        expect.objectContaining({
          podId: pod.id,
          success: false,
          code: "INVALID_PATH",
        }),
      );
      expect(chatMock).not.toHaveBeenCalled();
    });
  });

  describe("handleErrorEvent code 分派邏輯", () => {
    it("無 code + fatal=false → 推送通用警告「⚠️ 發生錯誤，請稍後再試」，不洩漏原始訊息", async () => {
      const pod = insertClaudePod();

      const collectedContents: string[] = [];
      vi.spyOn(socketService, "emitToCanvas").mockImplementation(
        (_cId: string, event: string, payload: unknown) => {
          if (
            event === WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE &&
            typeof payload === "object" &&
            payload !== null &&
            "content" in payload &&
            typeof (payload as { content: unknown }).content === "string"
          ) {
            collectedContents.push((payload as { content: string }).content);
          }
        },
      );

      setupProviderMock([
        { type: "error", message: "xxx", fatal: false },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: new NormalModeExecutionStrategy(canvasId),
      });

      const warningContents = collectedContents.filter((c) => c.includes("⚠️"));
      expect(warningContents.length).toBeGreaterThan(0);
      expect(
        warningContents.some((c) => c.includes("發生錯誤，請稍後再試")),
      ).toBe(true);
      expect(warningContents.some((c) => c.includes("xxx"))).toBe(false);
    });
  });
});
