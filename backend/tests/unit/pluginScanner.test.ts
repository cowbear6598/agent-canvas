import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

// mock fs 模組
vi.mock("fs");

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockStatSync = vi.mocked(fs.statSync);

// 動態 import pluginScanner，需在 mock 設定後才 import
const { scanInstalledPlugins, clearScanInstalledPluginsCache } =
  await import("../../src/services/pluginScanner.js");

const HOME = process.env.HOME;
const INSTALLED_PLUGINS_PATH = `${HOME}/.claude/plugins/installed_plugins.json`;
const CODEX_CACHE_DIR = `${HOME}/.codex/plugins/cache`;

function makeInstalledPluginsJson(plugins: Record<string, unknown[]>): string {
  return JSON.stringify({ version: 2, plugins });
}

function makePluginManifest(
  name: string,
  description: string,
  version?: string,
): string {
  return JSON.stringify({ name, description, ...(version ? { version } : {}) });
}

/** 建立假的 stat 物件，isDirectory 回傳指定值 */
function makeStat(isDir: boolean): fs.Stats {
  return { isDirectory: () => isDir } as fs.Stats;
}

describe("pluginScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearScanInstalledPluginsCache();
    // Codex 目錄預設不存在（避免每個測試都需要設定）
    mockReaddirSync.mockImplementation((p) => {
      throw new Error(
        `ENOENT: no such file or directory, scandir '${String(p)}'`,
      );
    });
    mockStatSync.mockImplementation((p) => {
      throw new Error(`ENOENT: no such file or directory, stat '${String(p)}'`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("installed_plugins.json 不存在時", () => {
    it("應回傳空陣列", () => {
      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          throw new Error("ENOENT: no such file or directory");
        }
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toEqual([]);
    });
  });

  describe("installed_plugins.json 格式錯誤時", () => {
    it("JSON 解析失敗時應回傳空陣列", () => {
      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return "invalid-json";
        }
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toEqual([]);
    });

    it("version 不是 2 時應回傳空陣列", () => {
      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return JSON.stringify({ version: 1, plugins: {} });
        }
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toEqual([]);
    });
  });

  describe("正常解析 Plugin 列表", () => {
    it("應正確解析 Plugin 的 id、name、version、description、installPath，且 compatibleProviders 含 claude", () => {
      const installPath = "/home/user/.claude/plugins/cache/my-plugin/1.0.0";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "dev@my-plugin": [
              {
                scope: "user",
                installPath,
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("My Plugin", "A test plugin");
        }
        // .codex-plugin/plugin.json 不存在
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

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

    it("Claude plugin 同時有 .codex-plugin/plugin.json 時 compatibleProviders 應含兩者", () => {
      const installPath = "/home/user/.claude/plugins/cache/dual/1.0.0";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "dual@marketplace": [
              {
                scope: "user",
                installPath,
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Dual Plugin", "Both providers");
        }
        if (filePath === `${installPath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Dual Plugin", "Both providers");
        }
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].compatibleProviders).toContain("claude");
      expect(result[0].compatibleProviders).toContain("codex");
    });

    it("應正確從 plugin ID 解析 repo（@ 後面的部分）", () => {
      const installPath =
        "/home/user/.claude/plugins/cache/soap-toolkit/soap-dev/1.0.7";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "soap-dev@soap-toolkit": [
              {
                scope: "user",
                installPath,
                version: "1.0.7",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Soap Dev", "Soap Dev Plugin", "1.0.7");
        }
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].repo).toBe("soap-toolkit");
    });

    it("plugin ID 沒有 @ 時 repo 應為空字串", () => {
      const installPath =
        "/home/user/.claude/plugins/cache/no-repo-plugin/1.0.0";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "no-repo-plugin": [
              {
                scope: "user",
                installPath,
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        throw new Error("ENOENT: no such file or directory");
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].repo).toBe("");
    });

    it("plugin.json 不存在時應使用 plugin key 作為 name", () => {
      const installPath = "/home/user/.claude/plugins/cache/my-plugin/1.0.0";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "dev@my-plugin": [
              {
                scope: "user",
                installPath,
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        // plugin.json 不存在
        throw new Error("ENOENT: no such file or directory");
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("dev@my-plugin");
      expect(result[0].name).toBe("dev@my-plugin");
      expect(result[0].description).toBe("");
    });

    it("plugin id 含不合法字元應略過", () => {
      const validPath = "/home/user/.claude/plugins/cache/valid/1.0.0";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "valid@repo": [
              {
                scope: "user",
                installPath: validPath,
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
            "bad plugin; rm -rf": [
              {
                scope: "user",
                installPath: "/tmp/bad",
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        if (filePath === `${validPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Valid Plugin", "OK");
        }
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid@repo");
    });
  });

  describe("多 scope 安裝相同 installPath 時去重", () => {
    it("相同 installPath 的多個 scope 只應列一次", () => {
      const installPath =
        "/home/user/.claude/plugins/cache/soap-toolkit/soap-dev/1.0.7";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
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
          });
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Soap Dev", "Soap Dev Plugin");
        }
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("soap-dev@soap-toolkit");
      expect(result[0].installPath).toBe(installPath);
    });

    it("不同 installPath 的多個 scope 應分別列出", () => {
      const installPath1 =
        "/home/user/.claude/plugins/cache/soap-toolkit/soap-dev/1.0.7";
      const installPath2 =
        "/home/user/.claude/plugins/cache/soap-toolkit/soap-dev/2.0.0";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
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
          });
        }
        if (filePath === `${installPath1}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Soap Dev", "Soap Dev Plugin v1");
        }
        if (filePath === `${installPath2}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Soap Dev", "Soap Dev Plugin v2");
        }
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      // 相同 plugin id 的兩個 scope（不同版本/installPath）經 mergePlugins 合併為 1 筆
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("soap-dev@soap-toolkit");
    });
  });

  describe("多個不同 plugin", () => {
    it("應正確列出所有 plugin", () => {
      const path1 =
        "/home/user/.claude/plugins/cache/official/skill-creator/abc123";
      const path2 =
        "/home/user/.claude/plugins/cache/soap-toolkit/soap-dev/1.0.7";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
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
          });
        }
        if (filePath === `${path1}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Skill Creator", "Create skills");
        }
        if (filePath === `${path2}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Soap Dev", "Soap toolkit");
        }
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(2);
      const ids = result.map((p) => p.id);
      expect(ids).toContain("skill-creator@claude-plugins-official");
      expect(ids).toContain("soap-dev@soap-toolkit");
    });
  });

  describe("Codex 來源掃描", () => {
    it("~/.codex/plugins/cache 不存在時應回傳空陣列（Codex 部分）", () => {
      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          throw new Error("ENOENT");
        }
        throw new Error(`unexpected: ${String(filePath)}`);
      });
      // readdirSync 預設已設定為 throw（在 beforeEach）

      const result = scanInstalledPlugins();
      expect(result).toEqual([]);
    });

    it("應正確掃描 Codex cache 目錄並建立 plugin", () => {
      const installPath = `${CODEX_CACHE_DIR}/openai-curated/gmail/1.0.0`;

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          throw new Error("ENOENT");
        }
        if (filePath === `${installPath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Gmail Plugin", "Connect Gmail", "1.0.0");
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          throw new Error("ENOENT");
        }
        throw new Error(`unexpected: ${String(filePath)}`);
      });

      mockReaddirSync.mockImplementation((dirPath) => {
        if (dirPath === CODEX_CACHE_DIR)
          return ["openai-curated"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/openai-curated`)
          return ["gmail"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/openai-curated/gmail`)
          return ["1.0.0"] as unknown as fs.Dirent[];
        throw new Error(`unexpected readdirSync: ${String(dirPath)}`);
      });

      mockStatSync.mockImplementation((p) => {
        const str = String(p);
        if (
          str === `${CODEX_CACHE_DIR}/openai-curated` ||
          str === `${CODEX_CACHE_DIR}/openai-curated/gmail` ||
          str === `${CODEX_CACHE_DIR}/openai-curated/gmail/1.0.0`
        ) {
          return makeStat(true);
        }
        throw new Error(`unexpected statSync: ${str}`);
      });

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

    it("Codex plugin 同時有 .claude-plugin/plugin.json 時 compatibleProviders 應含兩者", () => {
      const installPath = `${CODEX_CACHE_DIR}/marketplace/dual-plugin/2.0.0`;

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) throw new Error("ENOENT");
        if (filePath === `${installPath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Dual", "Both");
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Dual Claude", "Both from Claude");
        }
        throw new Error(`unexpected: ${String(filePath)}`);
      });

      mockReaddirSync.mockImplementation((dirPath) => {
        if (dirPath === CODEX_CACHE_DIR)
          return ["marketplace"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace`)
          return ["dual-plugin"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace/dual-plugin`)
          return ["2.0.0"] as unknown as fs.Dirent[];
        throw new Error(`unexpected readdirSync: ${String(dirPath)}`);
      });

      mockStatSync.mockImplementation((p) => {
        const str = String(p);
        if (
          str === `${CODEX_CACHE_DIR}/marketplace` ||
          str === `${CODEX_CACHE_DIR}/marketplace/dual-plugin` ||
          str === `${CODEX_CACHE_DIR}/marketplace/dual-plugin/2.0.0`
        ) {
          return makeStat(true);
        }
        throw new Error(`unexpected statSync: ${str}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].compatibleProviders).toContain("codex");
      expect(result[0].compatibleProviders).toContain("claude");
    });

    it("Codex plugin 同 plugin 有多版本時應取字典序最大者", () => {
      const installPath = `${CODEX_CACHE_DIR}/marketplace/tool/2.0.0`;

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) throw new Error("ENOENT");
        if (filePath === `${installPath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Tool", "Latest", "2.0.0");
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          throw new Error("ENOENT");
        }
        throw new Error(`unexpected: ${String(filePath)}`);
      });

      mockReaddirSync.mockImplementation((dirPath) => {
        if (dirPath === CODEX_CACHE_DIR)
          return ["marketplace"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace`)
          return ["tool"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace/tool`)
          return ["1.0.0", "2.0.0", "0.9.0"] as unknown as fs.Dirent[];
        throw new Error(`unexpected readdirSync: ${String(dirPath)}`);
      });

      mockStatSync.mockImplementation((p) => {
        const str = String(p);
        if (
          str === `${CODEX_CACHE_DIR}/marketplace` ||
          str === `${CODEX_CACHE_DIR}/marketplace/tool` ||
          str.startsWith(`${CODEX_CACHE_DIR}/marketplace/tool/`)
        ) {
          return makeStat(true);
        }
        throw new Error(`unexpected statSync: ${str}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].installPath).toBe(installPath);
      expect(result[0].version).toBe("2.0.0");
    });

    it("Codex 目錄內沒有 .codex-plugin/plugin.json 時應略過", () => {
      const installPath = `${CODEX_CACHE_DIR}/marketplace/badplugin/1.0.0`;

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) throw new Error("ENOENT");
        // 不存在任何 manifest
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

      mockReaddirSync.mockImplementation((dirPath) => {
        if (dirPath === CODEX_CACHE_DIR)
          return ["marketplace"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace`)
          return ["badplugin"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace/badplugin`)
          return ["1.0.0"] as unknown as fs.Dirent[];
        throw new Error(`unexpected readdirSync: ${String(dirPath)}`);
      });

      mockStatSync.mockImplementation((p) => {
        const str = String(p);
        if (
          str === `${CODEX_CACHE_DIR}/marketplace` ||
          str === `${CODEX_CACHE_DIR}/marketplace/badplugin` ||
          str === installPath
        ) {
          return makeStat(true);
        }
        throw new Error(`unexpected statSync: ${str}`);
      });

      const result = scanInstalledPlugins();
      expect(result).toEqual([]);
    });
  });

  describe("provider 過濾", () => {
    it("傳入 provider='claude' 時只回傳含 claude 的 plugin", () => {
      const claudePath = `${CODEX_CACHE_DIR}/marketplace/claude-only/1.0.0`;
      const codexPath = `${CODEX_CACHE_DIR}/marketplace/codex-only/1.0.0`;

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) throw new Error("ENOENT");
        if (filePath === `${claudePath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Claude Only", "Only claude");
        }
        if (filePath === `${claudePath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Claude Only", "Only claude");
        }
        if (filePath === `${codexPath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Codex Only", "Only codex");
        }
        if (filePath === `${codexPath}/.claude-plugin/plugin.json`) {
          throw new Error("ENOENT");
        }
        throw new Error(`unexpected: ${String(filePath)}`);
      });

      mockReaddirSync.mockImplementation((dirPath) => {
        if (dirPath === CODEX_CACHE_DIR)
          return ["marketplace"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace`)
          return ["claude-only", "codex-only"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace/claude-only`)
          return ["1.0.0"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace/codex-only`)
          return ["1.0.0"] as unknown as fs.Dirent[];
        throw new Error(`unexpected readdirSync: ${String(dirPath)}`);
      });

      mockStatSync.mockImplementation((p) => {
        const str = String(p);
        if (
          str === `${CODEX_CACHE_DIR}/marketplace` ||
          str === `${CODEX_CACHE_DIR}/marketplace/claude-only` ||
          str === claudePath ||
          str === `${CODEX_CACHE_DIR}/marketplace/codex-only` ||
          str === codexPath
        ) {
          return makeStat(true);
        }
        throw new Error(`unexpected statSync: ${str}`);
      });

      const claudeResult = scanInstalledPlugins("claude");
      expect(claudeResult).toHaveLength(1);
      expect(claudeResult[0].id).toBe("claude-only@marketplace");

      clearScanInstalledPluginsCache();

      // 重設 mock 後測 codex 過濾
      vi.clearAllMocks();
      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) throw new Error("ENOENT");
        if (filePath === `${claudePath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Claude Only", "Only claude");
        }
        if (filePath === `${claudePath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Claude Only", "Only claude");
        }
        if (filePath === `${codexPath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Codex Only", "Only codex");
        }
        if (filePath === `${codexPath}/.claude-plugin/plugin.json`) {
          throw new Error("ENOENT");
        }
        throw new Error(`unexpected: ${String(filePath)}`);
      });
      mockReaddirSync.mockImplementation((dirPath) => {
        if (dirPath === CODEX_CACHE_DIR)
          return ["marketplace"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace`)
          return ["claude-only", "codex-only"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace/claude-only`)
          return ["1.0.0"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/marketplace/codex-only`)
          return ["1.0.0"] as unknown as fs.Dirent[];
        throw new Error(`unexpected readdirSync: ${String(dirPath)}`);
      });
      mockStatSync.mockImplementation((p) => {
        const str = String(p);
        if (
          str === `${CODEX_CACHE_DIR}/marketplace` ||
          str === `${CODEX_CACHE_DIR}/marketplace/claude-only` ||
          str === claudePath ||
          str === `${CODEX_CACHE_DIR}/marketplace/codex-only` ||
          str === codexPath
        ) {
          return makeStat(true);
        }
        throw new Error(`unexpected statSync: ${str}`);
      });

      const codexResult = scanInstalledPlugins("codex");
      expect(codexResult).toHaveLength(2);
    });

    it("不傳 provider 時回傳全集", () => {
      const installPath = "/home/user/.claude/plugins/cache/myplugin/1.0.0";

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "myplugin@repo": [
              {
                scope: "user",
                installPath,
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        if (filePath === `${installPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("My Plugin", "desc");
        }
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

      const result = scanInstalledPlugins();
      expect(result).toHaveLength(1);
      expect(result[0].compatibleProviders).toContain("claude");
    });
  });

  describe("Claude 與 Codex 來源同 id 合併", () => {
    it("同 id 的 plugin 兩邊都有時應合併 compatibleProviders", () => {
      const claudeInstallPath =
        "/home/user/.claude/plugins/cache/shared/shared-plugin/1.0.0";
      const codexInstallPath = `${CODEX_CACHE_DIR}/shared-marketplace/shared-plugin/1.0.0`;

      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return makeInstalledPluginsJson({
            "shared-plugin@shared-marketplace": [
              {
                scope: "user",
                installPath: claudeInstallPath,
                version: "1.0.0",
                installedAt: "",
                lastUpdated: "",
              },
            ],
          });
        }
        if (filePath === `${claudeInstallPath}/.claude-plugin/plugin.json`) {
          return makePluginManifest("Shared Plugin", "From Claude");
        }
        if (filePath === `${claudeInstallPath}/.codex-plugin/plugin.json`) {
          throw new Error("ENOENT");
        }
        if (filePath === `${codexInstallPath}/.codex-plugin/plugin.json`) {
          return makePluginManifest("Shared Plugin", "From Codex");
        }
        if (filePath === `${codexInstallPath}/.claude-plugin/plugin.json`) {
          throw new Error("ENOENT");
        }
        throw new Error(`unexpected: ${String(filePath)}`);
      });

      mockReaddirSync.mockImplementation((dirPath) => {
        if (dirPath === CODEX_CACHE_DIR)
          return ["shared-marketplace"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/shared-marketplace`)
          return ["shared-plugin"] as unknown as fs.Dirent[];
        if (dirPath === `${CODEX_CACHE_DIR}/shared-marketplace/shared-plugin`)
          return ["1.0.0"] as unknown as fs.Dirent[];
        throw new Error(`unexpected readdirSync: ${String(dirPath)}`);
      });

      mockStatSync.mockImplementation((p) => {
        const str = String(p);
        if (
          str === `${CODEX_CACHE_DIR}/shared-marketplace` ||
          str === `${CODEX_CACHE_DIR}/shared-marketplace/shared-plugin` ||
          str === codexInstallPath
        ) {
          return makeStat(true);
        }
        throw new Error(`unexpected statSync: ${str}`);
      });

      const result = scanInstalledPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("shared-plugin@shared-marketplace");
      expect(result[0].compatibleProviders).toContain("claude");
      expect(result[0].compatibleProviders).toContain("codex");
    });
  });
});
