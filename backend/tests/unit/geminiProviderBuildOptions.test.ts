/**
 * geminiProvider.buildOptions() 單元測試
 *
 * 測試 plugins 計算邏輯（pod.pluginIds 與已安裝 Gemini extension 取交集）。
 *
 * Mock 邊界：
 * - 可以 mock：fs（透過 GEMINI_EXTENSIONS_ROOT_OVERRIDE env var 注入假目錄，不 spy ESM）
 * - 不可 mock：pluginScanner 內部 helper（readManifest、mergePlugins）
 * - 不可 mock：scanInstalledPlugins 本身（用真實實作 + 環境變數注入）
 * - 可以 mock：logger.warn（驗證呼叫次數）
 *
 * 所有測試均透過 reimport pattern 確保每次取得的 module 反映當前 process.env。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  createTmpDir,
  cleanupTmpDir,
  overrideEnv,
} from "../helpers/tmpDirHelper.js";
import type { Pod } from "../../src/types/pod.js";

// mock logger，避免測試時產生雜訊並可驗證呼叫次數
vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** 建立最小化 Pod stub，只設 pluginIds 和 providerConfig */
function makePod(pluginIds: string[], model = "gemini-2.5-flash"): Pod {
  return {
    id: "pod-bo-test-001",
    name: "Test Pod",
    provider: "gemini",
    status: "idle",
    providerConfig: { model },
    workspacePath: "/workspace/test",
    mcpServerNames: [],
    pluginIds,
    repositoryId: null,
    commandId: null,
    multiInstance: false,
    sessionId: null,
    x: 0,
    y: 0,
    rotation: 0,
  } as Pod;
}

// ─────────────────────────────────────────────
// 測試套件
// ─────────────────────────────────────────────

// B9：geminiProvider.metadata.defaultOptions.model 應為 "gemini-2.5-flash"
// 保護：確保 Gemini default model 為 Flash，connectionStore.create 預設模型才會正確
describe("geminiProvider.metadata — defaultOptions 回歸保護", () => {
  it("B9: geminiProvider.metadata.defaultOptions.model 必須為 gemini-2.5-flash", async () => {
    vi.resetModules();
    const { geminiProvider } =
      await import("../../src/services/provider/geminiProvider.js");
    const defaultModel = (
      geminiProvider.metadata.defaultOptions as { model?: string }
    ).model;
    expect(defaultModel).toBe("gemini-2.5-flash");
  });
});

describe("geminiProvider.buildOptions() – plugins 計算", () => {
  let tmpHome: string;
  let geminiExtRoot: string;
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    tmpHome = await createTmpDir("ccc-bo-test-");
    // 在 tmpHome 下建立 Gemini extensions 根目錄
    geminiExtRoot = await mkdtemp(join(tmpHome, "gemini-ext-"));
    restoreEnv = overrideEnv({
      GEMINI_EXTENSIONS_ROOT_OVERRIDE: geminiExtRoot,
      // 確保 Claude / Codex source 不讀到真實磁碟
      CLAUDE_PLUGINS_INSTALLED_PATH: join(
        tmpHome,
        "nonexistent-installed.json",
      ),
      CODEX_PLUGINS_CACHE_DIR: join(tmpHome, "nonexistent-codex-cache"),
    });
  });

  afterEach(async () => {
    restoreEnv();
    await cleanupTmpDir(tmpHome);
    vi.clearAllMocks();
  });

  /**
   * 清除 module cache 並重新 import geminiProvider。
   * 搭配 vi.resetModules() 確保 pluginScanner 的頂層 const 重新讀取 process.env，
   * 讓 GEMINI_EXTENSIONS_ROOT_OVERRIDE 生效。
   */
  async function reimportGeminiProvider() {
    vi.resetModules();
    return import("../../src/services/provider/geminiProvider.js");
  }

  /** 在 geminiExtRoot 下建立合法 extension 子目錄及 gemini-extension.json */
  async function writeGeminiExtension(
    id: string,
    version = "1.0.0",
    description = "",
  ): Promise<void> {
    const extDir = join(geminiExtRoot, id);
    await mkdir(extDir, { recursive: true });
    await writeFile(
      join(extDir, "gemini-extension.json"),
      JSON.stringify({ name: id, version, description }),
    );
  }

  // B1：pod.pluginIds 全部命中已安裝清單
  it("B1: pod.pluginIds 全部命中已安裝清單，options.plugins 包含全部 ID", async () => {
    await writeGeminiExtension("context7");
    await writeGeminiExtension("stock-deep-analyzer");

    const { geminiProvider } = await reimportGeminiProvider();
    const pod = makePod(["context7", "stock-deep-analyzer"]);
    const options = await geminiProvider.buildOptions(pod);

    expect(options.plugins).toHaveLength(2);
    expect(options.plugins).toContain("context7");
    expect(options.plugins).toContain("stock-deep-analyzer");
  });

  // B2：pod.pluginIds 含一個不存在的 ID → silent 過濾，logger.warn 一次
  it("B2: pod.pluginIds 含一個不存在的 ID 應 silent 過濾，options.plugins 只剩有效 ID，logger.warn 被呼叫一次", async () => {
    await writeGeminiExtension("context7");
    // "nonexistent-ext" 不建立目錄，模擬未安裝

    const { geminiProvider } = await reimportGeminiProvider();
    // 取得 mocked logger
    const { logger } = await import("../../src/utils/logger.js");

    const pod = makePod(["context7", "nonexistent-ext"]);
    const options = await geminiProvider.buildOptions(pod);

    // 只剩有效 ID
    expect(options.plugins).toEqual(["context7"]);
    // logger.warn 被呼叫一次（略過 1 個不存在的 extension）
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // warn 訊息應含「略過」和「1」
    const warnArgs = vi.mocked(logger.warn).mock.calls[0];
    const warnMsg = warnArgs.find(
      (arg): arg is string => typeof arg === "string" && arg.includes("略過"),
    );
    expect(warnMsg).toBeDefined();
    expect(warnMsg).toContain("1");
  });

  // B3：pod.pluginIds 為空陣列
  it("B3: pod.pluginIds 為空陣列，options.plugins = []，logger.warn 不被呼叫", async () => {
    await writeGeminiExtension("context7");

    const { geminiProvider } = await reimportGeminiProvider();
    const { logger } = await import("../../src/utils/logger.js");

    const pod = makePod([]);
    const options = await geminiProvider.buildOptions(pod);

    expect(options.plugins).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // B4：pod.pluginIds 含重複 ID → dedup 後寫入
  it("B4: pod.pluginIds 含重複 ID 應 dedup 後寫入 options.plugins", async () => {
    await writeGeminiExtension("context7");

    const { geminiProvider } = await reimportGeminiProvider();
    const { logger } = await import("../../src/utils/logger.js");

    // context7 重複兩次
    const pod = makePod(["context7", "context7"]);
    const options = await geminiProvider.buildOptions(pod);

    // dedup 後只剩一筆
    expect(options.plugins).toHaveLength(1);
    expect(options.plugins).toContain("context7");
    // 沒有略過任何 ID，logger.warn 不應被呼叫
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // B5：pod.pluginIds = ["a", "b"] 但 scanInstalledPlugins("gemini") 只有 a
  it("B5: pod.pluginIds = [a, b] 但安裝清單只有 a，結果為 [a]，warn 一次", async () => {
    await writeGeminiExtension("a");
    // "b" 不建立，模擬未安裝

    const { geminiProvider } = await reimportGeminiProvider();
    const { logger } = await import("../../src/utils/logger.js");

    const pod = makePod(["a", "b"]);
    const options = await geminiProvider.buildOptions(pod);

    expect(options.plugins).toEqual(["a"]);
    // 略過 1 個不存在的 extension id，warn 一次
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warnArgs = vi.mocked(logger.warn).mock.calls[0];
    const warnMsg = warnArgs.find(
      (arg): arg is string => typeof arg === "string" && arg.includes("略過"),
    );
    expect(warnMsg).toContain("1");
  });
});
