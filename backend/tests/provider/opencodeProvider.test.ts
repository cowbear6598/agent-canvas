/**
 * OpencodeProvider 單元測試（SDK v2 主線）
 *
 * 對應 User Flow：
 *   - F1: opencode Pod 收到需要工具協助的回覆 → text delta + tool called/success/failed
 *   - F2: 穿插多段文字與多次工具操作 → 多筆 v2 事件序列
 *   - F3: 查看 run 對話紀錄 → session.idle 後 turn_complete
 *   - F4: 延續既有 opencode 對話 → resume session 不建立新 session
 *   - F5: 未登入或服務不可用時送出請求 → auth_missing / server_unreachable 錯誤
 *
 * Mock 策略：
 *   - 使用 setOpencodeClientFactory / resetOpencodeClientFactory 注入假 client，
 *     只 mock 自己定義的 OpencodeClientPort interface，不 mock SDK 內部實作。
 *   - 使用 setOpencodeServerStateFactory / resetOpencodeServerStateFactory 注入假 state。
 *   - 使用 setOpencodeServerFactory / resetOpencodeServerFactory 注入假 transient server。
 *   - v2 事件序列以 session.next.* 系列模擬，不使用 message.part.delta 舊版事件。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NormalizedEvent } from "../../src/services/provider/types.js";
import type { OpencodeClientPort } from "../../src/services/provider/opencodeProvider.js";

const { mockManagedMcpSurfaceService } = vi.hoisted(() => ({
  mockManagedMcpSurfaceService: {
    ensureSurface: vi.fn(),
    ensureChatSurface: vi.fn().mockResolvedValue(null),
    cleanupChatSurface: vi.fn().mockResolvedValue(undefined),
    buildPodMcpEntries: vi.fn().mockResolvedValue({
      entries: [],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    }),
  },
}));

vi.mock("../../src/services/mcp/managedMcpSurfaceService.js", () => ({
  AGENT_CANVAS_MANAGED_SURFACE_NAME: "agent_canvas_managed_surface",
  managedMcpSurfaceService: mockManagedMcpSurfaceService,
}));

import {
  opencodeProvider,
  setOpencodeClientFactory,
  resetOpencodeClientFactory,
  setOpencodeServerFactory,
  resetOpencodeServerFactory,
  setOpencodeServerStateFactory,
  resetOpencodeServerStateFactory,
  serializeV2ToolSuccessContent,
  serializeV2ToolFailureError,
} from "../../src/services/provider/opencodeProvider.js";
import type { ChatRequestContext } from "../../src/services/provider/types.js";
import type { OpencodeOptions } from "../../src/services/provider/opencodeProvider.js";
import {
  GOAL_MCP_SERVER_NAME,
  removeGoalRuntimeRun,
} from "../../src/services/goalRuntime.js";

// ── logger mock ────────────────────────────────────────────────────────
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ================================================================
// 工具函式
// ================================================================

/** 收集 AsyncIterable 成陣列 */
async function collectEvents(
  iterable: AsyncIterable<NormalizedEvent>,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

/** 從事件陣列建立 SSE AsyncGenerator（v2 事件序列） */
async function* eventsToStream(events: unknown[]): AsyncGenerator<unknown> {
  for (const event of events) {
    yield event;
  }
}

/** 建立基本 mock client（OpencodeClientPort 介面，v2 形狀） */
function makeMockClient(
  overrides?: Partial<OpencodeClientPort>,
): OpencodeClientPort {
  const defaultCreate = vi
    .fn()
    .mockResolvedValue({ data: { id: "mock-session-id" } });
  const defaultPrompt = vi.fn().mockResolvedValue({ data: {} });
  const defaultAbort = vi.fn().mockResolvedValue({ data: true });
  const defaultMessages = vi.fn().mockResolvedValue({ data: [] });
  const defaultToolIds = vi.fn().mockResolvedValue({ data: [] });
  const defaultSubscribe = vi
    .fn()
    .mockResolvedValue({ stream: eventsToStream([]) });

  const base: OpencodeClientPort = {
    session: {
      create: defaultCreate,
      prompt: defaultPrompt,
      abort: defaultAbort,
      messages: defaultMessages,
    },
    tool: {
      ids: defaultToolIds,
    },
    event: {
      subscribe: defaultSubscribe,
    },
  };

  if (!overrides) return base;

  // session/tool/event 子物件做深合併，避免覆蓋未指定的預設值
  return {
    ...base,
    ...overrides,
    session: {
      ...base.session,
      ...overrides.session,
    },
    tool: {
      ...base.tool,
      ...overrides.tool,
    },
    event: {
      ...base.event,
      ...overrides.event,
    },
  };
}

/** 建立基本 ChatRequestContext */
function makeCtx(
  overrides?: Partial<ChatRequestContext<OpencodeOptions>>,
): ChatRequestContext<OpencodeOptions> {
  return {
    podId: "test-pod-id",
    podName: "test-pod",
    message: "hello",
    workspacePath: "/tmp/workspace",
    resumeSessionId: null,
    abortSignal: new AbortController().signal,
    options: {
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
      mcpEntries: [],
      hasGoalRuntime: false,
      pluginCatalogText: "",
    },
    ...overrides,
  };
}

function makeNeverStream(): AsyncGenerator<unknown> {
  return {
    next: vi.fn().mockImplementation(
      () => new Promise<IteratorResult<unknown>>(() => undefined),
    ),
    return: vi
      .fn()
      .mockResolvedValue({ done: true, value: undefined as unknown }),
    throw: vi.fn(),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as unknown as AsyncGenerator<unknown>;
}

async function waitForMockCall(
  mockFn: { mock: { calls: unknown[][] } },
  minCalls: number = 1,
): Promise<void> {
  for (let index = 0; index < 20; index++) {
    if (mockFn.mock.calls.length >= minCalls) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`mock was not called ${minCalls} time(s) in time`);
}

function makeBuildOptionsPod(
  overrides: Partial<{
    providerConfig: { model: string };
    mcpServerNames: string[];
    goal: { todos: Array<{ id: string; text: string }> } | null;
  }> = {},
) {
  return {
    id: "opencode-buildopts-pod",
    name: "Opencode Goal Pod",
    provider: "opencode",
    status: "idle",
    providerConfig: overrides.providerConfig ?? {
      model: "anthropic/claude-sonnet-4-5",
    },
    workspacePath: "/tmp/opencode-buildopts",
    skillIds: [],
    mcpServerNames: overrides.mcpServerNames ?? [],
    pluginIds: [],
    integrationBindings: [],
    repositoryId: null,
    multiInstance: false,
    sessionId: null,
    x: 0,
    y: 0,
    rotation: 0,
    goal: overrides.goal === undefined ? null : overrides.goal,
  } as any;
}

// ================================================================
// Setup / Teardown
// ================================================================

beforeEach(() => {
  // 預設 server state 為 ready
  setOpencodeServerStateFactory(() => ({
    baseUrl: "http://127.0.0.1:4096",
    status: "ready",
  }));
  mockManagedMcpSurfaceService.buildPodMcpEntries.mockClear();
  mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
    entries: [],
    ignoredTargets: [],
    hasGoalRuntime: false,
    pluginCatalog: [],
  });
});

afterEach(() => {
  resetOpencodeClientFactory();
  resetOpencodeServerFactory();
  resetOpencodeServerStateFactory();
  removeGoalRuntimeRun("run-opencode-goal");
  vi.restoreAllMocks();
});

// ================================================================
// buildOptions
// ================================================================

describe("buildOptions", () => {
  it("有 runContext 時應呼叫 buildPodMcpEntries 並把 entries 注入 options", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "agent_canvas_goal",
          transport: "stdio",
          command: "/usr/local/bin/bun",
          args: ["/tmp/goalMcpBridge.ts"],
          env: { AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-state.json" },
          cwd: null,
          proxied: false,
        },
        {
          name: "team-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: true,
      pluginCatalog: [],
    });

    const pod = makeBuildOptionsPod({
      mcpServerNames: ["team-server"],
      goal: {
        todos: [{ id: "todo-1", text: "Finish Goal Runtime handoff" }],
      },
    });
    const runContext = {
      runId: "run-opencode-goal",
      canvasId: "canvas-opencode-goal",
      sourcePodId: pod.id,
    };

    const options = await opencodeProvider.buildOptions(pod, runContext);

    expect(options.providerID).toBe("anthropic");
    expect(options.modelID).toBe("claude-sonnet-4-5");
    expect(
      mockManagedMcpSurfaceService.buildPodMcpEntries,
    ).toHaveBeenCalledWith(pod, runContext);
    expect(options.hasGoalRuntime).toBe(true);
    expect(options.mcpEntries).toHaveLength(2);
    expect(options.mcpEntries[0]?.name).toBe("agent_canvas_goal");
    expect(options.mcpEntries[1]?.name).toBe("team-server");
  });

  it("有 runContext 且無 Goal 時 hasGoalRuntime 為 false", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "team-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });

    const pod = makeBuildOptionsPod({
      mcpServerNames: ["team-server"],
      goal: null,
    });

    const options = await opencodeProvider.buildOptions(pod, {
      runId: "run-opencode-no-goal",
      canvasId: "canvas-opencode-no-goal",
      sourcePodId: pod.id,
    });

    expect(options.hasGoalRuntime).toBe(false);
    expect(options.mcpEntries[0]?.name).toBe("team-server");
  });

  it("沒有 runContext 時不應注入 Goal MCP", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "team-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });

    const pod = makeBuildOptionsPod({
      mcpServerNames: ["team-server"],
      goal: null,
    });

    const options = await opencodeProvider.buildOptions(pod);

    expect(options.hasGoalRuntime).toBe(false);
    expect(options.mcpEntries).toEqual([
      expect.objectContaining({ name: "team-server" }),
    ]);
  });

  it("Chat 模式 buildPodMcpEntries 取得的 entries 注入 options（無 Goal Runtime）", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "team-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });

    const pod = makeBuildOptionsPod({
      mcpServerNames: ["team-server"],
      goal: null,
    });
    const options = await opencodeProvider.buildOptions(pod);

    expect(
      mockManagedMcpSurfaceService.buildPodMcpEntries,
    ).toHaveBeenCalledWith(pod, null);
    expect(options.mcpEntries).toEqual([
      expect.objectContaining({ name: "team-server" }),
    ]);
    expect(options.hasGoalRuntime).toBe(false);
  });

  it("Opencode pod 勾 http target 時 buildPodMcpEntries 回 remote entry 原樣保留", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "remote-mcp",
          transport: "http",
          url: "https://example.com/mcp",
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });

    const pod = makeBuildOptionsPod({ mcpServerNames: ["remote-mcp"] });
    const options = await opencodeProvider.buildOptions(pod);

    expect(options.mcpEntries).toEqual([
      { name: "remote-mcp", transport: "http", url: "https://example.com/mcp" },
    ]);
  });
});

// ================================================================
// P3.A.t1 — 以 OpencodeClientPort、server state factory、transient server factory 為 mock 邊界
// ================================================================

describe("chat — resumeSessionId=null → session_started 且 sessionId 等於 session.create 回傳", () => {
  it("chat 第一個 yield 應為 session_started 且 sessionId 來自 session.create", async () => {
    const mockSessionId = "new-session-abc";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: mockSessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            { type: "session.idle", properties: { sessionID: mockSessionId } },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({ resumeSessionId: null });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const firstEvent = events[0];
    expect(firstEvent?.type).toBe("session_started");
    expect(
      (firstEvent as Extract<NormalizedEvent, { type: "session_started" }>)
        .sessionId,
    ).toBe(mockSessionId);
  });

  it("session.create 失敗時應 yield session 錯誤並停止", async () => {
    const mockClient = makeMockClient({
      session: {
        create: vi
          .fn()
          .mockRejectedValue(new Error("connection refused to opencode")),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({ resumeSessionId: null });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    // 連線失敗應回傳 server_unreachable 錯誤
    expect(events).toHaveLength(1);
    const errEvent = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.type).toBe("error");
    expect(errEvent.code).toBe("opencode_server_unreachable");
  });

  it("session.create 回傳無 id 時應 yield session 建立失敗錯誤", async () => {
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: null }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({ resumeSessionId: null });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    expect(events).toHaveLength(1);
    const errEvent = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.type).toBe("error");
    expect(errEvent.code).toBe("opencode_session_failed");
  });
});

// ================================================================
// P3.A.t2 — v2 專屬案例
// ================================================================

describe("chat — v2 session.next.text.delta → text event（F1: 逐段顯示文字）", () => {
  it("session.next.text.delta 應 yield text event 帶 delta 內容", async () => {
    const sessionId = "text-delta-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.text.delta",
              properties: { sessionID: sessionId, delta: "Hello, " },
            },
            {
              type: "session.next.text.delta",
              properties: { sessionID: sessionId, delta: "world!" },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const textEvents = events.filter((e) => e.type === "text");

    expect(textEvents).toHaveLength(2);
    expect(
      (textEvents[0] as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("Hello, ");
    expect(
      (textEvents[1] as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("world!");
  });

  it("delta 為空字串時不應 yield text event", async () => {
    const sessionId = "empty-delta-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.text.delta",
              properties: { sessionID: sessionId, delta: "" },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(0);
  });
});

describe("chat — v2 session.next.reasoning.delta → thinking event", () => {
  it("session.next.reasoning.delta 應 yield thinking event 帶 delta 內容", async () => {
    const sessionId = "reasoning-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.reasoning.delta",
              properties: { sessionID: sessionId, delta: "Let me think..." },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const thinkingEvent = events.find((e) => e.type === "thinking");

    expect(thinkingEvent).toBeDefined();
    expect(
      (thinkingEvent as Extract<NormalizedEvent, { type: "thinking" }>).content,
    ).toBe("Let me think...");
  });

  it("reasoning delta 為空字串時不應 yield thinking event", async () => {
    const sessionId = "empty-reasoning-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.reasoning.delta",
              properties: { sessionID: sessionId, delta: "" },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const thinkingEvents = events.filter((e) => e.type === "thinking");
    expect(thinkingEvents).toHaveLength(0);
  });
});

describe("chat — v2 session.next.tool.called → tool_call_start event（F1: 工具與文字分開顯示）", () => {
  it("session.next.tool.called 應 yield tool_call_start 帶 callID、toolName、input", async () => {
    const sessionId = "tool-called-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.tool.called",
              properties: {
                sessionID: sessionId,
                callID: "call-001",
                tool: "bash",
                input: { command: "ls -la" },
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const toolStartEvent = events.find((e) => e.type === "tool_call_start");

    expect(toolStartEvent).toBeDefined();
    const te = toolStartEvent as Extract<
      NormalizedEvent,
      { type: "tool_call_start" }
    >;
    expect(te.toolUseId).toBe("call-001");
    expect(te.toolName).toBe("bash");
    expect(te.input).toEqual({ command: "ls -la" });
  });
});

describe("chat — v2 session.next.tool.success → tool_call_result event（F2: 工具輸出可回看）", () => {
  it("tool.called → tool.success 序列應產出 tool_call_start + tool_call_result，並攜帶 toolName", async () => {
    const sessionId = "tool-success-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.tool.called",
              properties: {
                sessionID: sessionId,
                callID: "call-002",
                tool: "read_file",
                input: { path: "/tmp/test.txt" },
              },
            },
            {
              type: "session.next.tool.success",
              properties: {
                sessionID: sessionId,
                callID: "call-002",
                content: [{ type: "text", text: "file content here" }],
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const resultEvent = events.find((e) => e.type === "tool_call_result");

    expect(resultEvent).toBeDefined();
    const re = resultEvent as Extract<
      NormalizedEvent,
      { type: "tool_call_result" }
    >;
    expect(re.toolUseId).toBe("call-002");
    expect(re.toolName).toBe("read_file");
    expect(re.output).toBe("file content here");
  });

  it("tool.success 的 content 包含 file 型別時應格式化成 [file: <name> (<mime>)]", async () => {
    const sessionId = "tool-file-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.tool.called",
              properties: {
                sessionID: sessionId,
                callID: "call-file",
                tool: "screenshot",
                input: {},
              },
            },
            {
              type: "session.next.tool.success",
              properties: {
                sessionID: sessionId,
                callID: "call-file",
                content: [
                  {
                    type: "file",
                    uri: "file:///tmp/shot.png",
                    mime: "image/png",
                    name: "shot.png",
                  },
                ],
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const resultEvent = events.find(
      (e) => e.type === "tool_call_result",
    ) as Extract<NormalizedEvent, { type: "tool_call_result" }>;

    expect(resultEvent.output).toBe("[file: shot.png (image/png)]");
  });
});

describe("chat — v2 session.next.tool.failed → tool_call_result event（帶 error 輸出）", () => {
  it("tool.called → tool.failed 序列應產出 tool_call_start + tool_call_result，output 以 [Error] 開頭", async () => {
    const sessionId = "tool-failed-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.tool.called",
              properties: {
                sessionID: sessionId,
                callID: "call-003",
                tool: "bash",
                input: { command: "rm -rf /" },
              },
            },
            {
              type: "session.next.tool.failed",
              properties: {
                sessionID: sessionId,
                callID: "call-003",
                error: { message: "Permission denied" },
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const resultEvent = events.find(
      (e) => e.type === "tool_call_result",
    ) as Extract<NormalizedEvent, { type: "tool_call_result" }>;

    expect(resultEvent).toBeDefined();
    expect(resultEvent.toolUseId).toBe("call-003");
    expect(resultEvent.toolName).toBe("bash");
    expect(resultEvent.output).toBe("[Error] Permission denied");
  });

  it("tool.failed 沒有 error 訊息時應 fallback 到 '[Error] tool failed'", async () => {
    const sessionId = "tool-failed-no-msg-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.tool.called",
              properties: {
                sessionID: sessionId,
                callID: "call-004",
                tool: "read_file",
                input: {},
              },
            },
            {
              type: "session.next.tool.failed",
              properties: {
                sessionID: sessionId,
                callID: "call-004",
                error: null,
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const resultEvent = events.find(
      (e) => e.type === "tool_call_result",
    ) as Extract<NormalizedEvent, { type: "tool_call_result" }>;

    expect(resultEvent.output).toBe("[Error] tool failed");
  });
});

describe("chat — v2 resume session（F4: 延續既有對話）", () => {
  it("resumeSessionId 非 null 時 session.create 不應被呼叫", async () => {
    const createMock = vi.fn().mockResolvedValue({ data: { id: "new-id" } });
    const mockClient = makeMockClient({
      session: {
        create: createMock,
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "existing-session" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({ resumeSessionId: "existing-session" });
    await collectEvents(opencodeProvider.chat(ctx));

    expect(createMock).not.toHaveBeenCalled();
  });

  it("resume session 時 session.prompt 使用的 sessionID 為既有 session", async () => {
    const promptMock = vi.fn().mockResolvedValue({ data: {} });
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "new-id" } }),
        prompt: promptMock,
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "resume-session-xyz" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({ resumeSessionId: "resume-session-xyz" });
    await collectEvents(opencodeProvider.chat(ctx));

    const promptArg = promptMock.mock.calls[0]?.[0] as { sessionID: string };
    expect(promptArg?.sessionID).toBe("resume-session-xyz");
  });

  it("resume session 時不 yield session_started（沿用 session 不重新開始）", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "resume-session-abc" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({ resumeSessionId: "resume-session-abc" });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const sessionStartedEvents = events.filter(
      (e) => e.type === "session_started",
    );
    expect(sessionStartedEvents).toHaveLength(0);
  });

  it("resume session 時 text delta 仍正常分段顯示（F4 驗證）", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.text.delta",
              properties: {
                sessionID: "resume-session-abc",
                delta: "繼續輸出",
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: "resume-session-abc" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({ resumeSessionId: "resume-session-abc" });
    const events = await collectEvents(opencodeProvider.chat(ctx));
    const textEvent = events.find((e) => e.type === "text");

    expect(textEvent).toBeDefined();
    expect(
      (textEvent as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("繼續輸出");
  });
});

describe("chat — v2 unrelated session 過濾（同 workspace 多 session 廣播）", () => {
  it("屬於其他 sessionID 的事件應被忽略，不 yield 任何內容", async () => {
    const mySessionId = "my-session-id";
    const otherSessionId = "other-session-id";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: mySessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            // 屬於另一個 session 的文字事件，應被忽略
            {
              type: "session.next.text.delta",
              properties: { sessionID: otherSessionId, delta: "不應顯示" },
            },
            // 屬於自己的 idle 事件
            {
              type: "session.idle",
              properties: { sessionID: mySessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const textEvents = events.filter((e) => e.type === "text");

    expect(textEvents).toHaveLength(0);
  });

  it("自己 session 的事件應正常處理，其他 session 事件一起出現時不干擾", async () => {
    const mySessionId = "my-session-002";
    const otherSessionId = "other-session-002";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: mySessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            // 別人的事件
            {
              type: "session.next.text.delta",
              properties: { sessionID: otherSessionId, delta: "他人的內容" },
            },
            // 自己的事件
            {
              type: "session.next.text.delta",
              properties: { sessionID: mySessionId, delta: "我的內容" },
            },
            {
              type: "session.idle",
              properties: { sessionID: mySessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const textEvents = events.filter((e) => e.type === "text");

    expect(textEvents).toHaveLength(1);
    expect(
      (textEvents[0] as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("我的內容");
  });
});

describe("chat — v2 session.idle → turn_complete 並結束（F3: 對話紀錄顯示）", () => {
  it("session.idle event 應 yield turn_complete", async () => {
    const sessionId = "idle-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const turnComplete = events.find((e) => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();
  });

  it("session.idle 後 generator 應結束（不產生更多事件）", async () => {
    const sessionId = "idle-stop-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
            // idle 後的事件不應被處理
            {
              type: "session.next.text.delta",
              properties: { sessionID: sessionId, delta: "after idle" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(0);
  });
});

describe("chat — prompt / plugin waiting failure handling", () => {
  it("session.prompt resolve with error 時應 yield fatal error 並停止", async () => {
    const sessionId = "prompt-error-session";
    const neverStream = makeNeverStream();
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({
          error: { data: { message: "plugin prompt failed" } },
        }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({ stream: neverStream }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));

    expect(events).toHaveLength(2);
    const errEvent = events[1] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.code).toBe("opencode_prompt_failed");
    expect(errEvent.fatal).toBe(true);
    expect(errEvent.message).toContain("plugin prompt failed");
    expect(events.find((event) => event.type === "turn_complete")).toBeUndefined();
    expect(neverStream.return).toHaveBeenCalled();
  });

  it("session.prompt reject 時應 yield fatal error 並停止", async () => {
    const sessionId = "prompt-reject-session";
    const neverStream = makeNeverStream();
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi
          .fn()
          .mockRejectedValue(new Error("prompt transport disconnected")),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({ stream: neverStream }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));

    expect(events).toHaveLength(2);
    const errEvent = events[1] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.code).toBe("opencode_prompt_failed");
    expect(errEvent.fatal).toBe(true);
    expect(errEvent.message).toContain("prompt transport disconnected");
    expect(events.find((event) => event.type === "turn_complete")).toBeUndefined();
    expect(neverStream.return).toHaveBeenCalled();
  });

  it("permission.asked 應 fail fast，避免 session 無限等待", async () => {
    const sessionId = "permission-asked-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "permission.asked",
              properties: {
                sessionID: sessionId,
                permission: "skill",
                patterns: ["/Users/test/.codex/plugins/cache/foo/SKILL.md"],
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));

    expect(events).toHaveLength(2);
    const errEvent = events[1] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.code).toBe("opencode_permission_blocked");
    expect(errEvent.fatal).toBe(true);
    expect(errEvent.message).toContain("skill");
    expect(events.find((event) => event.type === "turn_complete")).toBeUndefined();
  });

  it("question.asked 應 fail fast，避免 session 無限等待", async () => {
    const sessionId = "question-asked-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "question.asked",
              properties: {
                sessionID: sessionId,
                questions: [
                  {
                    header: "Choose fix",
                    question: "Which plugin skill should I use?",
                    options: [],
                  },
                ],
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));

    expect(events).toHaveLength(2);
    const errEvent = events[1] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.code).toBe("opencode_question_blocked");
    expect(errEvent.fatal).toBe(true);
    expect(errEvent.message).toContain("Choose fix");
    expect(events.find((event) => event.type === "turn_complete")).toBeUndefined();
  });

  it("workspace.failed 應回報 fatal error 並停止", async () => {
    const sessionId = "workspace-failed-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "workspace.failed",
              properties: {
                sessionID: sessionId,
                message: "workspace bootstrap failed",
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: sessionId },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));

    expect(events).toHaveLength(2);
    const errEvent = events[1] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.code).toBe("opencode_workspace_failed");
    expect(errEvent.fatal).toBe(true);
    expect(errEvent.message).toContain("workspace bootstrap failed");
    expect(events.find((event) => event.type === "turn_complete")).toBeUndefined();
  });
});

// ================================================================
// P3.A.t3 — 回歸案例
// ================================================================

describe("chat — auth 缺失（F5: 未登入時顯示錯誤）", () => {
  it("session.error 含 'No auth credentials found' 應 yield opencode_auth_missing", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.error",
              properties: {
                sessionID: "mock-session-id",
                error: {
                  name: "ProviderAuthError",
                  data: { message: "No auth credentials found for provider" },
                },
              },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const providerID = "anthropic";
    const ctx = makeCtx({
      options: {
        providerID,
        modelID: "claude-sonnet-4-5",
        mcpEntries: [],
        hasGoalRuntime: false,
        pluginCatalogText: "",
      },
    });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    const ee = errorEvent as Extract<NormalizedEvent, { type: "error" }>;
    expect(ee.code).toBe("opencode_auth_missing");
    expect(ee.message).toContain(providerID);
    expect(ee.message).toContain("opencode auth login");
  });

  it("session.error 含 'API key' 也應 yield opencode_auth_missing", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.error",
              properties: {
                sessionID: "mock-session-id",
                error: {
                  name: "APIError",
                  data: { message: "Invalid API key provided" },
                },
              },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      options: {
        providerID: "openai",
        modelID: "gpt-4o",
        mcpEntries: [],
        hasGoalRuntime: false,
        pluginCatalogText: "",
      },
    });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const errorEvent = events.find((e) => e.type === "error");
    expect(
      (errorEvent as Extract<NormalizedEvent, { type: "error" }>).code,
    ).toBe("opencode_auth_missing");
  });
});

describe("chat — server 不可用（F5: 服務不可用時顯示錯誤）", () => {
  it("server state baseUrl=null 應 yield opencode_server_unreachable 並結束", async () => {
    setOpencodeServerStateFactory(() => ({
      baseUrl: null,
      status: "failed",
    }));

    const ctx = makeCtx();
    const events = await collectEvents(opencodeProvider.chat(ctx));

    expect(events).toHaveLength(1);
    const errEvent = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.type).toBe("error");
    expect(errEvent.code).toBe("opencode_server_unreachable");
  });

  it("session.error 含 'connection refused' 應 yield opencode_server_unreachable", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.error",
              properties: {
                sessionID: "mock-session-id",
                error: {
                  name: "NetworkError",
                  data: { message: "connection refused to 127.0.0.1:4096" },
                },
              },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const errorEvent = events.find((e) => e.type === "error") as Extract<
      NormalizedEvent,
      { type: "error" }
    >;

    expect(errorEvent.code).toBe("opencode_server_unreachable");
    expect(errorEvent.fatal).toBe(true);
  });

  it("session.next.step.failed 應 yield session_failed 分類錯誤", async () => {
    const sessionId = "step-failed-session";
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.next.step.failed",
              properties: {
                sessionID: sessionId,
                error: { type: "ModelError", message: "模型發生未知錯誤" },
              },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));
    const errorEvent = events.find((e) => e.type === "error") as Extract<
      NormalizedEvent,
      { type: "error" }
    >;

    expect(errorEvent).toBeDefined();
    expect(errorEvent.code).toBe("opencode_session_failed");
  });
});

describe("chat — abort cleanup", () => {
  it("abort 後 session.abort 應以正確 sessionID 被呼叫（v2 形狀）", async () => {
    const mockSessionId = "abort-test-session";
    const abortController = new AbortController();
    const abortMock = vi.fn().mockResolvedValue({ data: true });

    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: mockSessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: abortMock,
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: (async function* () {
            abortController.abort();
            yield {
              type: "session.idle",
              properties: { sessionID: mockSessionId },
            };
          })(),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      resumeSessionId: null,
      abortSignal: abortController.signal,
    });

    await collectEvents(opencodeProvider.chat(ctx));

    expect(abortMock).toHaveBeenCalled();
    // v2 SDK: abort 使用 sessionID 取代 path.id
    const callArg = abortMock.mock.calls[0]?.[0] as { sessionID: string };
    expect(callArg?.sessionID).toBe(mockSessionId);
  });

  it("abortSignal 已 abort 時，應立刻呼叫 session.abort", async () => {
    const mockSessionId = "already-aborted-session";
    const abortController = new AbortController();
    abortController.abort(); // 先 abort

    const abortMock = vi.fn().mockResolvedValue({ data: true });

    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: mockSessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: abortMock,
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            { type: "session.idle", properties: { sessionID: mockSessionId } },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      resumeSessionId: null,
      abortSignal: abortController.signal,
    });

    await collectEvents(opencodeProvider.chat(ctx));

    expect(abortMock).toHaveBeenCalled();
  });

  it("event.subscribe 失敗時應 yield session error 並停止", async () => {
    const mockClient = makeMockClient({
      session: {
        create: vi
          .fn()
          .mockResolvedValue({ data: { id: "subscribe-fail-session" } }),
        prompt: vi.fn().mockResolvedValue({ data: {} }),
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi
          .fn()
          .mockRejectedValue(new Error("fetch failed connecting to opencode")),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const events = await collectEvents(opencodeProvider.chat(makeCtx()));

    expect(events).toHaveLength(2); // session_started + error
    const errEvent = events.find((e) => e.type === "error") as Extract<
      NormalizedEvent,
      { type: "error" }
    >;
    expect(errEvent.code).toBe("opencode_server_unreachable");
  });
});

describe("chat — Goal Runtime bootstrap prompt（新 session 第一輪注入）", () => {
  it("有 Goal MCP 時 session.prompt 的 parts[0].text 應含 bootstrap 指示", async () => {
    const createServerMock = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:63312",
      close: vi.fn(),
    });
    setOpencodeServerFactory(createServerMock as typeof createServerMock);

    const promptMock = vi.fn().mockResolvedValue({ data: {} });
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "goal-session-id" } }),
        prompt: promptMock,
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "goal-session-id" },
            },
          ]),
        }),
      },
    });
    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      message: "go",
      options: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        mcpEntries: [
          {
            name: GOAL_MCP_SERVER_NAME,
            transport: "stdio",
            command: process.execPath,
            args: ["/tmp/goalMcpBridge.ts"],
            env: { AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json" },
            cwd: null,
            proxied: false,
          },
        ],
        hasGoalRuntime: true,
        pluginCatalogText: "",
      },
    });

    await collectEvents(opencodeProvider.chat(ctx));
    await waitForMockCall(promptMock);

    // v2 SDK: prompt 使用平鋪參數形狀，parts 直接在頂層
    const promptArg = promptMock.mock.calls[0]?.[0] as {
      parts: Array<{ type: "text"; text: string }>;
    };
    expect(promptArg.parts[0]?.text).toContain("User request: go");
    expect(promptArg.parts[0]?.text).toContain(
      "Start by calling Goal Runtime to inspect the current status and active todo.",
    );
    expect(promptArg.parts[0]?.text).toContain(
      "Then continue with the current active todo instead of asking for a new task.",
    );
  });

  it("resume session 時不注入 Goal Runtime bootstrap prompt（避免覆蓋 nudge）", async () => {
    const createServerMock = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:63313",
      close: vi.fn(),
    });
    setOpencodeServerFactory(createServerMock as typeof createServerMock);

    const promptMock = vi.fn().mockResolvedValue({ data: {} });
    const mockClient = makeMockClient({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "resume-goal-id" } }),
        prompt: promptMock,
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "resume-goal-id" },
            },
          ]),
        }),
      },
    });
    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      message: "continue",
      resumeSessionId: "resume-goal-id",
      options: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        mcpEntries: [
          {
            name: GOAL_MCP_SERVER_NAME,
            transport: "stdio",
            command: process.execPath,
            args: ["/tmp/goalMcpBridge.ts"],
            env: { AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json" },
            cwd: null,
            proxied: false,
          },
        ],
        hasGoalRuntime: true,
        pluginCatalogText: "",
      },
    });

    await collectEvents(opencodeProvider.chat(ctx));
    await waitForMockCall(promptMock);

    const promptArg = promptMock.mock.calls[0]?.[0] as {
      parts: Array<{ type: "text"; text: string }>;
    };
    // resume 時應直接送出原始訊息，不含 bootstrap 指示
    expect(promptArg.parts[0]?.text).toBe("continue");
    expect(promptArg.parts[0]?.text).not.toContain("Goal Runtime");
  });
});

describe("chat — managed MCP transient server 仍可運作", () => {
  it("有 Goal MCP 時應使用 transient server、port=0，並帶正確 local MCP config", async () => {
    const createServerMock = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:63314",
      close: vi.fn(),
    });
    setOpencodeServerFactory(createServerMock as typeof createServerMock);

    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "goal-session-id" },
            },
          ]),
        }),
      },
    });
    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      options: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        mcpEntries: [
          {
            name: GOAL_MCP_SERVER_NAME,
            transport: "stdio",
            command: process.execPath,
            args: ["/tmp/goalMcpBridge.ts"],
            env: {
              AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json",
            },
            cwd: null,
            proxied: false,
          },
        ],
        hasGoalRuntime: true,
        pluginCatalogText: "",
      },
    });

    await collectEvents(opencodeProvider.chat(ctx));

    expect(createServerMock).toHaveBeenCalledWith({
      port: 0,
      timeout: 30000,
      config: {
        mcp: {
          [GOAL_MCP_SERVER_NAME]: {
            type: "local",
            command: [process.execPath, "/tmp/goalMcpBridge.ts"],
            environment: {
              AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json",
            },
            enabled: true,
          },
        },
        permission: "allow",
      },
    });
  });

  it("entries 非空時應建立 transient server，stdio + remote entry 都進 config.mcp", async () => {
    const createServerMock = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:63315",
      close: vi.fn(),
    });
    setOpencodeServerFactory(createServerMock as typeof createServerMock);

    const promptMock = vi.fn().mockResolvedValue({ data: {} });
    const mockClient = makeMockClient({
      session: {
        create: vi
          .fn()
          .mockResolvedValue({ data: { id: "entries-session-id" } }),
        prompt: promptMock,
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "entries-session-id" },
            },
          ]),
        }),
      },
    });
    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      options: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        mcpEntries: [
          {
            name: GOAL_MCP_SERVER_NAME,
            transport: "stdio",
            command: process.execPath,
            args: ["/tmp/goalMcpBridge.ts"],
            env: {
              AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json",
            },
            cwd: null,
            proxied: false,
          },
          {
            name: "remote-mcp",
            transport: "http",
            url: "https://example.com/mcp",
          },
        ],
        hasGoalRuntime: true,
        pluginCatalogText: "",
      },
    });

    await collectEvents(opencodeProvider.chat(ctx));

    expect(createServerMock).toHaveBeenCalledWith({
      port: 0,
      timeout: 30000,
      config: {
        mcp: {
          [GOAL_MCP_SERVER_NAME]: {
            type: "local",
            command: [process.execPath, "/tmp/goalMcpBridge.ts"],
            environment: {
              AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json",
            },
            enabled: true,
          },
          "remote-mcp": {
            type: "remote",
            url: "https://example.com/mcp",
            enabled: true,
          },
        },
        permission: "allow",
      },
    });
    // v2 SDK: prompt 使用平鋪參數，entries 非空時不送 tools subset
    expect(promptMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        tools: expect.anything(),
      }),
    );
  });

  it("transient server 建立失敗時應 yield opencode_server_unreachable 並停止", async () => {
    const createServerMock = vi
      .fn()
      .mockRejectedValue(new Error("port already in use"));
    setOpencodeServerFactory(createServerMock as typeof createServerMock);

    const ctx = makeCtx({
      options: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        mcpEntries: [
          {
            name: GOAL_MCP_SERVER_NAME,
            transport: "stdio",
            command: process.execPath,
            args: ["/tmp/goalMcpBridge.ts"],
            env: {},
            cwd: null,
            proxied: false,
          },
        ],
        hasGoalRuntime: true,
        pluginCatalogText: "",
      },
    });

    const events = await collectEvents(opencodeProvider.chat(ctx));

    expect(events).toHaveLength(1);
    const errEvent = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(errEvent.type).toBe("error");
    expect(errEvent.code).toBe("opencode_server_unreachable");
  });
});

// ================================================================
// serializeV2ToolSuccessContent helper 單元測試
// ================================================================

describe("serializeV2ToolSuccessContent", () => {
  it("空陣列應回傳空字串", () => {
    expect(serializeV2ToolSuccessContent([])).toBe("");
  });

  it("text 型別應直接取 .text 內容", () => {
    expect(
      serializeV2ToolSuccessContent([{ type: "text", text: "hello world" }]),
    ).toBe("hello world");
  });

  it("多筆 text 型別應以換行串接", () => {
    expect(
      serializeV2ToolSuccessContent([
        { type: "text", text: "line 1" },
        { type: "text", text: "line 2" },
      ]),
    ).toBe("line 1\nline 2");
  });

  it("file 型別應格式化成 [file: <name> (<mime>)]", () => {
    expect(
      serializeV2ToolSuccessContent([
        {
          type: "file",
          uri: "file:///tmp/image.png",
          mime: "image/png",
          name: "image.png",
        },
      ]),
    ).toBe("[file: image.png (image/png)]");
  });

  it("file 型別沒有 name 時應使用 uri", () => {
    expect(
      serializeV2ToolSuccessContent([
        {
          type: "file",
          uri: "file:///tmp/image.png",
          mime: "image/png",
        },
      ]),
    ).toBe("[file: file:///tmp/image.png (image/png)]");
  });
});

// ================================================================
// serializeV2ToolFailureError helper 單元測試
// ================================================================

describe("serializeV2ToolFailureError", () => {
  it("error 為 null 時應回傳 '[Error] tool failed'", () => {
    expect(serializeV2ToolFailureError(null)).toBe("[Error] tool failed");
  });

  it("error 為含 message 的物件時應回傳 '[Error] <message>'", () => {
    expect(serializeV2ToolFailureError({ message: "Permission denied" })).toBe(
      "[Error] Permission denied",
    );
  });

  it("error 為字串時應回傳 '[Error] <string>'", () => {
    expect(serializeV2ToolFailureError("timeout")).toBe("[Error] timeout");
  });

  it("error 為空字串時應 fallback 到 '[Error] tool failed'", () => {
    expect(serializeV2ToolFailureError("")).toBe("[Error] tool failed");
  });
});
