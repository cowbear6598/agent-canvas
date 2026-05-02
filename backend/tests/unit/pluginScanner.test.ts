import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import fs from "node:fs";
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

/**
 * 設計說明（方向 B）：
 *
 * ESM native 模組無法被 vi.spyOn 攔截（Module namespace is not configurable in ESM），
 * 因此改由產品碼加入 resolveClaudePluginsRoot() helper，讓測試透過 env var 注入路徑：
 *
 *   - CLAUDE_PLUGINS_INSTALLED_PATH：覆寫頂層 const，讓 installed_plugins.json 指向 tmpHome
 *   - CODEX_PLUGINS_CACHE_DIR：覆寫頂層 const，讓 Codex cache 路徑指向 tmpHome
 *   - CLAUDE_PLUGINS_ROOT_OVERRIDE：覆寫 resolveClaudePluginsRoot()，
 *     讓 scanClaudeInstalledPlugins() 內的 isPathWithinDirectory 安全驗證指向 tmpHome
 *
 * 搭配 vi.resetModules() + 動態 import，確保每次 reimport 時頂層 const 重新計算。
 * 完全不依賴、不接觸真實 ~/.claude/plugins/。
 */

describe("pluginScanner", () => {
  // 每個測試都使用獨立的 tmpHome，完全隔離於真實 HOME 目錄之外
  let tmpHome: string; // /tmp/ccc-plugin-test-xxx（模擬 HOME）
  let claudePluginsRoot: string; // tmpHome/.claude/plugins
  let claudeTestDir: string; // tmpHome/.claude/plugins/test-<rand>（Claude plugin installPath 隔離區）
  let installedPluginsPath: string; // 覆寫 CLAUDE_PLUGINS_INSTALLED_PATH 用
  let codexCacheDir: string; // tmpHome/.codex/plugins/cache

  // 預設 no-op，確保 afterEach 在 beforeEach 提早失敗時也能安全呼叫
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    // 1. 建立完全隔離的 tmpHome（不碰真實 ~/）
    tmpHome = await createTmpDir("ccc-plugin-test-");

    // 2. 建立 Claude plugins 目錄結構於 tmpHome 內
    claudePluginsRoot = join(tmpHome, ".claude", "plugins");
    await mkdir(claudePluginsRoot, { recursive: true });

    // 3. 在 tmpHome/.claude/plugins/ 下建立每個測試的隔離子目錄
    //    Claude plugin installPath 必須在此目錄下，才能通過 CLAUDE_PLUGINS_ROOT_OVERRIDE 驗證
    claudeTestDir = await mkdtemp(join(claudePluginsRoot, "test-"));
    installedPluginsPath = join(claudeTestDir, "installed_plugins.json");

    // 4. 建立 Codex cache 目錄結構於 tmpHome 內
    codexCacheDir = join(tmpHome, ".codex", "plugins", "cache");
    await mkdir(codexCacheDir, { recursive: true });

    // 5. 設定所有 env var 覆寫，讓 reimport 後的產品碼完全指向 tmpHome 內的路徑：
    //    - CLAUDE_PLUGINS_INSTALLED_PATH：覆寫頂層 const
    //    - CODEX_PLUGINS_CACHE_DIR：覆寫頂層 const
    //    - CLAUDE_PLUGINS_ROOT_OVERRIDE：覆寫 resolveClaudePluginsRoot()，
    //      讓 isPathWithinDirectory 安全驗證不再依賴 os.homedir()
    restoreEnv = overrideEnv({
      CLAUDE_PLUGINS_INSTALLED_PATH: installedPluginsPath,
      CODEX_PLUGINS_CACHE_DIR: codexCacheDir,
      CLAUDE_PLUGINS_ROOT_OVERRIDE: claudePluginsRoot,
      // 隔離 Gemini extensions 目錄，防止吃到機器上真實安裝的 extensions
      GEMINI_EXTENSIONS_ROOT_OVERRIDE:
        "/tmp/__never_exists_gemini_extensions__",
    });
  });

  afterEach(async () => {
    // 還原 env var
    restoreEnv();

    // 清除 tmpHome（包含所有測試產生的檔案）；真實 ~/.claude/plugins/ 完全不受影響
    await cleanupTmpDir(tmpHome);
  });

  /**
   * 清除 module 快取並重新 import pluginScanner，
   * 讓 module 頂層常數（INSTALLED_PLUGINS_PATH / CODEX_PLUGINS_CACHE_DIR）
   * 重新讀取目前的 process.env 值。
   * resolveClaudePluginsRoot() 在函式呼叫時也會讀到 CLAUDE_PLUGINS_ROOT_OVERRIDE。
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
      // installPath 在 tmpHome/.claude/plugins/ 下，可通過 isPathWithinDirectory 驗證
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

    it("Claude plugin 同時有 .codex-plugin/plugin.json 時 compatibleProviders 仍只含 claude（以來源為界）", async () => {
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
      // Claude 來源不偵測跨 provider，不應含 codex
      expect(result[0].compatibleProviders).not.toContain("codex");
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
      // tmpHome/.codex/plugins/cache/openai-curated/gmail/1.0.0/
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

    it("Codex plugin 同時有 .claude-plugin/plugin.json 時 compatibleProviders 仍只含 codex（以來源為界）", async () => {
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
      // Codex 來源不偵測跨 provider，不應含 claude
      expect(result[0].compatibleProviders).not.toContain("claude");
      // name/description 直接取自 codexManifest（不再 fallback 到 claudeManifest）
      expect(result[0].name).toBe("Dual");
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

  // ─────────────────────────────────────────────────────────────────
  // Gemini extension 掃描（A1–A5）
  // ─────────────────────────────────────────────────────────────────

  describe("Gemini extension 掃描", () => {
    // 測試用 Gemini extensions 根目錄（每個 test 透過 env var 注入）
    let geminiExtRoot: string;
    // 每個 it 個別覆寫 GEMINI_EXTENSIONS_ROOT_OVERRIDE，afterEach 還原
    let restoreGeminiEnv: () => void = () => {};

    beforeEach(async () => {
      // 在 tmpHome 下建立 Gemini extensions 根目錄，每個 it 獨立
      geminiExtRoot = await mkdtemp(join(tmpHome, "gemini-ext-"));
      restoreGeminiEnv = overrideEnv({
        GEMINI_EXTENSIONS_ROOT_OVERRIDE: geminiExtRoot,
      });
    });

    afterEach(() => {
      restoreGeminiEnv();
    });

    /** 在 geminiExtRoot 下建立 extension 子目錄，並寫入 gemini-extension.json */
    async function writeGeminiExtensionManifest(
      extName: string,
      manifest: object,
    ): Promise<string> {
      const extDir = join(geminiExtRoot, extName);
      await mkdir(extDir, { recursive: true });
      await writeFile(
        join(extDir, "gemini-extension.json"),
        JSON.stringify(manifest),
      );
      return extDir;
    }

    // Gemini A1：兩個合法 extension 子目錄
    it("A1: 兩個合法 extension 子目錄應回傳兩筆，欄位映射正確", async () => {
      await writeGeminiExtensionManifest("context7", {
        name: "context7",
        version: "1.2.0",
        description: "Context7 extension",
      });
      await writeGeminiExtensionManifest("stock-deep-analyzer", {
        name: "stock-deep-analyzer",
        version: "0.5.1",
        description: "Stock analyzer",
      });

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins("gemini");

      expect(result).toHaveLength(2);

      const ids = result.map((p) => p.id);
      expect(ids).toContain("context7");
      expect(ids).toContain("stock-deep-analyzer");

      const ctx7 = result.find((p) => p.id === "context7")!;
      expect(ctx7.name).toBe("context7");
      expect(ctx7.version).toBe("1.2.0");
      expect(ctx7.description).toBe("Context7 extension");
      // installPath 應為 geminiExtRoot/context7/ 結尾
      expect(ctx7.installPath).toBe(join(geminiExtRoot, "context7") + "/");
      expect(ctx7.compatibleProviders).toEqual(["gemini"]);
      expect(ctx7.repo).toBe("");
    });

    // Gemini A2：子目錄缺 gemini-extension.json
    it("A2: 子目錄缺 gemini-extension.json 應跳過該子目錄", async () => {
      // 合法 extension
      await writeGeminiExtensionManifest("valid-ext", {
        name: "valid-ext",
        version: "1.0.0",
        description: "Valid",
      });
      // 缺 manifest 的子目錄（只建目錄，不寫 gemini-extension.json）
      await mkdir(join(geminiExtRoot, "no-manifest-ext"), { recursive: true });

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins("gemini");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid-ext");
    });

    // Gemini A3：extensions 目錄下有檔案（非目錄）應跳過
    it("A3: extensions 根目錄下的檔案（非目錄）應跳過，不嘗試讀取", async () => {
      // 一個合法 extension
      await writeGeminiExtensionManifest("real-ext", {
        name: "real-ext",
        version: "1.0.0",
        description: "Real extension",
      });
      // 一個檔案（非目錄），模擬 extension-enablement.json
      await writeFile(
        join(geminiExtRoot, "extension-enablement.json"),
        JSON.stringify({ enabled: ["real-ext"] }),
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins("gemini");

      // 只應回傳目錄形式的 extension，檔案應被略過
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("real-ext");
    });

    // Gemini A4：manifest JSON 解析失敗
    it("A4: manifest JSON 解析失敗應跳過該筆，其他正常 extension 仍回傳", async () => {
      // 合法 extension
      await writeGeminiExtensionManifest("good-ext", {
        name: "good-ext",
        version: "2.0.0",
        description: "Good extension",
      });
      // 損壞 JSON 的 extension
      const brokenDir = join(geminiExtRoot, "broken-ext");
      await mkdir(brokenDir, { recursive: true });
      await writeFile(
        join(brokenDir, "gemini-extension.json"),
        "not-valid-json{{{",
      );

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins("gemini");

      // 只應回傳合法的 extension
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("good-ext");
    });

    // Gemini A5：~/.gemini/extensions 目錄不存在
    it("A5: ~/.gemini/extensions 目錄不存在應回空陣列、不丟錯", async () => {
      // 覆寫為不存在的路徑
      restoreGeminiEnv();
      restoreGeminiEnv = overrideEnv({
        GEMINI_EXTENSIONS_ROOT_OVERRIDE: join(
          tmpHome,
          "nonexistent-gemini-root",
        ),
      });

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins("gemini");

      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // per-source Cache 行為（B1–B6）
  //
  // 實作說明：scanInstalledPlugins(provider?) 的實際行為是
  // 「掃描全部三個 source → 合併 → 以 compatibleProviders 過濾」，
  // 而非「provider 決定要掃哪個 source」。
  // 因此 Cache 測試以 per-source 隔離驗證，而非 per-provider 隔離。
  // ─────────────────────────────────────────────────────────────────

  describe("per-source Cache 行為", () => {
    let geminiExtRoot: string;
    let restoreGeminiEnv: () => void = () => {};

    beforeEach(async () => {
      geminiExtRoot = await mkdtemp(join(tmpHome, "gemini-cache-test-"));
      restoreGeminiEnv = overrideEnv({
        GEMINI_EXTENSIONS_ROOT_OVERRIDE: geminiExtRoot,
      });
    });

    afterEach(() => {
      restoreGeminiEnv();
    });

    /** 在 geminiExtRoot 下建立合法 extension */
    async function writeGeminiExt(
      extName: string,
      version = "1.0.0",
    ): Promise<void> {
      const extDir = join(geminiExtRoot, extName);
      await mkdir(extDir, { recursive: true });
      await writeFile(
        join(extDir, "gemini-extension.json"),
        JSON.stringify({ name: extName, version, description: extName }),
      );
    }

    // Cache B1：scanInstalledPlugins("claude") 不含 Gemini 專屬 plugin
    // 實作行為：掃全部 source（包含 Gemini）後以 compatibleProviders 過濾，
    // 因此 Gemini 路徑確實會被讀取，但 Gemini-only plugin 不會出現在 "claude" 結果中。
    it("B1: scanInstalledPlugins('claude') 結果不含 Gemini-only plugin（Gemini source 雖被讀取，但過濾後不在 claude 結果內）", async () => {
      // 建立 Gemini-only extension
      await writeGeminiExt("gemini-only-plugin");

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const claudeResult = scanInstalledPlugins("claude");

      // Gemini-only plugin 的 compatibleProviders 只有 gemini，不應出現在 claude 結果
      const hasGeminiOnly = claudeResult.some(
        (p) => p.id === "gemini-only-plugin",
      );
      expect(hasGeminiOnly).toBe(false);
    });

    // Cache B2：scanInstalledPlugins("gemini") 連續呼叫兩次，第二次走 per-source cache
    it("B2: scanInstalledPlugins('gemini') 連續呼叫兩次，Gemini source 第二次走 per-source cache（readdirSync 只被呼叫一次）", async () => {
      await writeGeminiExt("cached-ext");

      const { scanInstalledPlugins } = await reimportPluginScanner();

      // spy on fs.readdirSync 計算呼叫次數（針對 geminiExtRoot 的呼叫）
      const readdirSpy = vi.spyOn(fs, "readdirSync");

      const result1 = scanInstalledPlugins("gemini");
      const callCountAfterFirst = readdirSpy.mock.calls.filter(
        (args) => args[0] === geminiExtRoot,
      ).length;

      const result2 = scanInstalledPlugins("gemini");
      const callCountAfterSecond = readdirSpy.mock.calls.filter(
        (args) => args[0] === geminiExtRoot,
      ).length;

      // 第二次呼叫時 geminiExtRoot 的 readdirSync 次數不應增加（走 cache）
      expect(callCountAfterSecond).toBe(callCountAfterFirst);
      expect(result1).toEqual(result2);

      readdirSpy.mockRestore();
    });

    // Cache B3：Gemini cache 過期後重新掃描
    it("B3: Gemini cache 過期後（vi.useFakeTimers + advance 超過 30 秒）應重新讀取磁碟", async () => {
      await writeGeminiExt("initial-ext");

      vi.useFakeTimers();

      const { scanInstalledPlugins, clearScanInstalledPluginsCache } =
        await reimportPluginScanner();

      const result1 = scanInstalledPlugins("gemini");
      expect(result1).toHaveLength(1);
      expect(result1[0].id).toBe("initial-ext");

      // 在 cache 有效期內加入新 extension（但 cache 還沒過期，應看不到）
      const newExtDir = join(geminiExtRoot, "new-ext");
      await mkdir(newExtDir, { recursive: true });
      await writeFile(
        join(newExtDir, "gemini-extension.json"),
        JSON.stringify({
          name: "new-ext",
          version: "1.0.0",
          description: "new",
        }),
      );

      // 時間前進 31 秒，使 cache 過期
      vi.advanceTimersByTime(31000);

      const result2 = scanInstalledPlugins("gemini");
      // cache 過期後重新掃描，應看到新加入的 extension
      expect(result2).toHaveLength(2);
      const ids = result2.map((p) => p.id);
      expect(ids).toContain("initial-ext");
      expect(ids).toContain("new-ext");

      vi.useRealTimers();
      clearScanInstalledPluginsCache();
    });

    // Cache B4：Gemini cache 不影響 Claude / Codex 的 cache 狀態（per-source 獨立）
    it("B4: Gemini source 的 cache 與 Claude/Codex source 的 cache 互相獨立（per-source 隔離）", async () => {
      // 建立 Claude plugin
      const claudeInstallPath = join(
        claudeTestDir,
        "claude-plugin-b4",
        "1.0.0",
      );
      await mkdir(claudeInstallPath, { recursive: true });
      await writeClaudePluginManifest(
        claudeInstallPath,
        "Claude Plugin B4",
        "desc",
      );
      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "claude-plugin-b4@repo": [
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

      // 建立 Gemini extension
      await writeGeminiExt("gemini-plugin-b4");

      const { scanInstalledPlugins, clearScanInstalledPluginsCache } =
        await reimportPluginScanner();

      // 先掃 gemini，建立 Gemini source cache
      const geminiResult = scanInstalledPlugins("gemini");
      expect(geminiResult).toHaveLength(1);
      expect(geminiResult[0].id).toBe("gemini-plugin-b4");

      // 再掃 claude，結果應正確（Claude source cache 獨立）
      const claudeResult = scanInstalledPlugins("claude");
      expect(claudeResult.some((p) => p.id === "claude-plugin-b4@repo")).toBe(
        true,
      );
      // Gemini-only plugin 不應出現在 claude 結果
      expect(claudeResult.some((p) => p.id === "gemini-plugin-b4")).toBe(false);

      clearScanInstalledPluginsCache();
    });

    // Cache B5：scanInstalledPlugins() 不傳 provider → 三家結果合併（含 Gemini）
    it("B5: scanInstalledPlugins() 不傳 provider 時回傳三家來源合併結果（含 Gemini extension）", async () => {
      // 建立 Claude plugin
      const claudeInstallPath = join(
        claudeTestDir,
        "claude-plugin-b5",
        "1.0.0",
      );
      await mkdir(claudeInstallPath, { recursive: true });
      await writeClaudePluginManifest(
        claudeInstallPath,
        "Claude Plugin B5",
        "desc",
      );
      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "claude-plugin-b5@repo": [
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

      // 建立 Gemini extension
      await writeGeminiExt("gemini-plugin-b5");

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins();

      // 應同時包含 Claude plugin 和 Gemini extension
      const ids = result.map((p) => p.id);
      expect(ids).toContain("claude-plugin-b5@repo");
      expect(ids).toContain("gemini-plugin-b5");

      // Claude plugin 的 compatibleProviders 含 claude
      const claudePlugin = result.find(
        (p) => p.id === "claude-plugin-b5@repo",
      )!;
      expect(claudePlugin.compatibleProviders).toContain("claude");

      // Gemini extension 的 compatibleProviders 只有 gemini
      const geminiPlugin = result.find((p) => p.id === "gemini-plugin-b5")!;
      expect(geminiPlugin.compatibleProviders).toEqual(["gemini"]);
    });

    // Cache B6：未支援的 provider 仍回空陣列
    it("B6: 傳入未支援的 provider（任意字串）應回空陣列", async () => {
      // 建立 Gemini extension，確保非空環境下測試
      await writeGeminiExt("some-ext");

      const { scanInstalledPlugins } = await reimportPluginScanner();
      const result = scanInstalledPlugins("unknown-provider-xyz");

      expect(result).toEqual([]);
    });
  });

  describe("provider 過濾", () => {
    it("傳入 provider='claude' 時只回傳 Claude 來源安裝的 plugin", async () => {
      // Claude 來源：只有 .claude-plugin/plugin.json
      const claudePath = join(claudeTestDir, "claude-only", "1.0.0");
      await mkdir(claudePath, { recursive: true });
      await writeClaudePluginManifest(claudePath, "Claude Only", "Only claude");
      await writeFile(
        installedPluginsPath,
        makeInstalledPluginsJson({
          "claude-only@repo": [
            {
              scope: "user",
              installPath: claudePath,
              version: "1.0.0",
              installedAt: "",
              lastUpdated: "",
            },
          ],
        }),
      );

      // Codex 來源：只有 .codex-plugin/plugin.json，不應出現在 claude 結果
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
      expect(claudeResult[0].id).toBe("claude-only@repo");
      // Codex 來源的 plugin 不應出現在 claude 結果
      expect(claudeResult.some((p) => p.id === "codex-only@marketplace")).toBe(
        false,
      );

      clearScanInstalledPluginsCache();

      const codexResult = scanInstalledPlugins("codex");
      expect(codexResult).toHaveLength(1);
      expect(codexResult[0].id).toBe("codex-only@marketplace");
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
    it("同 id 的 plugin 兩邊都有時，mergePlugins 聯集 compatibleProviders（各自宣告自己的 provider）", async () => {
      // Claude 來源：installPath 在 tmpHome/.claude/plugins/ 下（通過安全驗證）
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

      // Codex 來源：installPath 在 codexCacheDir 內（tmpHome 下）
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

      // 同 id 兩邊都有時，mergePlugins 以 id 去重，compatibleProviders 取聯集
      // 這是合法情況：同 plugin 被 claude 和 codex 分別安裝，各自宣告自己的 provider
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("shared-plugin@shared-marketplace");
      expect(result[0].compatibleProviders).toContain("claude");
      expect(result[0].compatibleProviders).toContain("codex");
    });
  });

  describe("30 秒 TTL 快取", () => {
    it("短時間內重複呼叫應走快取，回傳相同結果", async () => {
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
