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

vi.mock("../../src/services/claude/messageBuilder.js", () => ({
  buildClaudeContentBlocks: vi.fn().mockReturnValue([]),
  createUserMessageStream: vi.fn().mockReturnValue([]),
}));

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

  describe("handleResult：result/error subtype 的 yield + throw 行為", () => {
    it("result/error 時應先 yield 錯誤文字，再 throw", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "result",
          subtype: "error",
          errors: ["執行失敗"],
        };
      };

      const ctx = createCtx();

      const events: any[] = [];
      await expect(async () => {
        for await (const event of runClaudeQuery(ctx)) {
          events.push(event);
        }
      }).rejects.toThrow();

      // 應先 yield text 事件（錯誤說明），再拋出
      expect(events.length).toBeGreaterThanOrEqual(1);
      const textEvent = events.find((e: any) => e.type === "text");
      expect(textEvent).toBeDefined();
      expect(textEvent.content).toContain("⚠️");
    });
  });

  describe("handleRateLimitEvent：shouldAbort=true 時應 throw", () => {
    it("status=rejected 的 rate_limit_event 應先 yield text 再 throw", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected" },
        };
      };

      const ctx = createCtx();

      const events: any[] = [];
      await expect(async () => {
        for await (const event of runClaudeQuery(ctx)) {
          events.push(event);
        }
      }).rejects.toThrow();

      const textEvent = events.find((e: any) => e.type === "text");
      expect(textEvent).toBeDefined();
      expect(textEvent.content).toContain("⚠️");
    });
  });

  describe("handleAuthStatus：shouldAbort=true 時應 throw", () => {
    it("帶有 error 的 auth_status 應先 yield text 再 throw", async () => {
      mockQueryGenerator = async function* () {
        yield {
          type: "auth_status",
          error: "authentication_failed",
        };
      };

      const ctx = createCtx();

      const events: any[] = [];
      await expect(async () => {
        for await (const event of runClaudeQuery(ctx)) {
          events.push(event);
        }
      }).rejects.toThrow();

      const textEvent = events.find((e: any) => e.type === "text");
      expect(textEvent).toBeDefined();
      expect(textEvent.content).toContain("⚠️");
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
