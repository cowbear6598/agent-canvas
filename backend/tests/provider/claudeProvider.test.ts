/**
 * claudeProvider.chat() 單元測試
 *
 * 驗證 claudeProvider.chat(ctx) 的 NormalizedEvent 產出：
 * - mock SDK query() → 驗證 session_started → text → turn_complete
 * - tool_use / tool_result 流程 → 對應 NormalizedEvent
 * - result/error → error event（fatal=true）
 * - abortSignal 觸發時 stream 正常結束
 * - session retry：首次 resume 失敗重試一次後成功
 *
 * Mock 方法：vi.mock("@anthropic-ai/claude-agent-sdk") 攔截 query()
 */

// ── SDK mock 必須在最前面設定 ────────────────────────────────────────────────

let mockQueryImpl: () => AsyncGenerator<any>;

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...original,
    query: vi.fn(() => mockQueryImpl()),
    createSdkMcpServer: vi.fn((opts: { name: string; tools?: any[] }) => ({
      __mock: true,
      name: opts.name,
    })),
    tool: vi.fn(() => ({ __mockTool: true })),
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

// buildClaudeOptions 的依賴 mock（讓 buildOptions 可以成功執行）
vi.mock("../../src/services/outputStyleService.js", () => ({
  outputStyleService: { getContent: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../src/services/mcpServerStore.js", () => ({
  mcpServerStore: { getByIds: vi.fn().mockReturnValue([]) },
}));
vi.mock("../../src/services/pluginScanner.js", () => ({
  scanInstalledPlugins: vi.fn().mockReturnValue([]),
}));
vi.mock("../../src/services/integration/index.js", () => ({
  integrationRegistry: { get: vi.fn().mockReturnValue(undefined) },
}));
vi.mock("../../src/services/integration/replyContextStore.js", () => ({
  replyContextStore: { get: vi.fn() },
  buildReplyContextKey: vi.fn(() => "key"),
}));
vi.mock("../../src/utils/pathValidator.js", () => ({
  isPathWithinDirectory: vi.fn(() => true),
}));
vi.mock("../../src/config/index.js", () => ({
  config: { canvasRoot: "/workspace", repositoriesRoot: "/repos" },
}));

// ── 匯入（在 mock 之後）────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { claudeProvider } from "../../src/services/provider/claudeProvider.js";
import type { NormalizedEvent } from "../../src/services/provider/types.js";
import type { ClaudeOptions } from "../../src/services/provider/claude/buildClaudeOptions.js";
import type { ChatRequestContext } from "../../src/services/provider/types.js";

// ── 工具函式 ──────────────────────────────────────────────────────────────────

/** 收集 AsyncIterable 成陣列 */
async function collectEvents(
  iterable: AsyncIterable<NormalizedEvent>,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const ev of iterable) {
    events.push(ev);
  }
  return events;
}

/** 建立最小化 ClaudeOptions */
function makeOptions(overrides: Partial<ClaudeOptions> = {}): ClaudeOptions {
  return {
    model: "opus",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    settingSources: ["project"],
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
    pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    ...overrides,
  };
}

/** 建立最小化 ChatRequestContext */
function makeCtx(
  overrides: Partial<ChatRequestContext<ClaudeOptions>> = {},
): ChatRequestContext<ClaudeOptions> {
  return {
    podId: "pod-claude-test",
    message: "Hello, Claude!",
    workspacePath: "/workspace/test",
    resumeSessionId: null,
    abortSignal: new AbortController().signal,
    options: makeOptions(),
    ...overrides,
  };
}

/** 建立 system/init SDKMessage（session 建立） */
function makeSystemInit(sessionId = "test-session-001"): any {
  return { type: "system", subtype: "init", session_id: sessionId };
}

/** 建立 assistant text SDKMessage */
function makeAssistantText(text: string): any {
  return {
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
    },
  };
}

/** 建立 assistant tool_use SDKMessage */
function makeAssistantToolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): any {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name, input }],
    },
  };
}

/** 建立 user tool_result SDKMessage */
function makeUserToolResult(toolUseId: string, content: string): any {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  };
}

/** 建立 result/success SDKMessage */
function makeResultSuccess(result = ""): any {
  return { type: "result", subtype: "success", result };
}

/** 建立 result/error SDKMessage */
function makeResultError(errors: string[]): any {
  return { type: "result", subtype: "error", errors };
}

// ── 測試套件 ──────────────────────────────────────────────────────────────────

describe("claudeProvider.chat()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 預設 mock query 實作（產生 init + result）
    mockQueryImpl = async function* () {
      yield makeSystemInit();
      yield makeResultSuccess();
    };
  });

  // ── Case 1：正常對話流程 session_started → text → turn_complete ─────────
  it("正常對話應產生 session_started → text → turn_complete", async () => {
    mockQueryImpl = async function* () {
      yield makeSystemInit("session-abc");
      yield makeAssistantText("Hello! I am Claude.");
      yield makeResultSuccess("Hello! I am Claude.");
    };

    const ctx = makeCtx();
    const events = await collectEvents(claudeProvider.chat(ctx));

    // session_started
    const sessionStarted = events.find((e) => e.type === "session_started");
    expect(sessionStarted).toBeDefined();
    expect(
      (sessionStarted as Extract<NormalizedEvent, { type: "session_started" }>)
        .sessionId,
    ).toBe("session-abc");

    // text
    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
    expect(
      (textEvent as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("Hello! I am Claude.");

    // turn_complete
    const turnComplete = events.find((e) => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();
  });

  // ── Case 2：tool_use / tool_result 流程 ───────────────────────────────
  it("tool_use → tool_result 應產生 tool_call_start → tool_call_result", async () => {
    const toolId = "tool-001";
    const toolInput = { command: "ls /workspace" };

    mockQueryImpl = async function* () {
      yield makeSystemInit();
      yield makeAssistantToolUse(toolId, "Bash", toolInput);
      yield makeUserToolResult(toolId, "file1.ts\nfile2.ts");
      yield makeResultSuccess();
    };

    const ctx = makeCtx();
    const events = await collectEvents(claudeProvider.chat(ctx));

    // tool_call_start
    const toolCallStart = events.find((e) => e.type === "tool_call_start");
    expect(toolCallStart).toBeDefined();
    const tcs = toolCallStart as Extract<
      NormalizedEvent,
      { type: "tool_call_start" }
    >;
    expect(tcs.toolUseId).toBe(toolId);
    expect(tcs.toolName).toBe("Bash");
    expect(tcs.input).toEqual(toolInput);

    // tool_call_result
    const toolCallResult = events.find((e) => e.type === "tool_call_result");
    expect(toolCallResult).toBeDefined();
    const tcr = toolCallResult as Extract<
      NormalizedEvent,
      { type: "tool_call_result" }
    >;
    expect(tcr.toolUseId).toBe(toolId);
    expect(tcr.toolName).toBe("Bash");
    expect(tcr.output).toBe("file1.ts\nfile2.ts");
  });

  // ── Case 3：result/error → error event ──────────────────────────────
  it("result/error 應產生 error event（fatal=true）", async () => {
    mockQueryImpl = async function* () {
      yield makeSystemInit();
      yield makeResultError(["模型呼叫失敗", "額度已用盡"]);
    };

    const ctx = makeCtx();
    const events = await collectEvents(claudeProvider.chat(ctx));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    const e = errorEvent as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.fatal).toBe(true);
  });

  // ── Case 4：abortSignal 觸發時拋出 AbortError ───────────────────────
  it("abortSignal 觸發時應拋出 AbortError（name 為 AbortError）", async () => {
    const ac = new AbortController();

    mockQueryImpl = async function* () {
      yield makeSystemInit();
      // 在 SDK 串流中途 abort
      ac.abort();
      // abort 後繼續 yield（模擬真實 SDK 行為：abort signal 觸發後串流仍完成）
      yield makeResultSuccess();
    };

    const ctx = makeCtx({ abortSignal: ac.signal });

    // runClaudeQuery 在串流結束後若 abortSignal.aborted 為 true，
    // 會手動拋出 AbortError；sessionRetry 偵測到 AbortError 後向上重拋。
    let caughtError: unknown = null;
    try {
      await collectEvents(claudeProvider.chat(ctx));
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect((caughtError as Error).name).toBe("AbortError");
  });

  // ── Case 5：session retry — 首次 resume 失敗後重試一次 ────────────────
  it("resume session 失敗時應自動重試一次（不帶 resumeSessionId）後成功", async () => {
    let callCount = 0;

    mockQueryImpl = async function* () {
      callCount++;

      if (callCount === 1) {
        // 第一次：模擬 session resume 失敗
        yield makeSystemInit("old-session");
        throw new Error("session resume failed: session not found");
      }

      // 第二次：成功
      yield makeSystemInit("new-session");
      yield makeAssistantText("重試成功");
      yield makeResultSuccess("重試成功");
    };

    const ctx = makeCtx({ resumeSessionId: "old-session-id" });
    const events = await collectEvents(claudeProvider.chat(ctx));

    // 應呼叫 query 兩次（第一次失敗，第二次成功）
    expect(callCount).toBe(2);

    // 最終應有 turn_complete
    const turnComplete = events.find((e) => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();
  });

  // ── Case 6：session retry — 非 session 錯誤不重試 ────────────────────
  it("非 session 相關錯誤不應重試，應直接產生 error event", async () => {
    let callCount = 0;

    mockQueryImpl = async function* () {
      callCount++;
      yield makeSystemInit();
      throw new Error("網路連線失敗");
    };

    const ctx = makeCtx({ resumeSessionId: "session-xyz" });
    const events = await collectEvents(claudeProvider.chat(ctx));

    // 不應重試（只呼叫一次）
    expect(callCount).toBe(1);

    // 應產生 error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  // ── Case 7：session retry — 已是重試不再重試（避免無限重試） ──────────
  it("重試後仍失敗時不應再次重試（最多重試一次）", async () => {
    let callCount = 0;

    mockQueryImpl = async function* () {
      callCount++;
      yield makeSystemInit();
      // 每次都拋出 session 相關錯誤
      throw new Error("session resume error: always fails");
    };

    const ctx = makeCtx({ resumeSessionId: "bad-session" });
    const events = await collectEvents(claudeProvider.chat(ctx));

    // 最多呼叫 2 次（1 次原始 + 1 次重試）
    expect(callCount).toBe(2);

    // 最終應產生 error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  // ── Case 8：無 resumeSessionId 時發生 session 相關錯誤不重試 ─────────
  it("無 resumeSessionId 時（新對話）session 錯誤不應重試", async () => {
    let callCount = 0;

    mockQueryImpl = async function* () {
      callCount++;
      yield makeSystemInit();
      throw new Error("session resume: unexpected error");
    };

    // resumeSessionId = null → 不重試
    const ctx = makeCtx({ resumeSessionId: null });
    const events = await collectEvents(claudeProvider.chat(ctx));

    expect(callCount).toBe(1);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  // ── Case 9：系統 api_retry 訊息 → text event（重試通知） ──────────────
  it("system/api_retry 應產生 text event 作為重試通知", async () => {
    mockQueryImpl = async function* () {
      yield makeSystemInit();
      yield {
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        error_status: 529,
      };
      yield makeResultSuccess();
    };

    const ctx = makeCtx();
    const events = await collectEvents(claudeProvider.chat(ctx));

    // 應有至少一個 text event（重試通知）
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.length).toBeGreaterThan(0);
  });

  // ── Case 10：tool_progress 訊息 → tool_call_result ────────────────────
  it("tool_progress 含 output 欄位時應產生 tool_call_result", async () => {
    const toolId = "tool-progress-001";

    mockQueryImpl = async function* () {
      yield makeSystemInit();
      // 先送 tool_use 建立 activeTools map
      yield makeAssistantToolUse(toolId, "Read", { file: "README.md" });
      // tool_progress（含 output）
      yield {
        type: "tool_progress",
        tool_use_id: toolId,
        output: "# README Content",
      };
      yield makeResultSuccess();
    };

    const ctx = makeCtx();
    const events = await collectEvents(claudeProvider.chat(ctx));

    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults.length).toBeGreaterThan(0);
    const tr = toolResults[0] as Extract<
      NormalizedEvent,
      { type: "tool_call_result" }
    >;
    expect(tr.toolUseId).toBe(toolId);
    expect(tr.output).toBe("# README Content");
  });
});
