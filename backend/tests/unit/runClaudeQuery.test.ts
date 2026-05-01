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
}));

// 注：buildClaudeContentBlocks 與 createUserMessageStream 為純函式，不需要 mock
// 測試使用 string message（不是 ContentBlock[]），這兩個函式在測試路徑中不會被呼叫

// ── Imports ──────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClaudeQuery } from "../../src/services/provider/claude/runClaudeQuery.js";
import type { ClaudeOptions } from "../../src/services/provider/claude/buildClaudeOptions.js";
import type { ChatRequestContext } from "../../src/services/provider/types.js";

// ── 輔助函式 ─────────────────────────────────────────────────────────────────

/**
 * 建立最小合法 ChatRequestContext（帶 ClaudeOptions）
 */
function createCtx(
  overrides: Partial<ChatRequestContext<ClaudeOptions>> = {},
): ChatRequestContext<ClaudeOptions> {
  return {
    podId: "pod-test",
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
      // 原始 SDK error 字串不再作為 code，改用固定常數避免洩漏 SDK 內部細節
      expect(errorEvent.systemMessage?.metadata.code).toBe("AUTH_STATUS_ERROR");
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
});
