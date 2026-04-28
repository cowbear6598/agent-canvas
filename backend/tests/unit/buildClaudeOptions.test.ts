import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createTmpDir,
  cleanupTmpDir,
  overrideEnv,
} from "../helpers/tmpDirHelper.js";

// ─────────────────────────────────────────────────────────────────────────────
// C2 重寫說明：
//
// - claudeMcpReader：移除 vi.mock，改用 CLAUDE_JSON_PATH env 覆寫 + tmp dir 真讀
//   （readClaudeMcpServers 用 lazy 函式讀取路徑，每次呼叫都讀 process.env.CLAUDE_JSON_PATH）
//
// - pluginScanner：移除 vi.mock，改用 CLAUDE_PLUGINS_INSTALLED_PATH env 指向不存在路徑
//   （pluginScanner 無法透過 reimport 更新，因為 buildClaudeOptions 是靜態 import；
//    指向不存在路徑讓 readFileSync 靜默失敗 → 回傳空陣列，符合大部分測試預設情境）
//
// - integrationRegistry：保留 vi.mock（integration/index.js 的依賴鏈含 bun:sqlite，
//   vitest 環境無法 import），但改為提供可控的 get mock fn
//
// - replyContextStore：保留 vi.mock（同上依賴鏈原因）
//
// - claudePathResolver / logger：移除 mock，真實呼叫
//
// - Claude Agent SDK（@anthropic-ai/claude-agent-sdk）：保留 mock（外部 SDK 邊界）
//
// ─────────────────────────────────────────────────────────────────────────────

// 取得真實 homedir（用於 claudeMcpReader 的 JSON key）
const REAL_HOMEDIR = homedir();

// ── 保留 Claude Agent SDK mock（外部 SDK 邊界）──────────────────────────────
// SDK 的 tool / createSdkMcpServer 在測試環境不應實際建立 MCP 連線
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: vi.fn(
    (name: string, _desc: string, _schema: unknown, handler: unknown) => ({
      __toolName: name,
      __handler: handler,
    }),
  ),
  createSdkMcpServer: vi.fn((cfg: { name: string; tools: unknown[] }) => ({
    __serverName: cfg.name,
    __tools: cfg.tools,
  })),
  Options: {},
}));

// ── mock integrationRegistry（避免 bun:sqlite 依賴鏈在 vitest 中崩潰）────
// integration/index.js → integrationAppStore.ts → database/index.ts → bun:sqlite
// 因此需要整個模組 mock；vi.mock factory 被 hoisted，不能引用外部 let 變數，
// 改在 factory 內直接建立 vi.fn()，之後透過 vi.mocked 在 beforeEach 控制行為
vi.mock("../../src/services/integration/index.js", () => ({
  integrationRegistry: {
    get: vi.fn(),
  },
}));

// ── mock replyContextStore（同依賴鏈原因）────────────────────────────────
vi.mock("../../src/services/integration/replyContextStore.js", () => ({
  replyContextStore: {
    get: vi.fn().mockReturnValue(undefined),
  },
  buildReplyContextKey: vi.fn().mockReturnValue("key"),
}));

// ── mock claudePathResolver（Bun.which 在 vitest 中不可用）──────────────
vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: vi.fn().mockReturnValue("/usr/local/bin/claude"),
}));

// ── Imports（在所有 mock 設置後）──────────────────────────────────────────
import {
  buildClaudeOptions,
  BASE_ALLOWED_TOOLS,
} from "../../src/services/provider/claude/buildClaudeOptions.js";
import { integrationRegistry } from "../../src/services/integration/index.js";
import { resetClaudeMcpCache } from "../../src/services/mcp/claudeMcpReader.js";
import type { Pod } from "../../src/types/pod.js";

// ─────────────────────────────────────────────────────────────────────────────
// 輔助函式
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 建立基本測試用 Pod（無 MCP / Plugin / Integration）
 */
function createBasePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-test",
    name: "Test Pod",
    workspacePath: "/canvas/test-pod",
    mcpServerNames: [],
    pluginIds: [],
    repositoryId: null,
    providerConfig: { model: "opus" },
    integrationBindings: [],
    ...overrides,
  } as Pod;
}

/** 建立包含 projects[homedir].mcpServers 的 claude.json 內容 */
function makeClaudeJson(mcpServers: Record<string, unknown>): string {
  return JSON.stringify({
    projects: {
      [REAL_HOMEDIR]: { mcpServers },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 生命週期：tmp dir 管理 + env 覆寫 + spy 清理
// ─────────────────────────────────────────────────────────────────────────────

let tmpHome: string;
let claudeJsonPath: string;
let restoreEnv: () => void;

beforeEach(async () => {
  // 建立 tmp dir，用於放置 claude.json 測試檔案
  tmpHome = await createTmpDir("ccc-build-opts-test-");
  claudeJsonPath = join(tmpHome, ".claude.json");

  // 覆寫 CLAUDE_JSON_PATH：讓 claudeMcpReader 讀測試用 json（lazy 函式，每次都讀 env）
  // 覆寫 CLAUDE_PLUGINS_INSTALLED_PATH 為不存在路徑：確保 pluginScanner 回傳空陣列
  // （pluginScanner 的路徑常數在 module load 時已固定；指向不存在路徑讓讀檔靜默失敗）
  restoreEnv = overrideEnv({
    CLAUDE_JSON_PATH: claudeJsonPath,
    CLAUDE_PLUGINS_INSTALLED_PATH: join(tmpHome, "nonexistent-plugins.json"),
  });

  // 清除 claudeMcpReader 快取，確保每個測試都從乾淨狀態讀取
  resetClaudeMcpCache();

  // 重設所有 mock（包含 integrationRegistry.get）
  vi.clearAllMocks();

  // 預設：無 integration provider
  vi.mocked(integrationRegistry.get).mockReturnValue(undefined);
});

afterEach(async () => {
  restoreEnv();

  // 清除 claudeMcpReader 快取，避免污染後續測試
  resetClaudeMcpCache();

  // 清理 tmp dir
  await cleanupTmpDir(tmpHome);
});

// ─────────────────────────────────────────────────────────────────────────────
// 測試
// ─────────────────────────────────────────────────────────────────────────────

describe("buildClaudeOptions", () => {
  describe("無 MCP / Plugin / Integration 時產出最精簡 options", () => {
    it("不應包含 mcpServers key（空物件不注入）", async () => {
      // claude.json 不存在 → claudeMcpReader 真實讀取 → 回傳 []
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

  describe("MCP Server 過濾行為（claudeMcpReader 真讀 tmp claude.json）", () => {
    it("pod.mcpServerNames 為空時不應產出 mcpServers", async () => {
      // 寫入 claude.json（有 server），但 pod 沒有啟用任何 server
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "available-server": { command: "node", args: [], env: {} },
        }),
      );

      const pod = createBasePod({ mcpServerNames: [] });
      const result = await buildClaudeOptions(pod);

      expect(result).not.toHaveProperty("mcpServers");
    });

    it("pod.mcpServerNames 有指定 name 但 claude.json 無對應 server 時不產出 mcpServers", async () => {
      // claude.json 不存在 → claudeMcpReader 回傳 []
      const pod = createBasePod({ mcpServerNames: ["nonexistent-server"] });
      const result = await buildClaudeOptions(pod);

      expect(result).not.toHaveProperty("mcpServers");
    });

    it("pod.mcpServerNames 與 claude.json 交集後只注入允許的 server", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "server-allowed": { command: "node", args: ["a.js"], env: {} },
          "server-not-in-pod": { command: "python3", args: [], env: {} },
        }),
      );

      // pod 只啟用 server-allowed
      const pod = createBasePod({ mcpServerNames: ["server-allowed"] });
      const result = await buildClaudeOptions(pod);

      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers).toHaveProperty("server-allowed");
      expect(result.mcpServers).not.toHaveProperty("server-not-in-pod");
    });

    it("mcpServers 注入的 command 與 args 應與 claude.json 一致", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "my-server": {
            command: "npx",
            args: ["-y", "@scope/mcp-server"],
            env: { TOKEN: "secret" },
          },
        }),
      );

      const pod = createBasePod({ mcpServerNames: ["my-server"] });
      const result = await buildClaudeOptions(pod);

      expect(result.mcpServers?.["my-server"]).toMatchObject({
        command: "npx",
        args: ["-y", "@scope/mcp-server"],
        env: { TOKEN: "secret" },
      });
    });

    it("mcpServerNames 部分存在、部分不存在：只注入 claude.json 有的 server（self-healing 過濾）", async () => {
      // claude.json 只有 a 和 c，沒有 b
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          a: { command: "node", args: ["a.js"], env: {} },
          c: { command: "python3", args: ["c.py"], env: { FOO: "bar" } },
        }),
      );

      // pod 要求 a、b、c，但 claude.json 只有 a 和 c
      const pod = createBasePod({ mcpServerNames: ["a", "b", "c"] });
      const result = await buildClaudeOptions(pod);

      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers).toHaveProperty("a");
      expect(result.mcpServers).toHaveProperty("c");
      expect(result.mcpServers).not.toHaveProperty("b");

      expect(result.mcpServers?.["a"]).toMatchObject({
        command: "node",
        args: ["a.js"],
      });
      expect(result.mcpServers?.["c"]).toMatchObject({
        command: "python3",
        args: ["c.py"],
        env: { FOO: "bar" },
      });
    });
  });

  describe("同時帶 MCP Server 與 Integration binding 時 mcpServers 應正確合併", () => {
    it("mcpServers 同時含 MCP Server 設定與 Integration reply tool，互不覆蓋", async () => {
      // 準備 claude.json 含 my-mcp server
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "my-mcp": { command: "node", args: ["server.js"], env: {} },
        }),
      );

      // 準備 Integration provider（帶 sendMessage）
      vi.mocked(integrationRegistry.get).mockReturnValue({
        displayName: "Slack",
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      const pod = createBasePod({
        mcpServerNames: ["my-mcp"],
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

describe("applyIntegrationToolOptions：integrationBinding provider 名稱含非法字元時跳過", () => {
  beforeEach(() => {
    // 確保 registry 可以找到 provider（但 provider 名稱本身非法才是測試重點）
    vi.mocked(integrationRegistry.get).mockReturnValue({
      displayName: "Test",
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    } as any);
  });

  it("provider 名稱含空格（'open ai'）時，該 binding 應被略過、不出現在 mcpServers", async () => {
    const pod = createBasePod({
      integrationBindings: [
        {
          provider: "open ai",
          appId: "app-1",
          resourceId: "resource-1",
        },
      ],
    });

    const result = await buildClaudeOptions(pod);

    // 非法 provider 名稱被略過，不應產出 mcpServers
    expect(result).not.toHaveProperty("mcpServers");
    expect(result.allowedTools).toEqual([...BASE_ALLOWED_TOOLS]);
  });

  it("provider 名稱含分號（'foo;bar'）時，該 binding 應被略過、不出現在 mcpServers", async () => {
    const pod = createBasePod({
      integrationBindings: [
        {
          provider: "foo;bar",
          appId: "app-1",
          resourceId: "resource-1",
        },
      ],
    });

    const result = await buildClaudeOptions(pod);

    // 非法 provider 名稱被略過，不應產出 mcpServers
    expect(result).not.toHaveProperty("mcpServers");
    expect(result.allowedTools).toEqual([...BASE_ALLOWED_TOOLS]);
  });

  it("合法與非法 provider 混合時，只有合法 provider 的 binding 出現在 mcpServers", async () => {
    vi.mocked(integrationRegistry.get).mockImplementation((name: string) => {
      if (name === "slack") {
        return {
          displayName: "Slack",
          sendMessage: vi.fn().mockResolvedValue({ success: true }),
        } as any;
      }
      return undefined;
    });

    const pod = createBasePod({
      integrationBindings: [
        {
          // 合法 provider
          provider: "slack",
          appId: "app-1",
          resourceId: "channel-1",
        },
        {
          // 非法 provider 名稱（含特殊字元）
          provider: "foo;bar",
          appId: "app-2",
          resourceId: "resource-2",
        },
      ],
    });

    const result = await buildClaudeOptions(pod);

    // 合法的 slack 應出現
    expect(result.mcpServers).toHaveProperty("slack-reply");
    // 非法的 foo;bar 不應出現（key 格式為 provider + '-reply'）
    expect(result.mcpServers).not.toHaveProperty("foo;bar-reply");
  });
});

describe("applyIntegrationToolOptions：provider 不存在時跳過（不 crash）", () => {
  it("provider 不存在時 buildClaudeOptions 應正常完成，不含 integration mcpServer", async () => {
    // 預設 integrationRegistry.get 回傳 undefined（已在 beforeEach 設好）
    const pod = createBasePod({
      integrationBindings: [
        {
          provider: "non-existent-provider",
          appId: "app-1",
          resourceId: "resource-1",
        },
      ],
    });

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
