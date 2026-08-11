// ── Top-level mocks（必須在 import 前宣告）──────────────────────────────────

let mockQueryGenerator: any = null;

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...original,
    query: vi.fn((...args: any[]) => mockQueryGenerator(...args)),
  };
});

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  sanitizeSensitiveInfo: vi.fn((value: string) => value),
}));

// 注：buildClaudeContentBlocks 與 createUserMessageStream 為純函式，不需要 mock
// 測試使用 string message（不是 ContentBlock[]），這兩個函式在測試路徑中不會被呼叫

// ── Imports ──────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClaudeQuery } from "../../src/services/provider/claude/runClaudeQuery.js";
import type { ClaudeOptions } from "../../src/services/provider/claude/buildClaudeOptions.js";
import type { ChatRequestContext } from "../../src/services/provider/types.js";
import { GOAL_MCP_SERVER_NAME } from "../../src/services/goalRuntime.js";

// ── 輔助函式 ─────────────────────────────────────────────────────────────────

/**
 * 建立最小合法 ChatRequestContext（帶 ClaudeOptions）
 */
function createCtx(
  overrides: Partial<ChatRequestContext<ClaudeOptions>> = {},
): ChatRequestContext<ClaudeOptions> {
  return {
    podId: "pod-test",
    podName: "Pod Test",
    message: "Hello",
    workspacePath: "/canvas/test",
    resumeSessionId: null,
    abortSignal: new AbortController().signal,
    runContext: undefined,
    options: {
      model: "opus",
      allowedTools: ["Read", "Write"],
      settingSources: ["project"],
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    },
    ...overrides,
  };
}

/**
 * 消費 AsyncIterable，回傳所有 yield 的 item 陣列
 */
async function collectEvents<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

// ── 測試 ─────────────────────────────────────────────────────────────────────

describe("runClaudeQuery", () => {
  beforeEach(() => {
    mockQueryGenerator = null;
    vi.clearAllMocks();
  });

  describe("options 為 undefined 時立即 yield error 並 return", () => {
    it("應 yield type=error 事件，message 含 ClaudeOptions 未提供", async () => {
      const ctx = createCtx({ options: undefined });

      const events = await collectEvents(runClaudeQuery(ctx));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "error",
        fatal: true,
        recovery: "unrecoverable",
      });
      expect((events[0] as any).message).toContain("ClaudeOptions");
    });

    it("options 為 undefined 時不應呼叫 SDK（不 throw，只 yield error）", async () => {
      const ctx = createCtx({ options: undefined });

      // 若 SDK 被呼叫但 mockQueryGenerator 為 null 會 throw，
      // 此測試透過「不拋出」驗證 options=undefined 路徑跳過 SDK
      await expect(collectEvents(runClaudeQuery(ctx))).resolves.toBeDefined();
    });
  });

  describe("abortSignal 已觸發時（options=undefined 路徑）", () => {
    it("options=undefined 路徑下 abort signal 不影響輸出（提前 return error）", async () => {
      const controller = new AbortController();
      controller.abort();

      // options undefined → 提前 return error event，不走 abort 路徑
      const ctx = createCtx({
        abortSignal: controller.signal,
        options: undefined,
      });

      const events = await collectEvents(runClaudeQuery(ctx));
      expect(events[0]).toMatchObject({ type: "error", fatal: true });
    });
  });

  describe("buildPrompt 空字串 fallback 邏輯", () => {
    it("options=undefined 路徑下空字串不影響 error 輸出（buildPrompt 未被呼叫）", async () => {
      const ctx = createCtx({ message: "", options: undefined });

      const events = await collectEvents(runClaudeQuery(ctx));

      // options undefined → 只 yield error，不走 buildPrompt
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "error" });
    });
  });

  describe("Goal Runtime bootstrap", () => {
    it("無 Goal MCP 時應保留原始 string prompt，不注入 Goal Runtime bootstrap", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx({ message: "Hello" });
      await collectEvents(runClaudeQuery(ctx));

      const calledPrompt = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .prompt;
      expect(calledPrompt).toBe("Hello");
    });

    it("有 Goal MCP 時應將 string prompt 包成 request-level Goal Runtime bootstrap", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx({
        message: "go",
        options: {
          model: "opus",
          allowedTools: ["Read", "Write"],
          settingSources: ["project"],
          permissionMode: "bypassPermissions",
          includePartialMessages: true,
          pathToClaudeCodeExecutable: "/usr/local/bin/claude",
          mcpServers: {
            [GOAL_MCP_SERVER_NAME]: {
              command: "node",
              args: ["/tmp/goalMcpBridge.ts"],
              env: {},
            },
          },
        },
      });
      await collectEvents(runClaudeQuery(ctx));

      const called = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(called.prompt).toContain("User request: go");
      expect(called.prompt).toContain(
        "Start by calling get_active_goal_todo to read only the current active todo.",
      );
      expect(called.prompt).toContain(
        "Do not call get_goal_status just to learn what to work on",
      );
      expect("systemPrompt" in called.options).toBe(false);
    });

    it("有 Goal MCP 且 message 為 ContentBlock[] 時，應在第一個 content block 注入 bootstrap，保留原始內容", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx({
        message: [{ type: "text", text: "read package.json" }],
        options: {
          model: "opus",
          allowedTools: ["Read", "Write"],
          settingSources: ["project"],
          permissionMode: "bypassPermissions",
          includePartialMessages: true,
          pathToClaudeCodeExecutable: "/usr/local/bin/claude",
          mcpServers: {
            [GOAL_MCP_SERVER_NAME]: {
              command: "node",
              args: ["/tmp/goalMcpBridge.ts"],
              env: {},
            },
          },
        },
      });
      await collectEvents(runClaudeQuery(ctx));

      const calledPrompt = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .prompt as AsyncIterable<any>;
      const firstMessage = await calledPrompt[Symbol.asyncIterator]().next();
      expect(firstMessage.value.message.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining(
          "Start by calling get_active_goal_todo to read only the current active todo.",
        ),
      });
      expect(firstMessage.value.message.content[0].text).toContain(
        "Do not call get_goal_status just to learn what to work on",
      );
      expect(firstMessage.value.message.content[1]).toMatchObject({
        type: "text",
        text: "read package.json",
      });
    });
  });

  describe("Memory bootstrap", () => {
    it("fresh session 時應把 hiddenBootstrapSections 注入 prompt", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx({
        message: "continue",
        hiddenBootstrapSections: [
          "<pod-memory>\n記住要先跑測試\n</pod-memory>",
          "<repo-memory>\n專案慣例：先修測試再改功能\n</repo-memory>",
        ],
      });

      await collectEvents(runClaudeQuery(ctx));

      const calledPrompt = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .prompt;
      expect(calledPrompt).toContain("<pod-memory>");
      expect(calledPrompt).toContain("記住要先跑測試");
      expect(calledPrompt).toContain("<repo-memory>");
    });

    it("resume session 時不應再次注入 hiddenBootstrapSections", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx({
        message: "continue",
        resumeSessionId: "session-existing",
        hiddenBootstrapSections: [
          "<pod-memory>\n這段不應重複注入\n</pod-memory>",
        ],
      });

      await collectEvents(runClaudeQuery(ctx));

      const calledPrompt = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .prompt;
      expect(calledPrompt).toBe("continue");
      expect(calledPrompt).not.toContain("<pod-memory>");
    });
  });

  describe("handleResult：result/error subtype 的 yield 行為（不再 throw）", () => {
    it("result/error 時應 yield fatal=true system error，且 generator 不 throw", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "result",
          subtype: "error",
          errors: ["執行失敗"],
        };
      };

      const ctx = createCtx();

      // AI 終態錯誤標 fatal=true 但 generator 不再 throw（由 streamingChatExecutor 主迴圈 break），可直接 collect
      const events = await collectEvents(runClaudeQuery(ctx));

      expect(events).toHaveLength(1);
      const errorEvent = events[0] as any;
      expect(errorEvent.type).toBe("error");
      expect(errorEvent.fatal).toBe(true);
      expect(errorEvent.recovery).toBe("unrecoverable");
      expect(errorEvent.systemMessage?.metadata.recovery).toBe("unrecoverable");
      expect(errorEvent.systemMessage?.metadata.provider).toBe("claude");
      expect(errorEvent.code).toBe("RESULT_ERROR");
    });
  });

  describe("handleAssistant：error path（不再 throw）", () => {
    it("assistant message 帶 error 時應 yield fatal=true system error，且 generator 不 throw", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "assistant",
          message: { content: [] },
          error: "some_assistant_error",
        };
      };

      const ctx = createCtx();

      const events = await collectEvents(runClaudeQuery(ctx));

      const errorEvent = events.find((e: any) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.fatal).toBe(true);
      expect(errorEvent.recovery).toBe("unrecoverable");
      expect(errorEvent.code).toBe("ASSISTANT_ERROR");
    });
  });

  describe("handleRateLimitEvent：shouldAbort=true 時不再 throw 且 content 為人類可讀字串", () => {
    it("status=rejected 應 yield fatal=true system error，content 為英文可讀字串而非 raw JSON", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "rejected",
            rateLimitType: "five_hour",
            utilization: 0.95,
            resetsAt: 1700000000,
          },
        };
      };

      const ctx = createCtx();

      const events = await collectEvents(runClaudeQuery(ctx));

      const errorEvent = events.find((e: any) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.fatal).toBe(true);
      expect(errorEvent.recovery).toBe("unrecoverable");
      expect(errorEvent.code).toBe("RATE_LIMIT_REJECTED");

      // content 不再是 raw JSON
      const content = errorEvent.message as string;
      expect(content.startsWith("{")).toBe(false);
      // 包含可讀的英文 status / type 描述
      expect(content).toMatch(/Status|Rate limit/i);
      expect(content).toContain("five_hour");

      // rawContent 仍保留原始 JSON 字串（給 debug 用）
      const rawContent = errorEvent.systemMessage?.metadata
        .rawContent as string;
      expect(rawContent.startsWith("{")).toBe(true);
      expect(rawContent).toContain("rejected");
    });

    it("rate_limit_info 帶 message 欄位時優先使用 message 欄位作為 content", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "rejected",
            message: "You have hit the rate limit. Please retry later.",
          },
        };
      };

      const ctx = createCtx();
      const events = await collectEvents(runClaudeQuery(ctx));

      const errorEvent = events.find((e: any) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toBe(
        "You have hit the rate limit. Please retry later.",
      );
    });
  });

  describe("handleAuthStatus：shouldAbort=true 時不再 throw", () => {
    it("帶有 error 的 auth_status 應 yield fatal=true system error，且 generator 不 throw", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "auth_status",
          error: "authentication_failed",
        };
      };

      const ctx = createCtx();

      const events = await collectEvents(runClaudeQuery(ctx));

      const errorEvent = events.find((e: any) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.fatal).toBe(true);
      expect(errorEvent.recovery).toBe("unrecoverable");
      // 原始 SDK error 字串不再作為 code，改用固定常數避免洩漏 SDK 內部細節
      expect(errorEvent.systemMessage?.metadata.code).toBe("AUTH_STATUS_ERROR");
      expect(errorEvent.systemMessage?.metadata.recovery).toBe(
        "unrecoverable",
      );
    });
  });

  describe("abortSignal 串流結束後防禦性 throw（有 options 的路徑）", () => {
    it("SDK 串流結束後若 abortSignal 已觸發應拋出 AbortError", async () => {
      const controller = new AbortController();

      // SDK 串流空（result/success），然後 abort
      mockQueryGenerator = async function* () {
        // 模擬串流結束時 signal 已觸發
        controller.abort();
        yield {
          type: "result",
          subtype: "success",
          result: "done",
        };
      };

      const ctx = createCtx({ abortSignal: controller.signal });

      await expect(async () => {
        await collectEvents(runClaudeQuery(ctx));
      }).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("sdkOptions.stderr callback", () => {
    it("sdkOptions 傳入 SDK 時應含 stderr callback 函式", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx();
      await collectEvents(runClaudeQuery(ctx));

      expect(mockQuery).toHaveBeenCalledOnce();
      const calledOptions = (mockQuery as ReturnType<typeof vi.fn>).mock
        .calls[0][0].options;
      expect(typeof calledOptions.stderr).toBe("function");
    });
  });

  describe("Fast mode SDK 設定", () => {
    it("options.settings 應原樣傳入 Claude Agent SDK", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");
      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx({
        options: {
          ...createCtx().options!,
          settings: { fastMode: true },
        },
      });
      await collectEvents(runClaudeQuery(ctx));

      const calledOptions = (mockQuery as ReturnType<typeof vi.fn>).mock
        .calls[0][0].options;
      expect(calledOptions.settings).toEqual({ fastMode: true });
    });
  });

  describe("stderr diagnostics", () => {
    it("stderr 先於第一個 SDK message 到達時應先 yield 非 fatal 診斷事件，避免靜默卡住", async () => {
      mockQueryGenerator = ({ options }: any) =>
        (async function* () {
          setTimeout(() => {
            options.stderr?.("bwrap: cannot bind ~/.claude.json");
          }, 0);
          await new Promise((resolve) => setTimeout(resolve, 20));
          yield { type: "result", subtype: "success", result: "done" };
        })();

      const events = await collectEvents(runClaudeQuery(createCtx()));

      expect(events[0]).toMatchObject({
        type: "error",
        fatal: false,
        code: "STDERR_DIAGNOSTIC",
      });
      expect((events[0] as any).message).toContain(".claude.json");
      expect(events.some((event: any) => event.type === "turn_complete")).toBe(
        true,
      );
    });

    it("多段 stderr 輸出時只應產生一次診斷事件，避免重複洗版", async () => {
      mockQueryGenerator = ({ options }: any) =>
        (async function* () {
          setTimeout(() => {
            options.stderr?.("first stderr chunk");
          }, 0);
          setTimeout(() => {
            options.stderr?.("second stderr chunk");
          }, 5);
          await new Promise((resolve) => setTimeout(resolve, 20));
          yield { type: "result", subtype: "success", result: "done" };
        })();

      const events = await collectEvents(runClaudeQuery(createCtx()));
      const stderrEvents = events.filter(
        (event: any) => event.code === "STDERR_DIAGNOSTIC",
      );

      expect(stderrEvents).toHaveLength(1);
    });
  });

  describe("Claude SDK sandbox 傳遞規則", () => {
    it("預設 query options 不應包含 sandbox", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx();
      await collectEvents(runClaudeQuery(ctx));

      expect(mockQuery).toHaveBeenCalledOnce();
      const calledOptions = (mockQuery as ReturnType<typeof vi.fn>).mock
        .calls[0][0].options;

      expect(calledOptions).not.toHaveProperty("sandbox");
    });

  });

  // [B13] 帶 effort + thinking 時，SDK options 需含 effort 與 thinking 欄位
  // [B14] 不帶 effort / thinking 時，SDK options 不應含這兩個 key
  describe("[B13][B14] thinkingLevel 條件展開到 SDK options", () => {
    it("[B13] options.effort='xhigh' + thinking={type:'adaptive'} 時，sdkOptions 應同時含這兩欄", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      const ctx = createCtx({
        options: {
          model: "opus",
          allowedTools: ["Read"],
          settingSources: ["project"],
          permissionMode: "bypassPermissions",
          includePartialMessages: true,
          pathToClaudeCodeExecutable: "/usr/local/bin/claude",
          effort: "xhigh",
          thinking: { type: "adaptive" },
        } as ChatRequestContext<ClaudeOptions>["options"],
      });
      await collectEvents(runClaudeQuery(ctx));

      expect(mockQuery).toHaveBeenCalledOnce();
      const calledOptions = (mockQuery as ReturnType<typeof vi.fn>).mock
        .calls[0][0].options;
      expect(calledOptions.effort).toBe("xhigh");
      expect(calledOptions.thinking).toEqual({ type: "adaptive" });
    });

    it("[B14] 未帶 effort / thinking 時，sdkOptions 不應含這兩個 key（避免傳入 undefined 干擾 SDK）", async () => {
      const { query: mockQuery } =
        await import("@anthropic-ai/claude-agent-sdk");

      mockQueryGenerator = async function* () {
        yield { type: "result", subtype: "success", result: "done" };
      };

      // 預設 createCtx 的 options 不含 effort / thinking
      const ctx = createCtx();
      await collectEvents(runClaudeQuery(ctx));

      const calledOptions = (mockQuery as ReturnType<typeof vi.fn>).mock
        .calls[0][0].options;
      expect("effort" in calledOptions).toBe(false);
      expect("thinking" in calledOptions).toBe(false);
    });
  });
});
