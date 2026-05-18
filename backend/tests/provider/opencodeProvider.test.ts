/**
 * OpencodeProvider 單元測試
 *
 * 對應 User Flow：
 *   - F7: 建立 opencode Pod 並開始對話 → session.create + chat + text event
 *   - F9: 未登入 provider → session.error 走 opencode_auth_missing
 *   - F10: 勾選 MCP server 子集 → tools 子集化
 *   - F11: 刪除正在跑 chat 的 Pod → abortSignal 觸發 session.abort
 *
 * Mock 策略：
 *   - 使用 setOpencodeClientFactory / resetOpencodeClientFactory 注入假 client，
 *     只 mock 自己寫的 OpencodeClientPort interface，不 mock SDK 內部。
 *   - 使用 setOpencodeServerStateFactory / resetOpencodeServerStateFactory 注入假 state。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NormalizedEvent } from "../../src/services/provider/types.js";
import type { OpencodeClientPort } from "../../src/services/provider/opencodeProvider.js";

const { mockManagedMcpSurfaceService } = vi.hoisted(() => ({
  mockManagedMcpSurfaceService: {
    ensureSurface: vi.fn(),
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

/** 從事件陣列建立 SSE AsyncGenerator */
async function* eventsToStream(events: unknown[]): AsyncGenerator<unknown> {
  for (const event of events) {
    yield event;
  }
}

/** 建立基本 mock client */
function makeMockClient(
  overrides?: Partial<OpencodeClientPort>,
): OpencodeClientPort {
  const defaultCreate = vi
    .fn()
    .mockResolvedValue({ data: { id: "mock-session-id" } });
  const defaultPrompt = vi.fn().mockResolvedValue({ data: {} });
  const defaultAbort = vi.fn().mockResolvedValue({ data: true });
  const defaultToolIds = vi.fn().mockResolvedValue({ data: [] });
  const defaultSubscribe = vi
    .fn()
    .mockResolvedValue({ stream: eventsToStream([]) });

  return {
    session: {
      create: defaultCreate,
      prompt: defaultPrompt,
      abort: defaultAbort,
    },
    tool: {
      ids: defaultToolIds,
    },
    event: {
      subscribe: defaultSubscribe,
    },
    ...overrides,
  } as OpencodeClientPort;
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
      mcpServerNames: [],
    },
    ...overrides,
  };
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
    goal:
      overrides.goal === undefined
        ? null
        : overrides.goal,
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
  mockManagedMcpSurfaceService.ensureSurface.mockResolvedValue({
    runId: "run-opencode-goal",
    podId: "opencode-buildopts-pod",
    provider: "opencode",
    sourceNames: ["team-server"],
    targetNames: ["agent_canvas_goal", "team-server"],
    ignoredTargets: [],
    hasGoalRuntime: true,
    statePath: "/tmp/managed-surface/run-opencode-goal/opencode-buildopts-pod.json",
    mcpServer: {
      name: "agent_canvas_managed_surface",
      command: process.execPath,
      args: ["/tmp/managedMcpSurfaceBridge.ts"],
      env: {
        AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH:
          "/tmp/managed-surface/run-opencode-goal/opencode-buildopts-pod.json",
      },
    },
  });
});

afterEach(() => {
  resetOpencodeClientFactory();
  resetOpencodeServerFactory();
  resetOpencodeServerStateFactory();
  removeGoalRuntimeRun("run-opencode-goal");
  vi.restoreAllMocks();
});

describe("buildOptions", () => {
  it("有 runContext 時應改為注入 managed surface", async () => {
    const pod = makeBuildOptionsPod({
      mcpServerNames: ["team-server"],
      goal: {
        todos: [{ id: "todo-1", text: "Finish Goal Runtime handoff" }],
      },
    });

    const options = await opencodeProvider.buildOptions(pod, {
      runId: "run-opencode-goal",
      canvasId: "canvas-opencode-goal",
      sourcePodId: pod.id,
    });

    expect(options.providerID).toBe("anthropic");
    expect(options.modelID).toBe("claude-sonnet-4-5");
    expect(mockManagedMcpSurfaceService.ensureSurface).toHaveBeenCalled();
    expect(options.mcpServerNames).toEqual([
      "agent_canvas_managed_surface",
    ]);
    expect(options.goalMcpServer).toBeNull();
    expect(options.managedSurface?.name).toBe(
      "agent_canvas_managed_surface",
    );
    expect(options.goalPromptEnabled).toBe(true);
  });

  it("有 runContext 且無 Goal 時仍應注入 managed surface", async () => {
    const pod = makeBuildOptionsPod({
      mcpServerNames: ["team-server"],
      goal: null,
    });

    const options = await opencodeProvider.buildOptions(pod, {
      runId: "run-opencode-no-goal",
      canvasId: "canvas-opencode-no-goal",
      sourcePodId: pod.id,
    });

    expect(options.mcpServerNames).toEqual([
      "agent_canvas_managed_surface",
    ]);
    expect(options.goalMcpServer).toBeNull();
    expect(options.managedSurface?.name).toBe(
      "agent_canvas_managed_surface",
    );
    expect(options.goalPromptEnabled).toBe(true);
  });

  it("沒有 runContext 時不應注入 Goal MCP", async () => {
    const pod = makeBuildOptionsPod({
      mcpServerNames: ["team-server"],
      goal: null,
    });

    const options = await opencodeProvider.buildOptions(pod);

    expect(options.mcpServerNames).toEqual(["team-server"]);
    expect(options.goalMcpServer).toBeNull();
  });
});

// ================================================================
// TASK P3.A.t8 測試案例
// ================================================================

// ── (1) resumeSessionId 為 null 時，第一個 yield 為 session_started ──

describe("chat — (1) resumeSessionId=null → session_started 且 sessionId 等於 mocked session.create 回傳", () => {
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
      tool: {
        ids: vi.fn().mockResolvedValue({ data: [] }),
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
});

describe("chat — Goal MCP transient server", () => {
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
        mcpServerNames: ["team-server", GOAL_MCP_SERVER_NAME],
        goalMcpServer: {
          name: GOAL_MCP_SERVER_NAME,
          command: process.execPath,
          args: ["/tmp/goalMcpBridge.ts"],
          env: {
            AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json",
          },
        },
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
      },
    });
  });

  it("有 Goal MCP 時應 bootstrap prompt，先要求模型讀取 Goal Runtime", async () => {
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
      tool: {
        ids: vi.fn().mockResolvedValue({ data: [] }),
      },
    });
    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx({
      message: "go",
      options: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        mcpServerNames: [GOAL_MCP_SERVER_NAME],
        goalMcpServer: {
          name: GOAL_MCP_SERVER_NAME,
          command: process.execPath,
          args: ["/tmp/goalMcpBridge.ts"],
          env: {
            AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-runtime.json",
          },
        },
      },
    });

    await collectEvents(opencodeProvider.chat(ctx));

    const promptArg = promptMock.mock.calls[0]?.[0] as {
      body: { parts: Array<{ type: "text"; text: string }> };
    };
    expect(promptArg.body.parts[0]?.text).toContain("User request: go");
    expect(promptArg.body.parts[0]?.text).toContain(
      "Start by calling Goal Runtime to inspect the current status and active todo.",
    );
    expect(promptArg.body.parts[0]?.text).toContain(
      "Then continue with the current active todo instead of asking for a new task.",
    );
  });
});

describe("chat — managed surface", () => {
  it("Opencode 的 MCP 可見性改由 managed surface 決定", async () => {
    const createServerMock = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:63315",
      close: vi.fn(),
    });
    setOpencodeServerFactory(createServerMock as typeof createServerMock);

    const promptMock = vi.fn().mockResolvedValue({ data: {} });
    const toolIdsMock = vi.fn().mockResolvedValue({
      data: ["mcp__legacy-server__search_docs", "Read"],
    });
    const mockClient = makeMockClient({
      session: {
        create: vi
          .fn()
          .mockResolvedValue({ data: { id: "surface-session-id" } }),
        prompt: promptMock,
        abort: vi.fn().mockResolvedValue({ data: true }),
      },
      tool: {
        ids: toolIdsMock,
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "surface-session-id" },
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
        mcpServerNames: ["agent_canvas_managed_surface"],
        goalMcpServer: null,
        managedSurface: {
          name: "agent_canvas_managed_surface",
          command: process.execPath,
          args: ["/tmp/managedMcpSurfaceBridge.ts"],
          env: {
            AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH:
              "/tmp/managed-surface.json",
          },
        },
        goalPromptEnabled: true,
      },
    });

    await collectEvents(opencodeProvider.chat(ctx));

    expect(createServerMock).toHaveBeenCalledWith({
      port: 0,
      timeout: 30000,
      config: {
        mcp: {
          agent_canvas_managed_surface: {
            type: "local",
            command: [process.execPath, "/tmp/managedMcpSurfaceBridge.ts"],
            environment: {
              AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH:
                "/tmp/managed-surface.json",
            },
            enabled: true,
          },
        },
      },
    });
    expect(toolIdsMock).not.toHaveBeenCalled();
    expect(promptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.not.objectContaining({
          tools: expect.anything(),
        }),
      }),
    );
  });
});

// ── (2) text part 流入時 yield text NormalizedEvent ──

describe("chat — (2) text part 流入時 yield text event", () => {
  it("message.part.updated 且 part.type=text 應 yield text event", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "message.part.updated",
              properties: {
                part: { type: "text", text: "hello from opencode" },
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: "mock-session-id" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx();
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
    expect(
      (textEvent as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("hello from opencode");
  });
});

// ── (3) tool start part 流入時 yield tool_call_start ──

describe("chat — (3) tool start part 流入時 yield tool_call_start", () => {
  it("message.part.updated 且 part.type=tool 且 state.status=running 應 yield tool_call_start", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "call-001",
                  tool: "bash",
                  state: {
                    status: "running",
                    input: { command: "ls" },
                  },
                },
              },
            },
            {
              type: "session.idle",
              properties: { sessionID: "mock-session-id" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx();
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const toolStartEvent = events.find((e) => e.type === "tool_call_start");
    expect(toolStartEvent).toBeDefined();
    const te = toolStartEvent as Extract<
      NormalizedEvent,
      { type: "tool_call_start" }
    >;
    expect(te.toolUseId).toBe("call-001");
    expect(te.toolName).toBe("bash");
    expect(te.input).toEqual({ command: "ls" });
  });
});

// ── (4) session.idle 流入時 yield turn_complete 並結束 ──

describe("chat — (4) session.idle → yield turn_complete 並結束 generator", () => {
  it("session.idle event 應 yield turn_complete", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "mock-session-id" },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx();
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const turnComplete = events.find((e) => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();
  });

  it("session.idle 後 generator 應結束（不產生更多事件）", async () => {
    const mockClient = makeMockClient({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: eventsToStream([
            {
              type: "session.idle",
              properties: { sessionID: "mock-session-id" },
            },
            // 下面這個不應該被處理
            {
              type: "message.part.updated",
              properties: { part: { type: "text", text: "after idle" } },
            },
          ]),
        }),
      },
    });

    setOpencodeClientFactory(() => mockClient);

    const ctx = makeCtx();
    const events = await collectEvents(opencodeProvider.chat(ctx));

    // 不應有 text event（因為 idle 後 break）
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(0);
  });
});

// ── (5) session.error 含 "No auth credentials found" → opencode_auth_missing ──

describe("chat — (5) session.error 訊息含 auth 關鍵字 → opencode_auth_missing", () => {
  it("session.error 含 'No auth credentials found' 應 yield error.code=opencode_auth_missing", async () => {
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
      options: { providerID, modelID: "claude-sonnet-4-5", mcpServerNames: [] },
    });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    const ee = errorEvent as Extract<NormalizedEvent, { type: "error" }>;
    expect(ee.code).toBe("opencode_auth_missing");

    // content 應包含 zh-TW 說明並內插 providerID
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
      options: { providerID: "openai", modelID: "gpt-4o", mcpServerNames: [] },
    });
    const events = await collectEvents(opencodeProvider.chat(ctx));

    const errorEvent = events.find((e) => e.type === "error");
    expect(
      (errorEvent as Extract<NormalizedEvent, { type: "error" }>).code,
    ).toBe("opencode_auth_missing");
  });
});

// ── (6) abortSignal 觸發後 mocked client.session.abort 被呼叫 ──

describe("chat — (6) abortSignal 觸發後 session.abort 被呼叫，path.id 等於 sessionId", () => {
  it("abort 後 session.abort 應以正確 sessionId 被呼叫", async () => {
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
          // stream 永不結束，讓 abortSignal 觸發
          stream: (async function* () {
            // 先讓 abort 觸發
            abortController.abort();
            // yield 一個 idle 讓 generator 正常結束
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
    const callArg = abortMock.mock.calls[0]?.[0] as { path: { id: string } };
    expect(callArg?.path?.id).toBe(mockSessionId);
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
});

// ── 額外：resumeSessionId 不為 null 時，直接沿用而不建立新 session ──

describe("chat — resumeSessionId 不為 null → 沿用舊 session", () => {
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
});

// ── 額外：server baseUrl 為 null 時立刻 yield opencode_server_unreachable ──

describe("chat — server baseUrl 為 null → opencode_server_unreachable", () => {
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
});
