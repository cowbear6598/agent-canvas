import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks（需在 import 之前宣告）────────────────────────────────────────────

vi.mock("../../src/services/mcpServerStore.js", () => ({
  mcpServerStore: {
    getByIds: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../../src/services/pluginScanner.js", () => ({
  scanInstalledPlugins: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/services/integration/index.js", () => ({
  integrationRegistry: {
    get: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock("../../src/services/integration/replyContextStore.js", () => ({
  replyContextStore: {
    get: vi.fn().mockReturnValue(undefined),
  },
  buildReplyContextKey: vi.fn().mockReturnValue("key"),
}));

vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: vi.fn().mockReturnValue("/usr/local/bin/claude"),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    repositoriesRoot: "/repos",
    canvasRoot: "/canvas",
  },
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import {
  buildClaudeOptions,
  BASE_ALLOWED_TOOLS,
} from "../../src/services/provider/claude/buildClaudeOptions.js";
import { mcpServerStore } from "../../src/services/mcpServerStore.js";
import { scanInstalledPlugins } from "../../src/services/pluginScanner.js";
import { integrationRegistry } from "../../src/services/integration/index.js";
import type { Pod } from "../../src/types/pod.js";

// ── 輔助函式 ─────────────────────────────────────────────────────────────────

/**
 * 建立基本測試用 Pod（無 MCP / Plugin / Integration）
 */
function createBasePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-test",
    name: "Test Pod",
    workspacePath: "/canvas/test-pod",
    mcpServerIds: [],
    pluginIds: [],
    repositoryId: null,
    providerConfig: { model: "opus" },
    integrationBindings: [],
    ...overrides,
  } as Pod;
}

// ── 測試 ────────────────────────────────────────────────────────────────────

describe("buildClaudeOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 預設 mock 狀態：無 MCP Server、無 Plugin、無 Integration
    vi.mocked(mcpServerStore.getByIds).mockReturnValue([]);
    vi.mocked(scanInstalledPlugins).mockReturnValue([]);
    vi.mocked(integrationRegistry.get).mockReturnValue(undefined);
  });

  describe("無 MCP / Plugin / Integration 時產出最精簡 options", () => {
    it("不應包含 mcpServers key（空物件不注入）", async () => {
      const pod = createBasePod();

      const result = await buildClaudeOptions(pod);

      expect(result).not.toHaveProperty("mcpServers");
    });

    it("不應包含 plugins key（無 plugin 時不注入）", async () => {
      const pod = createBasePod();

      const result = await buildClaudeOptions(pod);

      expect(result).not.toHaveProperty("plugins");
    });

    it("allowedTools 應與 BASE_ALLOWED_TOOLS 相同", async () => {
      const pod = createBasePod();

      const result = await buildClaudeOptions(pod);

      expect(result.allowedTools).toEqual([...BASE_ALLOWED_TOOLS]);
    });

    it("固定欄位（settingSources / permissionMode / includePartialMessages）應正確設定", async () => {
      const pod = createBasePod();

      const result = await buildClaudeOptions(pod);

      expect(result.settingSources).toEqual(["project"]);
      expect(result.permissionMode).toBe("bypassPermissions");
      expect(result.includePartialMessages).toBe(true);
    });

    it("model 應來自 pod.providerConfig.model", async () => {
      const pod = createBasePod({ providerConfig: { model: "sonnet" } });

      const result = await buildClaudeOptions(pod);

      expect(result.model).toBe("sonnet");
    });

    it("providerConfig.model 不存在時應 fallback 為 'opus'", async () => {
      const pod = createBasePod({ providerConfig: null });

      const result = await buildClaudeOptions(pod);

      expect(result.model).toBe("opus");
    });
  });

  describe("同時帶 MCP Server 與 Integration binding 時 mcpServers 應正確合併", () => {
    it("mcpServers 同時含 MCP Server 設定與 Integration reply tool，互不覆蓋", async () => {
      // 準備 MCP Server
      vi.mocked(mcpServerStore.getByIds).mockReturnValue([
        {
          id: "mcp-1",
          name: "my-mcp",
          config: { command: "node", args: ["server.js"] },
        } as any,
      ]);

      // 準備 Integration provider（帶 sendMessage）
      vi.mocked(integrationRegistry.get).mockReturnValue({
        displayName: "Slack",
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const pod = createBasePod({
        mcpServerIds: ["mcp-1"],
        integrationBindings: [
          {
            provider: "slack",
            appId: "app-1",
            resourceId: "channel-1",
          },
        ],
      });

      const result = await buildClaudeOptions(pod);

      // 應同時含 MCP Server 與 Integration reply tool
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers).toHaveProperty("my-mcp");
      expect(result.mcpServers).toHaveProperty("slack-reply");
    });

    it("Integration allowedTools 應追加到基本工具清單之後", async () => {
      vi.mocked(integrationRegistry.get).mockReturnValue({
        displayName: "Slack",
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const pod = createBasePod({
        integrationBindings: [
          {
            provider: "slack",
            appId: "app-1",
            resourceId: "channel-1",
          },
        ],
      });

      const result = await buildClaudeOptions(pod);

      expect(result.allowedTools).toContain("mcp__slack-reply__slack_reply");
      // BASE_ALLOWED_TOOLS 也應保留
      expect(result.allowedTools).toContain("Read");
    });
  });
});

describe("applyIntegrationToolOptions：provider 不存在時跳過（不 crash）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mcpServerStore.getByIds).mockReturnValue([]);
    vi.mocked(scanInstalledPlugins).mockReturnValue([]);
    // 模擬 integrationRegistry.get 回傳 undefined（provider 不存在）
    vi.mocked(integrationRegistry.get).mockReturnValue(undefined);
  });

  it("provider 不存在時 buildClaudeOptions 應正常完成，不含 integration mcpServer", async () => {
    const pod = createBasePod({
      integrationBindings: [
        {
          provider: "non-existent-provider",
          appId: "app-1",
          resourceId: "resource-1",
        },
      ],
    });

    // 不應拋出錯誤
    await expect(buildClaudeOptions(pod)).resolves.toBeDefined();

    const result = await buildClaudeOptions(pod);

    // 沒有合法的 integration，不應產出 mcpServers
    expect(result).not.toHaveProperty("mcpServers");
    // allowedTools 應維持基本清單
    expect(result.allowedTools).toEqual([...BASE_ALLOWED_TOOLS]);
  });

  it("provider 存在但無 sendMessage 時應跳過（視同不存在）", async () => {
    // 有 displayName 但無 sendMessage 的 provider
    vi.mocked(integrationRegistry.get).mockReturnValue({
      displayName: "TestProvider",
      // 故意不提供 sendMessage
    } as any);

    const pod = createBasePod({
      integrationBindings: [
        {
          provider: "test-provider",
          appId: "app-1",
          resourceId: "resource-1",
        },
      ],
    });

    const result = await buildClaudeOptions(pod);

    // 無 sendMessage，不應注入 mcpServer
    expect(result).not.toHaveProperty("mcpServers");
  });
});
