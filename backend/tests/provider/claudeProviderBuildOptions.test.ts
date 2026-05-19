/**
 * claudeProvider.buildOptions() 單元測試
 *
 * 驗證 buildClaudeOptions 從 Pod 設定正確建構 ClaudeOptions：
 * - 空 Pod（無特殊設定）→ 等於 metadata.defaultOptions + pod model
 * - pod.mcpServerNames → mcpServers 被填入（mock readClaudeMcpServers，以名稱 allowlist 過濾）
 * - pod.pluginIds → plugins 被填入（mock scanInstalledPlugins）
 * - pod.integrationBindings → mcpServers 加 reply server、allowedTools 含 mcp__ 前綴（mock integrationRegistry）
 * - pod.providerConfig.model 覆寫 default
 * - 多能力組合同時存在
 *
 * 測試對象：claudeProvider.buildOptions(pod, runContext?) → Promise<ClaudeOptions>
 */

// ── 所有 mock 必須在 import 前設定 ────────────────────────────────────────────

vi.mock("../../src/services/mcp/claudeMcpReader.js", () => ({
  readClaudeMcpServers: vi.fn(),
}));

vi.mock("../../src/services/pluginScanner.js", () => ({
  scanInstalledPlugins: vi.fn(),
}));

vi.mock("../../src/services/integration/index.js", () => ({
  integrationRegistry: {
    get: vi.fn(),
  },
}));

vi.mock("../../src/services/integration/replyContextStore.js", () => ({
  replyContextStore: {
    get: vi.fn(),
  },
  buildReplyContextKey: vi.fn((runContext: any, podId: string) =>
    runContext ? `${runContext.runId}:${podId}` : podId,
  ),
}));

vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: vi.fn(() => "/usr/local/bin/claude"),
}));

const { mockManagedMcpSurfaceService } = vi.hoisted(() => ({
  mockManagedMcpSurfaceService: {
    ensureSurface: vi.fn(),
    ensureChatSurface: vi.fn().mockResolvedValue(null),
    cleanupChatSurface: vi.fn().mockResolvedValue(undefined),
    buildPodMcpEntries: vi.fn().mockResolvedValue({
      entries: [],
      ignoredTargets: [],
      hasGoalRuntime: false,
    }),
  },
}));

vi.mock("../../src/services/mcp/managedMcpSurfaceService.js", () => ({
  AGENT_CANVAS_MANAGED_SURFACE_NAME: "agent_canvas_managed_surface",
  managedMcpSurfaceService: mockManagedMcpSurfaceService,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/utils/pathValidator.js", () => ({
  isPathWithinDirectory: vi.fn(() => true),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    canvasRoot: "/workspace",
    repositoriesRoot: "/repos",
  },
}));

// SDK mock：createSdkMcpServer 回傳 stub 物件供測試驗證
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    createSdkMcpServer: vi.fn((options: { name: string; tools?: any[] }) => ({
      __isMockMcpServer: true,
      name: options.name,
      tools: options.tools ?? [],
    })),
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: any) => ({
      __isMockTool: true,
      name,
      handler,
    })),
  };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { claudeProvider } from "../../src/services/provider/claudeProvider.js";
import { readClaudeMcpServers } from "../../src/services/mcp/claudeMcpReader.js";
import { scanInstalledPlugins } from "../../src/services/pluginScanner.js";
import { integrationRegistry } from "../../src/services/integration/index.js";
import { BASE_ALLOWED_TOOLS } from "../../src/services/provider/claude/buildClaudeOptions.js";
import type { Pod } from "../../src/types/pod.js";
import type { RunContext } from "../../src/types/run.js";

// ── 工具：建立最小化 Pod stub ────────────────────────────────────────────────

function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-build-001",
    name: "Test Claude Pod",
    provider: "claude",
    status: "idle",
    providerConfig: {},
    workspacePath: "/workspace/test",
    skillIds: [],
    mcpServerNames: [],
    pluginIds: [],
    integrationBindings: [],

    repositoryId: null,
    multiInstance: false,
    sessionId: null,
    x: 0,
    y: 0,
    rotation: 0,
    ...overrides,
  } as Pod;
}

function makeRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-goal-001",
    canvasId: "canvas-goal-001",
    sourcePodId: "source-pod-001",
    ...overrides,
  };
}

// ── 測試套件 ──────────────────────────────────────────────────────────────────

describe("claudeProvider.buildOptions()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 預設 mock 回傳值
    vi.mocked(readClaudeMcpServers).mockReturnValue([]);
    vi.mocked(scanInstalledPlugins).mockReturnValue([]);
    vi.mocked(integrationRegistry.get).mockReturnValue(undefined);
    // buildPodMcpEntries 預設回空 → applyMcpServers 會 fallback 至 readClaudeMcpServers。
    // 個別 test 若需注入特定 entries 須自行 mockResolvedValueOnce 覆寫。
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [],
      ignoredTargets: [],
      hasGoalRuntime: false,
    });
    mockManagedMcpSurfaceService.ensureSurface.mockResolvedValue({
      runId: "run-goal-001",
      podId: "pod-build-001",
      provider: "claude",
      sourceNames: ["my-mcp-server"],
      targetNames: ["agent_canvas_goal", "my-mcp-server"],
      ignoredTargets: [],
      hasGoalRuntime: true,
      statePath: "/tmp/managed-surface/run-goal-001/pod-build-001.json",
      mcpServer: {
        name: "agent_canvas_managed_surface",
        command: process.execPath,
        args: ["/tmp/managedMcpSurfaceBridge.ts"],
        env: {
          AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH:
            "/tmp/managed-surface/run-goal-001/pod-build-001.json",
        },
      },
    });
  });

  // ── Case 1：空 Pod → 等於 defaultOptions + pod model ─────────────────
  it("空 Pod（無特殊設定）應回傳 metadata.defaultOptions 的基礎欄位", async () => {
    const pod = makePod();
    const options = await claudeProvider.buildOptions(pod);

    // 基礎欄位必須存在
    expect(options.settingSources).toEqual(["project"]);
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.includePartialMessages).toBe(true);

    // model 應為 default "sonnet"（空 providerConfig）
    expect(options.model).toBe("sonnet");

    // allowedTools 應包含 BASE_ALLOWED_TOOLS
    for (const tool of BASE_ALLOWED_TOOLS) {
      expect(options.allowedTools).toContain(tool);
    }

    // 未設定的能力欄位不應存在或為空
    expect(options.mcpServers).toBeUndefined();
    expect(options.plugins).toBeUndefined();
  });

  // ── Case 2：pod.providerConfig.model 覆寫 default ────────────────────
  it("pod.providerConfig.model 應覆寫 default model", async () => {
    const pod = makePod({ providerConfig: { model: "sonnet" } });
    const options = await claudeProvider.buildOptions(pod);

    expect(options.model).toBe("sonnet");
  });

  // ── Case 3：pod.mcpServerNames → mcpServers 被填入 ─────────────────────
  it("pod.mcpServerNames 設定時應呼叫 readClaudeMcpServers，並以名稱過濾填入 mcpServers", async () => {
    const mockServers = [
      {
        name: "my-mcp-server",
        command: "npx",
        args: ["-y", "@my-mcp/server"],
        env: {},
      },
    ];
    vi.mocked(readClaudeMcpServers).mockReturnValue(mockServers);

    const pod = makePod({ mcpServerNames: ["my-mcp-server"] });
    const options = await claudeProvider.buildOptions(pod);

    expect(readClaudeMcpServers).toHaveBeenCalled();
    expect(options.mcpServers).toBeDefined();
    expect(options.mcpServers?.["my-mcp-server"]).toEqual({
      command: "npx",
      args: ["-y", "@my-mcp/server"],
      env: {},
    });
  });

  it("mcpServerNames 為空陣列時，mcpServers 應為 undefined", async () => {
    vi.mocked(readClaudeMcpServers).mockReturnValue([]);

    const pod = makePod({ mcpServerNames: [] });
    const options = await claudeProvider.buildOptions(pod);

    expect(options.mcpServers).toBeUndefined();
  });

  it("Run 模式注入 buildPodMcpEntries 回傳的 N+1 個獨立 MCP entry", async () => {
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
          name: "server-everything",
          transport: "stdio",
          command: "npx",
          args: ["@modelcontextprotocol/server-everything"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: true,
    });

    const pod = makePod({
      mcpServerNames: ["server-everything"],
      goal: {
        todos: [{ id: "todo-1", text: "Inspect current task state" }],
      },
    });
    const runContext = makeRunContext();
    const options = await claudeProvider.buildOptions(pod, runContext);

    expect(
      mockManagedMcpSurfaceService.buildPodMcpEntries,
    ).toHaveBeenCalledWith(pod, runContext);
    expect(readClaudeMcpServers).not.toHaveBeenCalled();
    // agent 視角：N+1 個獨立 MCP，不再聚合成一顆 surface
    expect(options.mcpServers?.agent_canvas_goal).toMatchObject({
      command: "/usr/local/bin/bun",
      args: ["/tmp/goalMcpBridge.ts"],
    });
    expect(options.mcpServers?.["server-everything"]).toMatchObject({
      command: "npx",
      args: ["@modelcontextprotocol/server-everything"],
    });
    expect(options.mcpServers?.agent_canvas_managed_surface).toBeUndefined();
  });

  it("Run 模式 buildPodMcpEntries 回空且 pod.mcpServerNames 也空時 mcpServers 為 undefined", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [],
      ignoredTargets: [],
      hasGoalRuntime: false,
    });

    const pod = makePod({ goal: null, mcpServerNames: [] });
    const options = await claudeProvider.buildOptions(pod, makeRunContext());

    expect(options.mcpServers).toBeUndefined();
  });

  it("Chat 模式有勾選 managed MCP 時注入個別 entry（無 Goal Runtime）", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "managed-server",
          transport: "stdio",
          command: "node",
          args: ["managed-server.js"],
          env: { FOO: "bar" },
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
    });

    const pod = makePod({ mcpServerNames: ["managed-server"] });
    const options = await claudeProvider.buildOptions(pod);

    expect(
      mockManagedMcpSurfaceService.buildPodMcpEntries,
    ).toHaveBeenCalledWith(pod, null);
    expect(options.mcpServers?.["managed-server"]).toEqual({
      command: "node",
      args: ["managed-server.js"],
      env: { FOO: "bar" },
    });
    // entries 有值時不再 fallback 到 ~/.claude.json
    expect(readClaudeMcpServers).not.toHaveBeenCalled();
    expect(options.mcpServers?.agent_canvas_managed_surface).toBeUndefined();
  });

  it("Claude pod 勾 http target 時 buildPodMcpEntries 應已包成 proxy bridge stdio entry", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "remote-mcp",
          transport: "stdio",
          command: process.execPath,
          args: ["/tmp/managedMcpProxyBridge.ts"],
          env: {
            AGENT_CANVAS_MCP_PROXY_NAME: "remote-mcp",
            AGENT_CANVAS_MCP_PROXY_TRANSPORT: "http",
            AGENT_CANVAS_MCP_PROXY_URL: "https://example.com/mcp",
          },
          cwd: null,
          proxied: true,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
    });

    const pod = makePod({ mcpServerNames: ["remote-mcp"] });
    const options = await claudeProvider.buildOptions(pod);

    expect(options.mcpServers?.["remote-mcp"]).toMatchObject({
      command: process.execPath,
      env: {
        AGENT_CANVAS_MCP_PROXY_NAME: "remote-mcp",
        AGENT_CANVAS_MCP_PROXY_TRANSPORT: "http",
        AGENT_CANVAS_MCP_PROXY_URL: "https://example.com/mcp",
      },
    });
  });

  it("Chat 模式 ensureChatSurface 回傳 null（pod 未勾選 managed MCP）時退回 ~/.claude.json fallback", async () => {
    mockManagedMcpSurfaceService.ensureChatSurface.mockResolvedValue(null);
    vi.mocked(readClaudeMcpServers).mockReturnValue([
      { name: "legacy", command: "node", args: ["legacy.js"], env: {} },
    ]);

    const pod = makePod({ mcpServerNames: ["legacy"] });
    const options = await claudeProvider.buildOptions(pod);

    expect(readClaudeMcpServers).toHaveBeenCalled();
    expect(options.mcpServers?.legacy).toEqual({
      command: "node",
      args: ["legacy.js"],
      env: {},
    });
    expect(options.mcpServers?.agent_canvas_managed_surface).toBeUndefined();
  });

  // ── Case 5：pod.pluginIds → plugins 被填入 ────────────────────────────
  it("pod.pluginIds 設定時應呼叫 scanInstalledPlugins，並填入 plugins", async () => {
    const mockPlugins = [
      {
        id: "plugin-001",
        name: "Test Plugin",
        version: "1.0.0",
        description: "A test plugin",
        installPath: "/home/user/.claude/plugins/test-plugin",
        repo: "https://github.com/test/plugin",
      },
    ];
    vi.mocked(scanInstalledPlugins).mockReturnValue(mockPlugins);

    const pod = makePod({ pluginIds: ["plugin-001"] });
    const options = await claudeProvider.buildOptions(pod);

    expect(scanInstalledPlugins).toHaveBeenCalled();
    expect(options.plugins).toBeDefined();
    expect(options.plugins).toHaveLength(1);
    expect(options.plugins![0]).toEqual({
      type: "local",
      path: "/home/user/.claude/plugins/test-plugin",
    });
  });

  it("pluginIds 中的 id 不在已安裝清單中時，plugins 應為 undefined 或空", async () => {
    // 已安裝 plugin-999，但 Pod 要用 plugin-001（不存在）
    const mockPlugins = [
      {
        id: "plugin-999",
        name: "Another Plugin",
        version: "1.0.0",
        description: "Another plugin",
        installPath: "/path/to/another",
        repo: "https://github.com/another",
      },
    ];
    vi.mocked(scanInstalledPlugins).mockReturnValue(mockPlugins);

    const pod = makePod({ pluginIds: ["plugin-001"] });
    const options = await claudeProvider.buildOptions(pod);

    // 過濾後 plugin 不在 enabledSet → plugins 為空或 undefined
    const hasPlugins =
      options.plugins !== undefined && options.plugins.length > 0;
    expect(hasPlugins).toBe(false);
  });

  // ── Case 6：pod.integrationBindings → mcpServers + allowedTools ───────
  it("pod.integrationBindings 設定時應建立 reply server，allowedTools 含 mcp__ 前綴", async () => {
    const mockIntegrationProvider = {
      name: "slack",
      displayName: "Slack",
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      // 其他必要欄位...
      createAppSchema: {} as any,
      validateCreate: vi.fn(),
      sanitizeConfig: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
      destroyAll: vi.fn(),
      refreshResources: vi.fn(),
      formatEventMessage: vi.fn(),
    };
    vi.mocked(integrationRegistry.get).mockReturnValue(
      mockIntegrationProvider as any,
    );

    const pod = makePod({
      integrationBindings: [
        {
          provider: "slack",
          appId: "app-001",
          resourceId: "channel-001",
        },
      ],
    });

    const options = await claudeProvider.buildOptions(pod);

    // mcpServers 應含有 reply server
    expect(options.mcpServers).toBeDefined();
    expect(Object.keys(options.mcpServers!)).toContain("slack-reply");

    // allowedTools 應含有 mcp__slack-reply__slack_reply
    expect(options.allowedTools).toContain("mcp__slack-reply__slack_reply");
  });

  it("integrationRegistry.get 回傳 undefined 時不應建立 reply server", async () => {
    vi.mocked(integrationRegistry.get).mockReturnValue(undefined);

    const pod = makePod({
      integrationBindings: [
        {
          provider: "unknown-integration",
          appId: "app-001",
          resourceId: "resource-001",
        },
      ],
    });

    const options = await claudeProvider.buildOptions(pod);

    // 無效的 provider → 不應加入 mcpServers 或 allowedTools 中的 mcp__ 項目
    const mcpAllowedTools = options.allowedTools.filter((t) =>
      t.startsWith("mcp__"),
    );
    expect(mcpAllowedTools).toHaveLength(0);
  });

  it("integration provider 無 sendMessage 方法時不應建立 reply server", async () => {
    const mockProviderWithoutSendMessage = {
      name: "readonly-integration",
      displayName: "Read-Only Integration",
      // sendMessage 未定義
      createAppSchema: {} as any,
      validateCreate: vi.fn(),
      sanitizeConfig: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
      destroyAll: vi.fn(),
      refreshResources: vi.fn(),
      formatEventMessage: vi.fn(),
    };
    vi.mocked(integrationRegistry.get).mockReturnValue(
      mockProviderWithoutSendMessage as any,
    );

    const pod = makePod({
      integrationBindings: [
        {
          provider: "readonly-integration",
          appId: "app-001",
          resourceId: "resource-001",
        },
      ],
    });

    const options = await claudeProvider.buildOptions(pod);

    const mcpAllowedTools = options.allowedTools.filter((t) =>
      t.startsWith("mcp__"),
    );
    expect(mcpAllowedTools).toHaveLength(0);
  });

  // ── Case 7：多能力組合同時存在 ───────────────────────────────────────
  it("MCP + Plugin + Integration 同時設定時，產物各欄位均正確", async () => {
    // mock MCP Server（readClaudeMcpServers 回傳所有本機 server）
    vi.mocked(readClaudeMcpServers).mockReturnValue([
      {
        name: "combo-server",
        command: "node",
        args: ["server.js"],
        env: {},
      },
    ]);

    // mock Plugin
    vi.mocked(scanInstalledPlugins).mockReturnValue([
      {
        id: "plugin-combo",
        name: "Combo Plugin",
        version: "2.0.0",
        description: "A combo plugin",
        installPath: "/path/to/combo-plugin",
        repo: "https://github.com/combo",
      },
    ]);

    // mock Integration
    const mockIntegration = {
      name: "slack",
      displayName: "Slack",
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      createAppSchema: {} as any,
      validateCreate: vi.fn(),
      sanitizeConfig: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
      destroyAll: vi.fn(),
      refreshResources: vi.fn(),
      formatEventMessage: vi.fn(),
    };
    vi.mocked(integrationRegistry.get).mockReturnValue(mockIntegration as any);

    const pod = makePod({
      providerConfig: { model: "sonnet" },
      mcpServerNames: ["combo-server"],
      pluginIds: ["plugin-combo"],
      integrationBindings: [
        {
          provider: "slack",
          appId: "app-combo",
          resourceId: "channel-combo",
        },
      ],
    });

    const options = await claudeProvider.buildOptions(pod);

    // model 覆寫
    expect(options.model).toBe("sonnet");

    // MCP Server
    expect(options.mcpServers?.["combo-server"]).toBeDefined();

    // Integration reply server（與 MCP Server 合併）
    expect(options.mcpServers?.["slack-reply"]).toBeDefined();

    // Plugin
    expect(options.plugins).toHaveLength(1);
    expect(options.plugins![0].path).toBe("/path/to/combo-plugin");

    // allowedTools 含 BASE_ALLOWED_TOOLS
    for (const tool of BASE_ALLOWED_TOOLS) {
      expect(options.allowedTools).toContain(tool);
    }

    // allowedTools 含 Integration 的 mcp__ 項目
    expect(options.allowedTools).toContain("mcp__slack-reply__slack_reply");

    // 基礎欄位不變
    expect(options.settingSources).toEqual(["project"]);
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.includePartialMessages).toBe(true);
  });
});
