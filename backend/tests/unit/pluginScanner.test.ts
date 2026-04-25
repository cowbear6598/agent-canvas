import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

// mock fs 模組
vi.mock("fs");

const mockReadFileSync = vi.mocked(fs.readFileSync);

// 動態 import pluginScanner，需在 mock 設定後才 import
const { scanInstalledPlugins, clearScanInstalledPluginsCache } =
  await import("../../src/services/pluginScanner.js");

const INSTALLED_PLUGINS_PATH = `${process.env.HOME}/.claude/plugins/installed_plugins.json`;

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

describe("pluginScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearScanInstalledPluginsCache();
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
        throw new Error("unexpected call");
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
        throw new Error("unexpected call");
      });

      const result = scanInstalledPlugins();

      expect(result).toEqual([]);
    });

    it("version 不是 2 時應回傳空陣列", () => {
      mockReadFileSync.mockImplementation((filePath) => {
        if (filePath === INSTALLED_PLUGINS_PATH) {
          return JSON.stringify({ version: 1, plugins: {} });
        }
        throw new Error("unexpected call");
      });

      const result = scanInstalledPlugins();

      expect(result).toEqual([]);
    });
  });

  describe("正常解析 Plugin 列表", () => {
    it("應正確解析 Plugin 的 id、name、version、description、installPath", () => {
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
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
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
        throw new Error(`unexpected readFileSync call: ${String(filePath)}`);
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

      expect(result).toHaveLength(2);
      expect(result[0].installPath).toBe(installPath1);
      expect(result[1].installPath).toBe(installPath2);
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
});
