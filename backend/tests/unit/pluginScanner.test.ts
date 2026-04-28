import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createTmpDir,
  cleanupTmpDir,
  overrideEnv,
} from "../helpers/tmpDirHelper.js";

// mock logger，避免測試時產生雜訊
vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────
// Helpers：建立目錄結構與寫入檔案
// ─────────────────────────────────────────────

/** 建立 installed_plugins.json 內容字串 */
function makeInstalledPluginsJson(plugins: Record<string, unknown[]>): string {
  return JSON.stringify({ version: 2, plugins });
}

/** 建立 plugin.json manifest 內容字串 */
function makePluginManifest(
  name: string,
  description: string,
  version?: string,
): string {
  return JSON.stringify({ name, description, ...(version ? { version } : {}) });
}

/** 在 installPath 下寫入 .claude-plugin/plugin.json */
async function writeClaudePluginManifest(
  installPath: string,
  name: string,
  description: string,
  version?: string,
): Promise<void> {
  const dir = join(installPath, ".claude-plugin");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "plugin.json"),
    makePluginManifest(name, description, version),
  );
}

/** 在 installPath 下寫入 .codex-plugin/plugin.json */
async function writeCodexPluginManifest(
  installPath: string,
  name: string,
  description: string,
  version?: string,
): Promise<void> {
  const dir = join(installPath, ".codex-plugin");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "plugin.json"),
    makePluginManifest(name, description, version),
  );
}

// ─────────────────────────────────────────────
// 測試套件
// ─────────────────────────────────────────────

// 注意：Bun 的 os.homedir() 不受 process.env.HOME 動態改變影響，
// 因此 scanClaudeInstalledPlugins 的 isPathWithinDirectory 安全驗證
// 永遠使用真實的 os.homedir()。
// Claude 來源的 installPath 必須建立在真實 ~/.claude/plugins/ 下的測試子目錄，
// Codex 來源的 installPath 則可放在 os.tmpdir() 下的 tmp dir。

describe("pluginScanner", () => {
  // Claude 來源：使用真實 ~/.claude/plugins/ 下的測試隔離子目錄
  // 避免污染既有 installed_plugins.json，改用 CLAUDE_PLUGINS_INSTALLED_PATH 覆寫
  const REAL_CLAUDE_PLUGINS = join(homedir(), ".claude", "plugins");

  // 每個測試的隔離目錄名稱（在 ~/.claude/plugins/test-<pid>-<rand> 下建立）
  let claudeTestDir: string; // ~/.claude/plugins/test-<pid>-<rand>
  let installedPluginsPath: string; // 覆寫用的 installed_plugins.json 路徑

  // Codex 來源：使用 os.tmpdir() 下的獨立 tmp dir
  let tmpHome: string; // /tmp/ccc-test-xxx
  let codexCacheDir: string; // /tmp/ccc-test-xxx/.codex/plugins/cache

  let restoreEnv: () => void;

  beforeEach(async () => {
    // 建立 Claude 測試隔離子目錄（在真實的 ~/.claude/plugins/ 下）
    claudeTestDir = await mkdtemp(join(REAL_CLAUDE_PLUGINS, "test-"));
    installedPluginsPath = join(claudeTestDir, "installed_plugins.json");

    // 建立 Codex 用的 tmp dir（透過 helper 使用 os.tmpdir()）
    tmpHome = await createTmpDir("ccc-plugin-test-");
    codexCacheDir = join(tmpHome, ".codex", "plugins", "cache");
    await mkdir(codexCacheDir, { recursive: true });

    // 儲存並覆寫環境變數
    restoreEnv = overrideEnv({
      CLAUDE_PLUGINS_INSTALLED_PATH: installedPluginsPath,
      CODEX_PLUGINS_CACHE_DIR: codexCacheDir,
    });
  });

  afterEach(async () => {
    restoreEnv();

    // 清掉測試目錄（Claude 測試子目錄 + Codex tmp dir）
    await rm(claudeTestDir, { recursive: true, force: true });
    await cleanupTmpDir(tmpHome);
  });

  /**
   * 清除 module 快取並重新 import pluginScanner，
   * 讓 module 頂層常數（INSTALLED_PLUGINS_PATH / CODEX_PLUGINS_CACHE_DIR）
   * 重新讀取目前的 process.env 值。
   */
  async function reimportPluginScanner() {
    vi.resetModules();
    return import("../../src/services/pluginScanner.js");
  }

  describe("installed_plugins.json 不存在時", () => {
    it("應回傳空陣列", async () => {
      // 不寫入任何 installed_plugins.json
      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();
      expect(result).toEqual([]);
    });
  });

  describe("installed_plugins.json 格式錯誤時", () => {
    it("JSON 解析失敗時應回傳空陣列", async () => {
      await writeFile(installedPluginsPath, "invalid-json");
      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();
      expect(result).toEqual([]);
    });

    it("version 不是 2 時應回傳空陣列", async () => {
      await writeFile(
        installedPluginsPath,
        JSON.stringify({ version: 1, plugins: {} }),
      );
      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();
      expect(result).toEqual([]);
    });
  });

  describe("正常解析 Plugin 列表", () => {
    it("應正確解析 Plugin 的 id、name、version、description、installPath，且 compatibleProviders 含 claude", async () => {
      // installPath 必須在真實 ~/.claude/plugins/ 下才能通過 isPathWithinDirectory 驗證
      const installPath = join(claudeTestDir, "my-plugin", "1.0.0");
      await mkdir(installPath, { recursive: true });
      await writeClaudePluginManifest(
        installPath,
        "My Plugin",
        "A test plugin",
      );

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "dev@my-plugin": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "dev@my-plugin",
        name: "My Plugin",
        description: "A test plugin",
        installPath,
        repo: "my-plugin",
      });
      expect(result[0].compatibleProviders).toContain("claude");
    });

    it("Claude plugin 同時有 .codex-plugin/plugin.json 時 compatibleProviders 應含兩者", async () => {
      const installPath = join(claudeTestDir, "dual", "1.0.0");
      await mkdir(installPath, { recursive: true });
      await writeClaudePluginManifest(
        installPath,
        "Dual Plugin",
        "Both providers",
      );
      await writeCodexPluginManifest(
        installPath,
        "Dual Plugin",
        "Both providers",
      );

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "dual@marketplace": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].compatibleProviders).toContain("claude");
      expect(result[0].compatibleProviders).toContain("codex");
    });

    it("應正確從 plugin ID 解析 repo（@ 後面的部分）", async () => {
      const installPath = join(
        claudeTestDir,
        "soap-toolkit",
        "soap-dev",
        "1.0.7",
      );
      await mkdir(installPath, { recursive: true });
      await writeClaudePluginManifest(
        installPath,
        "Soap Dev",
        "Soap Dev Plugin",
        "1.0.7",
      );

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "soap-dev@soap-toolkit": [
            {
              scope: "user",
              installPath,
              version: "1.0.7",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].repo).toBe("soap-toolkit");
    });

    it("plugin ID 沒有 @ 時 repo 應為空字串", async () => {
      const installPath = join(claudeTestDir, "no-repo-plugin", "1.0.0");
      await mkdir(installPath, { recursive: true });

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "no-repo-plugin": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].repo).toBe("");
    });

    it("plugin.json 不存在時應使用 plugin key 作為 name", async () => {
      const installPath = join(claudeTestDir, "my-plugin", "1.0.0");
      await mkdir(installPath, { recursive: true });
      // 不建立任何 manifest

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "dev@my-plugin": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("dev@my-plugin");
      expect(result[0].name).toBe("dev@my-plugin");
      expect(result[0].description).toBe("");
    });

    it("plugin id 含不合法字元應略過", async () => {
      const validPath = join(claudeTestDir, "valid", "1.0.0");
      await mkdir(validPath, { recursive: true });
      await writeClaudePluginManifest(validPath, "Valid Plugin", "OK");

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "valid@repo": [
            {
              scope: "user",
              installPath: validPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
          // 含不合法字元的 plugin id，應被 PLUGIN_ID_PATTERN 過濾
          "bad plugin; rm -rf": [
            {
              scope: "user",
              installPath: join(claudeTestDir, "bad"),
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid@repo");
    });
  });

  describe("多 scope 安裝相同 installPath 時去重", () => {
    it("相同 installPath 的多個 scope 只應列一次", async () => {
      const installPath = join(
        claudeTestDir,
        "soap-toolkit",
        "soap-dev",
        "1.0.7",
      );
      await mkdir(installPath, { recursive: true });
      await writeClaudePluginManifest(
        installPath,
        "Soap Dev",
        "Soap Dev Plugin",
      );

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "soap-dev@soap-toolkit": [
            {
              scope: "project",
              projectPath: "/some/project",
              installPath,
              version: "1.0.7",
              installedAt: "",
              lastUpdated: "",
            },
            {
              scope: "user",
              installPath,
              version: "1.0.7",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("soap-dev@soap-toolkit");
      expect(result[0].installPath).toBe(installPath);
    });

    it("不同 installPath 的多個 scope 應合併為一筆（mergePlugins 以 id 去重）", async () => {
      const installPath1 = join(
        claudeTestDir,
        "soap-toolkit",
        "soap-dev",
        "1.0.7",
      );
      const installPath2 = join(
        claudeTestDir,
        "soap-toolkit",
        "soap-dev",
        "2.0.0",
      );
      await mkdir(installPath1, { recursive: true });
      await mkdir(installPath2, { recursive: true });
      await writeClaudePluginManifest(
        installPath1,
        "Soap Dev",
        "Soap Dev Plugin v1",
      );
      await writeClaudePluginManifest(
        installPath2,
        "Soap Dev",
        "Soap Dev Plugin v2",
      );

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "soap-dev@soap-toolkit": [
            {
              scope: "user",
              installPath: installPath1,
              version: "1.0.7",
              installedAt: "",
              lastUpdated: "",
            },
            {
              scope: "project",
              projectPath: "/some/project",
              installPath: installPath2,
              version: "2.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      // 相同 plugin id 兩個不同 installPath（Claude 來源），
      // scanClaudeInstalledPlugins 以 installPath 為 key 去重，兩筆均記錄，
      // 但 mergePlugins 以 id 為 key，最終合併為 1 筆
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("soap-dev@soap-toolkit");
    });
  });

  describe("多個不同 plugin", () => {
    it("應正確列出所有 plugin", async () => {
      const path1 = join(claudeTestDir, "official", "skill-creator", "abc123");
      const path2 = join(claudeTestDir, "soap-toolkit", "soap-dev", "1.0.7");
      await mkdir(path1, { recursive: true });
      await mkdir(path2, { recursive: true });
      await writeClaudePluginManifest(path1, "Skill Creator", "Create skills");
      await writeClaudePluginManifest(path2, "Soap Dev", "Soap toolkit");

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "skill-creator@claude-plugins-official": [
            {
              scope: "user",
              installPath: path1,
              version: "abc123",
              installedAt: "",
              lastUpdated: "",
            },
          ],
          "soap-dev@soap-toolkit": [
            {
              scope: "user",
              installPath: path2,
              version: "1.0.7",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(2);
      const ids = result.map((p) => p.id);
      expect(ids).toContain("skill-creator@claude-plugins-official");
      expect(ids).toContain("soap-dev@soap-toolkit");
    });
  });

  describe("Codex 來源掃描", () => {
    it("~/.codex/plugins/cache 不存在時應回傳空陣列（Codex 部分）", async () => {
      // 刪掉 codexCacheDir，讓 readdirSync 失敗
      await rm(codexCacheDir, { recursive: true, force: true });
      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();
      expect(result).toEqual([]);
    });

    it("應正確掃描 Codex cache 目錄並建立 plugin", async () => {
      // ~/.codex/plugins/cache/openai-curated/gmail/1.0.0/
      const installPath = join(
        codexCacheDir,
        "openai-curated",
        "gmail",
        "1.0.0",
      );
      await mkdir(installPath, { recursive: true });
      await writeCodexPluginManifest(
        installPath,
        "Gmail Plugin",
        "Connect Gmail",
        "1.0.0",
      );
      // 不寫 installed_plugins.json（只測 Codex 來源）

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "gmail@openai-curated",
        name: "Gmail Plugin",
        description: "Connect Gmail",
        version: "1.0.0",
        installPath,
        repo: "openai-curated",
      });
      expect(result[0].compatibleProviders).toContain("codex");
      expect(result[0].compatibleProviders).not.toContain("claude");
    });

    it("Codex plugin 同時有 .claude-plugin/plugin.json 時 compatibleProviders 應含兩者", async () => {
      const installPath = join(
        codexCacheDir,
        "marketplace",
        "dual-plugin",
        "2.0.0",
      );
      await mkdir(installPath, { recursive: true });
      await writeCodexPluginManifest(installPath, "Dual", "Both");
      await writeClaudePluginManifest(
        installPath,
        "Dual Claude",
        "Both from Claude",
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].compatibleProviders).toContain("codex");
      expect(result[0].compatibleProviders).toContain("claude");
    });

    it("Codex plugin 同 plugin 有多版本時應取字典序最大者", async () => {
      // 建立三個版本目錄，只在最大版本寫入 codex manifest
      for (const ver of ["1.0.0", "2.0.0", "0.9.0"]) {
        const vp = join(codexCacheDir, "marketplace", "tool", ver);
        await mkdir(vp, { recursive: true });
        if (ver === "2.0.0") {
          await writeCodexPluginManifest(vp, "Tool", "Latest", "2.0.0");
        }
      }

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].installPath).toBe(
        join(codexCacheDir, "marketplace", "tool", "2.0.0"),
      );
      expect(result[0].version).toBe("2.0.0");
    });

    it("Codex 目錄內沒有 .codex-plugin/plugin.json 時應略過", async () => {
      const installPath = join(
        codexCacheDir,
        "marketplace",
        "badplugin",
        "1.0.0",
      );
      await mkdir(installPath, { recursive: true });
      // 不寫任何 manifest

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toEqual([]);
    });
  });

  describe("provider 過濾", () => {
    it("傳入 provider='claude' 時只回傳含 claude 的 plugin", async () => {
      // claude-only：同時有 .claude-plugin 和 .codex-plugin
      const claudePath = join(
        codexCacheDir,
        "marketplace",
        "claude-only",
        "1.0.0",
      );
      await mkdir(claudePath, { recursive: true });
      await writeCodexPluginManifest(claudePath, "Claude Only", "Only claude");
      await writeClaudePluginManifest(claudePath, "Claude Only", "Only claude");

      // codex-only：只有 .codex-plugin
      const codexPath = join(
        codexCacheDir,
        "marketplace",
        "codex-only",
        "1.0.0",
      );
      await mkdir(codexPath, { recursive: true });
      await writeCodexPluginManifest(codexPath, "Codex Only", "Only codex");

      const { scanInstalledPlugins, clearScanInstalledPluginsCache } =
        await reimportPluginScanner();

      const claudeResult = scanInstalledPlugins("claude");
      expect(claudeResult).toHaveLength(1);
      expect(claudeResult[0].id).toBe("claude-only@marketplace");

      clearScanInstalledPluginsCache();

      const codexResult = scanInstalledPlugins("codex");
      expect(codexResult).toHaveLength(2);
    });

    it("不傳 provider 時回傳全集", async () => {
      const installPath = join(claudeTestDir, "myplugin", "1.0.0");
      await mkdir(installPath, { recursive: true });
      await writeClaudePluginManifest(installPath, "My Plugin", "desc");

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "myplugin@repo": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].compatibleProviders).toContain("claude");
    });
  });

  describe("Claude 與 Codex 來源同 id 合併", () => {
    it("同 id 的 plugin 兩邊都有時應合併 compatibleProviders", async () => {
      // Claude 來源：installPath 在真實 ~/.claude/plugins/ 下（通過安全驗證）
      const claudeInstallPath = join(
        claudeTestDir,
        "shared",
        "shared-plugin",
        "1.0.0",
      );
      await mkdir(claudeInstallPath, { recursive: true });
      await writeClaudePluginManifest(
        claudeInstallPath,
        "Shared Plugin",
        "From Claude",
      );

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "shared-plugin@shared-marketplace": [
            {
              scope: "user",
              installPath: claudeInstallPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      // Codex 來源：installPath 在 codexCacheDir 內
      const codexInstallPath = join(
        codexCacheDir,
        "shared-marketplace",
        "shared-plugin",
        "1.0.0",
      );
      await mkdir(codexInstallPath, { recursive: true });
      await writeCodexPluginManifest(
        codexInstallPath,
        "Shared Plugin",
        "From Codex",
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("shared-plugin@shared-marketplace");
      expect(result[0].compatibleProviders).toContain("claude");
      expect(result[0].compatibleProviders).toContain("codex");
    });
  });

  describe("5 秒 TTL 快取", () => {
    it("5 秒內重複呼叫應走快取，回傳相同結果", async () => {
      const installPath = join(claudeTestDir, "cached-plugin", "1.0.0");
      await mkdir(installPath, { recursive: true });
      await writeClaudePluginManifest(installPath, "Cached Plugin", "desc");

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "cached-plugin@repo": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result1 = scanInstalledPlugins();
      const result2 = scanInstalledPlugins();

      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
    });

    it("clearScanInstalledPluginsCache 後應重新讀取磁碟", async () => {
      const installPath = join(claudeTestDir, "first-plugin", "1.0.0");
      await mkdir(installPath, { recursive: true });
      await writeClaudePluginManifest(installPath, "First Plugin", "first");

      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "first-plugin@repo": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      const { scanInstalledPlugins, clearScanInstalledPluginsCache } =
        await reimportPluginScanner();

      const result1 = scanInstalledPlugins();
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("First Plugin");

      // 清除快取，清空 installed_plugins.json
      clearScanInstalledPluginsCache();
      await writeFile(
        installedPluginsPath,
        JSON.stringify({ version: 2, plugins: {} }),
      );

      const result2 = scanInstalledPlugins();
      expect(result2).toHaveLength(0);
    });
  });
});
