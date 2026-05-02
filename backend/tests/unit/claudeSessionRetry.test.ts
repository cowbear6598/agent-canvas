let mockRunClaudeQuery: any = null;

vi.mock("../../src/services/provider/claude/runClaudeQuery.js", () => ({
  runClaudeQuery: vi.fn((...args: any[]) => mockRunClaudeQuery(...args)),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaudeOptions } from "../../src/services/provider/claude/buildClaudeOptions.js";
import { withSessionRetry } from "../../src/services/provider/claude/sessionRetry.js";
import type { ChatRequestContext } from "../../src/services/provider/types.js";

function createCtx(
  overrides: Partial<ChatRequestContext<ClaudeOptions>> = {},
): ChatRequestContext<ClaudeOptions> {
  return {
    podId: "pod-session-retry",
    message: "Hello",
    workspacePath: "/canvas/test",
    resumeSessionId: "session-before-retry",
    abortSignal: new AbortController().signal,
    runContext: undefined,
    options: {
      model: "sonnet",
      allowedTools: ["Read"],
      settingSources: ["project"],
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    },
    ...overrides,
  };
}

async function collectEvents<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("withSessionRetry", () => {
  beforeEach(() => {
    mockRunClaudeQuery = null;
    vi.clearAllMocks();
  });

  it("fatal session resume error event 應清掉 resumeSessionId 後重試一次", async () => {
    mockRunClaudeQuery = vi
      .fn()
      .mockImplementationOnce(async function* (
        ctx: ChatRequestContext<ClaudeOptions>,
      ) {
        expect(ctx.resumeSessionId).toBe("session-before-retry");
        yield {
          type: "error",
          message: "No conversation found with session ID: 123",
          fatal: true,
        };
      })
      .mockImplementationOnce(async function* (
        ctx: ChatRequestContext<ClaudeOptions>,
      ) {
        expect(ctx.resumeSessionId).toBeNull();
        yield { type: "text", content: "retry ok" };
        yield { type: "turn_complete" };
      });

    const events = await collectEvents(withSessionRetry(createCtx()));

    expect(mockRunClaudeQuery).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { type: "text", content: "retry ok" },
      { type: "turn_complete" },
    ]);
  });

  it("非 session 類 fatal error event 不應重試，原樣往上游 yield", async () => {
    mockRunClaudeQuery = async function* () {
      yield {
        type: "error",
        message: "billing_error",
        fatal: true,
      };
    };

    const events = await collectEvents(withSessionRetry(createCtx()));

    expect(events).toEqual([
      {
        type: "error",
        message: "billing_error",
        fatal: true,
      },
    ]);
  });
});
