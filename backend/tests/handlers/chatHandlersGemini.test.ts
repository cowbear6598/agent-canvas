/**
 * Gemini Pod 整合測試：Command 展開 + cwd 解析
 *
 * 涵蓋範圍（計畫書 Phase 2 C / D / E）：
 *   C：handleChatSend → launchRun 對 Gemini Pod 的 Command 展開整合層
 *   D：repositoryId 設定後 resolvePodCwd 回傳正確的 cwd
 *   E：同時綁定 commandId + repositoryId 的綜合測試
 *
 * Mock 邊界：
 *   必須 mock：commandService.read（markdown I/O）、Bun.spawn（Gemini subprocess）
 *   不可 mock：tryExpandCommandMessage / expandCommandMessage 本體、resolvePodCwd、
 *              assertCapability、createBindHandler、isPathWithinDirectory
 *
 * 設計決策：
 *   - launchRun 以 spy 包裝真實實作，C/D/E 測試可同時斷言呼叫次數與驗證內部邏輯
 *   - C 測試透過 spy launchRun + mock executeStreamingChat，捕捉傳入的 message 引數
 *   - D / E 測試使用 mock getProvider，捕捉 ctx.workspacePath（等同驗證 Bun.spawn cwd）
 *     因 executeStreamingChat 以 resolvePodCwd 結果填入 ctx.workspacePath，再傳至 provider.chat
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

// canvasStore：讓 withCanvasId 能從 connectionId 取得 CANVAS_ID
vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => CANVAS_ID),
    getCanvasDir: vi.fn(() => "/tmp/test-canvas"),
    getById: vi.fn((id: string) => ({
      id,
      name: "test-canvas",
      sortIndex: 0,
    })),
    list: vi.fn(() => [{ id: CANVAS_ID, name: "test-canvas", sortIndex: 0 }]),
  },
}));

// commandService.read：filesystem 邊界（預設回傳 null，各 test 依需求覆寫）
vi.mock("../../src/services/commandService.js", () => ({
  commandService: {
    read: vi.fn().mockResolvedValue(null),
  },
}));

// executeStreamingChat：Claude/Gemini SDK 入口（C 測試用）
// D/E 測試透過 getProvider mock 捕捉 ctx，不需要真正執行 executeStreamingChat
vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: vi.fn().mockResolvedValue({
    messageId: "mock-msg-id",
    content: "",
    hasContent: false,
    aborted: false,
  }),
}));

// getProvider：SDK boundary
// metadata 必須完整提供，否則 providerConfigResolver（buildPodFromRow 讀取路徑）
// 呼叫 getProvider(provider).metadata 會拋出 TypeError
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
      buildOptions: vi
        .fn()
        .mockResolvedValue({ model: "gemini-2.5-pro", resumeMode: "cli" }),
      metadata: {
        availableModelValues: new Set(["gemini-2.5-pro", "gemini-2.5-flash"]),
        defaultOptions: { model: "gemini-2.5-pro" },
        availableModels: [
          { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
          { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
        ],
        capabilities: {
          chat: true,
          command: true,
          repository: true,
        },
      },
    })),
  };
});

// socketService：WebSocket boundary
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: vi.fn(),
    emitToConnection: vi.fn(),
    emitToAll: vi.fn(),
  },
}));

// websocketResponse：避免真實 WebSocket emit
vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

// launchRun：所有 Pod 的訊息傳送路徑（multi-run 架構）
// 使用 spy 包裝真實實作，讓 C/D/E 測試可同時斷言呼叫次數與驗證內部邏輯
vi.mock("../../src/utils/runChatHelpers.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/runChatHelpers.js")>();
  return {
    ...actual,
    launchRun: vi.fn(actual.launchRun),
  };
});

// chatCallbacks：避免 DB side-effect
vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onChatAborted: vi.fn().mockResolvedValue(undefined),
  onRunChatComplete: vi.fn().mockResolvedValue(undefined),
}));

// logger：side-effect only
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── imports ──────────────────────────────────────────────────────────────────

import path from "path";
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import type { Mock } from "vitest";

import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";
import { handleChatSend } from "../../src/handlers/chatHandlers.js";
import { socketService } from "../../src/services/socketService.js";
import * as executeStreamingChatModule from "../../src/services/claude/streamingChatExecutor.js";
import * as commandServiceModule from "../../src/services/commandService.js";
import * as runChatHelpersModule from "../../src/utils/runChatHelpers.js";
import { config } from "../../src/config/index.js";
import { getProvider } from "../../src/services/provider/index.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import { ProviderNotFoundError } from "../../src/utils/errorHelpers.js";

// ─── D/E 共用：真實 executeStreamingChat（一次性載入）─────────────────────────
// vi.importActual 只執行一次，D-1a / D-1b / D-1c / E-1 均共用此參照。
let realExecute:
  | (typeof import("../../src/services/claude/streamingChatExecutor.js"))["executeStreamingChat"]
  | null = null;

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-gemini-chat-test";
const CONNECTION_ID = "conn-gemini-chat-test";
const REQUEST_ID = "req-gemini-chat-test";

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function clearPodStoreCache(): void {
  podStore.__clearCacheForTesting();
}

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "Gemini Chat Test Canvas", 0);
}

/**
 * 直接用 SQL 插入 Gemini Pod，繞過 sanitizeProviderConfigStrict 對 getProvider.metadata 的依賴。
 * workspacePath 預設在 canvasRoot/CANVAS_ID 之下，確保 resolvePodCwd fallback 路徑驗證通過。
 */
function insertGeminiPodViaSQL(
  opts: {
    commandId?: string | null;
    repositoryId?: string | null;
    workspacePath?: string;
  } = {},
): string {
  const podId = `gemini-pod-${Date.now()}`;
  const workspacePath =
    opts.workspacePath ??
    path.join(config.canvasRoot, CANVAS_ID, `pod-${podId}`);

  getDb()
    .prepare(
      `INSERT INTO pods (id, canvas_id, name, x, y, rotation, workspace_path,
       session_id, repository_id, command_id,
       schedule_json, provider, provider_config_json)
       VALUES (?, ?, ?, 0, 0, 0, ?, NULL, ?, ?,
       NULL, 'gemini', '{"model":"gemini-2.5-pro"}')`,
    )
    .run(
      podId,
      CANVAS_ID,
      `gemini-pod-${podId.slice(-8)}`,
      workspacePath,
      opts.repositoryId ?? null,
      opts.commandId ?? null,
    );

  return podId;
}

/**
 * 觸發 handleChatSend（multi-run 路徑），await 完成後返回。
 */
async function triggerChatSend(podId: string, message: string): Promise<void> {
  await handleChatSend(
    CONNECTION_ID,
    { podId, message, requestId: REQUEST_ID },
    REQUEST_ID,
  );
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  closeDb();
  clearPodStoreCache();
  resetStatements();
  initTestDb();
  insertCanvas();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  closeDb();
  clearPodStoreCache();
});

// ─── C：整合層 — Command 展開 ─────────────────────────────────────────────────

describe("C：Gemini Pod Command 展開整合層", () => {
  it("C-1: commandId 存在且 commandService.read 回傳 markdown 時，executeStreamingChat 收到的 message 完全等於展開格式", async () => {
    const markdown = "# 系統指令\n請用繁體中文回覆。";
    const originalMessage = "請幫我解釋這段程式碼";
    const commandId = "cmd-001";
    const expectedMessage = `<command>\n${markdown}\n</command>\n${originalMessage}`;

    asMock(commandServiceModule.commandService.read).mockResolvedValue(
      markdown,
    );

    const podId = insertGeminiPodViaSQL({ commandId });

    await triggerChatSend(podId, originalMessage);

    // 斷言走 multi-run 路徑：launchRun 被呼叫一次且帶正確 podId 與原始訊息
    expect(runChatHelpersModule.launchRun).toHaveBeenCalledOnce();
    expect(
      asMock(runChatHelpersModule.launchRun).mock.calls[0][0],
    ).toMatchObject({
      podId,
      message: originalMessage,
    });

    expect(
      executeStreamingChatModule.executeStreamingChat,
    ).toHaveBeenCalledOnce();
    const callArgs = asMock(executeStreamingChatModule.executeStreamingChat)
      .mock.calls[0][0];
    expect(callArgs.message).toBe(expectedMessage);
  });

  it("C-2: expandCommandMessage 格式驗證：</command> 後僅一個 \\n，與原訊息直接相連，無額外空白行", async () => {
    const markdown = "多行\nmarkdown\n內容";
    const originalMessage = "user message";
    const commandId = "cmd-002";

    asMock(commandServiceModule.commandService.read).mockResolvedValue(
      markdown,
    );

    const podId = insertGeminiPodViaSQL({ commandId });

    await triggerChatSend(podId, originalMessage);

    // 斷言走 multi-run 路徑：launchRun 被呼叫
    expect(runChatHelpersModule.launchRun).toHaveBeenCalledOnce();

    const callArgs = asMock(executeStreamingChatModule.executeStreamingChat)
      .mock.calls[0][0];
    const msg = callArgs.message as string;

    // </command> 後緊接一個 \n，然後是原訊息（無額外空白行）
    expect(msg).toContain(`</command>\n${originalMessage}`);
    expect(msg).not.toContain(`</command>\n\n`);
    // 確認 <command> 標籤開頭
    expect(msg).toMatch(/^<command>\n/);
  });

  it("C-3: commandId 無綁定（null）時，executeStreamingChat 收到的 message 為原始訊息，不含 <command> 標籤", async () => {
    const originalMessage = "沒有綁定 Command 的訊息";

    const podId = insertGeminiPodViaSQL({ commandId: null });

    await triggerChatSend(podId, originalMessage);

    // 斷言走 multi-run 路徑：launchRun 被呼叫一次
    expect(runChatHelpersModule.launchRun).toHaveBeenCalledOnce();

    expect(
      executeStreamingChatModule.executeStreamingChat,
    ).toHaveBeenCalledOnce();
    const callArgs = asMock(executeStreamingChatModule.executeStreamingChat)
      .mock.calls[0][0];
    expect(callArgs.message).toBe(originalMessage);
    expect(callArgs.message).not.toContain("<command>");
  });

  it("C-4（邊界）: commandService.read 回傳 null 時，走 handleCommandNotFound 路徑，不呼叫 executeStreamingChat", async () => {
    const commandId = "cmd-deleted";
    asMock(commandServiceModule.commandService.read).mockResolvedValue(null);

    const podId = insertGeminiPodViaSQL({ commandId });

    await triggerChatSend(podId, "任意訊息");

    // 斷言走 multi-run 路徑：launchRun 被呼叫一次（handleCommandNotFound 路徑）
    expect(runChatHelpersModule.launchRun).toHaveBeenCalledOnce();

    // Command 已刪除，不應呼叫 executeStreamingChat
    expect(
      executeStreamingChatModule.executeStreamingChat,
    ).not.toHaveBeenCalled();

    // socketService.emitToCanvas 應被呼叫，推送 Command 不存在的錯誤文字（RUN_MESSAGE 事件）
    expect(socketService.emitToCanvas).toHaveBeenCalled();
    const emitCalls = asMock(socketService.emitToCanvas).mock.calls;
    const hasCommandNotFoundEmit = emitCalls.some(
      (call) =>
        call[1] === WebSocketResponseEvents.RUN_MESSAGE &&
        typeof call[2]?.content === "string" &&
        call[2].content.includes(commandId),
    );
    expect(hasCommandNotFoundEmit).toBe(true);
  });
});

// ─── 共用 mock factory（D / E 共用）─────────────────────────────────────────

/**
 * 建立可重用的 Gemini provider mock。
 * chatFn 負責捕捉 ctx 或驗證 provider.chat 是否被呼叫。
 * 回傳 { mock } 讓呼叫端自行 asMock(getProvider).mockReturnValue(mock)。
 */
function buildProviderMock(
  chatFn: (ctx: {
    workspacePath: string;
    message: string | unknown;
  }) => AsyncGenerator<{ type: "turn_complete" }>,
) {
  const mock = {
    chat: vi.fn(chatFn),
    cancel: vi.fn(() => false),
    buildOptions: vi
      .fn()
      .mockResolvedValue({ model: "gemini-2.5-pro", resumeMode: "cli" }),
    metadata: {
      availableModelValues: new Set(["gemini-2.5-pro", "gemini-2.5-flash"]),
      defaultOptions: { model: "gemini-2.5-pro" },
      availableModels: [
        { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
        { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
      ],
      capabilities: {
        chat: true,
        command: true,
        repository: true,
      },
    },
  };
  return { mock };
}

// ─── D：resolvePodCwd — repositoryId 路徑解析 ────────────────────────────────

describe("D：Gemini Pod resolvePodCwd 整合", () => {
  /**
   * D 測試需要真正執行 executeStreamingChat，讓 resolvePodCwd 運作。
   * 透過 mock getProvider 捕捉 ctx.workspacePath（等同驗證 Bun.spawn cwd），
   * 不需要真實 Gemini subprocess。
   */

  beforeAll(async () => {
    // 整個 D/E 群組只載入一次真實 executeStreamingChat，避免重複 importActual
    const mod = await vi.importActual<
      typeof import("../../src/services/claude/streamingChatExecutor.js")
    >("../../src/services/claude/streamingChatExecutor.js");
    realExecute = mod.executeStreamingChat;
  });

  function setupProviderSpy(): { capturedWorkspacePath: string[] } {
    const capturedWorkspacePath: string[] = [];
    const { mock } = buildProviderMock(async function* (ctx) {
      capturedWorkspacePath.push(ctx.workspacePath);
      yield { type: "turn_complete" as const };
    });
    asMock(getProvider).mockReturnValue(mock);
    return { capturedWorkspacePath };
  }

  it("D-1b: repositoryId = null 時，provider.chat 收到的 workspacePath 為 pod.workspacePath", async () => {
    asMock(executeStreamingChatModule.executeStreamingChat).mockImplementation(
      (
        opts: Parameters<
          typeof executeStreamingChatModule.executeStreamingChat
        >[0],
        cbs?: Parameters<
          typeof executeStreamingChatModule.executeStreamingChat
        >[1],
      ) => realExecute!(opts, cbs),
    );

    const { capturedWorkspacePath } = setupProviderSpy();

    const customWorkspacePath = path.join(
      config.canvasRoot,
      CANVAS_ID,
      "pod-no-repo",
    );
    const podId = insertGeminiPodViaSQL({
      repositoryId: null,
      workspacePath: customWorkspacePath,
    });

    await triggerChatSend(podId, "hello");

    expect(capturedWorkspacePath).toHaveLength(1);
    expect(capturedWorkspacePath[0]).toBe(path.resolve(customWorkspacePath));
  });

  it("D-1d（邊界）: provider.buildOptions 拋錯時，executeStreamingChat 攔截並改寫為 transcript system message，provider.chat 不被呼叫", async () => {
    asMock(executeStreamingChatModule.executeStreamingChat).mockImplementation(
      (
        opts: Parameters<
          typeof executeStreamingChatModule.executeStreamingChat
        >[0],
        cbs?: Parameters<
          typeof executeStreamingChatModule.executeStreamingChat
        >[1],
      ) => realExecute!(opts, cbs),
    );

    const chatMock = vi.fn(async function* () {});
    asMock(getProvider).mockReturnValue({
      chat: chatMock,
      cancel: vi.fn(() => false),
      buildOptions: vi
        .fn()
        .mockRejectedValue(new ProviderNotFoundError("找不到 Provider")),
      metadata: {
        availableModelValues: new Set(["gemini-2.5-pro"]),
        defaultOptions: { model: "gemini-2.5-pro" },
        availableModels: [{ label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" }],
        capabilities: { chat: true, command: true, repository: true },
      },
    });

    const podId = insertGeminiPodViaSQL({});

    // provider.buildOptions 拋錯，executeStreamingChat 應攔截並發送 transcript system message
    await triggerChatSend(podId, "hello");

    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_MESSAGE,
      expect.objectContaining({
        podId,
        role: "system",
        // 已知業務錯誤的 content 改為固定中文訊息，不再透傳 error.message
        content: "找不到對應的 AI Provider，請確認 Pod 設定後重試。",
        metadata: expect.objectContaining({
          code: "PROVIDER_NOT_FOUND",
          severity: "fatal",
        }),
      }),
    );

    // provider.chat 不應被呼叫（buildOptions 在 provider.chat 之前拋錯）
    expect(chatMock).not.toHaveBeenCalled();
  });
});

// E-1 已隨 normal mode 移除：multi-run 路徑下 provider.chat 收到的 workspacePath
// 為 per-run worktree 而非裸 repository 路徑，原斷言不再適用。
// 整合涵蓋仍由 tests/integration/workflow-execution.test.ts 提供。
