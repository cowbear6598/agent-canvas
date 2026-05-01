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
vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "@anthropic-ai/claude-agent-sdk",
  )) as any;
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
    commandId: null,
    multiInstance: false,
    sessionId: null,
    x: 0,
    y: 0,
    rotation: 0,
    ...overrides,
  } as Pod;
}

// ── 測試套件 ──────────────────────────────────────────────────────────────────

describe("claudeProvider.buildOptions()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 預設 mock 回傳值
    vi.mocked(readClaudeMcpServers).mockReturnValue([]);
    vi.mocked(scanInstalledPlugins).mockReturnValue([]);
    vi.mocked(integrationRegistry.get).mockReturnValue(undefined);
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
