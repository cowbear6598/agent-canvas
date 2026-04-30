import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
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
// 注意：geminiMcpReader 讀取路徑說明
//
// geminiMcpReader 的 getGeminiSettingsPath() 優先讀取 process.env.GEMINI_SETTINGS_PATH，
// 若未設定則使用 path.join(os.homedir(), ".gemini", "settings.json")。
// 本測試透過 GEMINI_SETTINGS_PATH 直接指向 tmp dir 內的測試檔案，
// 避免讀到真實使用者的 ~/.gemini/settings.json。
//
// 另外，geminiMcpReader 讀取 root-level mcpServers（不同於 claudeMcpReader
// 的 projects[homedir].mcpServers），因此 JSON 結構較單純。
// ─────────────────────────────────────────────

describe("geminiMcpReader", () => {
  let tmpHome: string;
  let settingsPath: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    // 建立獨立的 tmp HOME，避免污染真實使用者環境
    tmpHome = await createTmpDir("ccc-gemini-mcp-test-");
    settingsPath = join(tmpHome, "settings.json");

    // 儲存並覆寫 GEMINI_SETTINGS_PATH，讓 geminiMcpReader 讀取 tmp 內的測試檔
    restoreEnv = overrideEnv({ GEMINI_SETTINGS_PATH: settingsPath });
  });

  afterEach(async () => {
    restoreEnv();
    await cleanupTmpDir(tmpHome);
  });

  /**
   * 重新 import geminiMcpReader（清除 module 快取），
   * 確保每個 it 都從乾淨的快取狀態開始。
   */
  async function reimportGeminiMcpReader() {
    vi.resetModules();
    return import("../../src/services/mcp/geminiMcpReader.js");
  }

  /** 建立包含 root-level mcpServers 的 settings.json 內容 */
  function makeSettingsJson(mcpServers: Record<string, unknown>): string {
    return JSON.stringify({ mcpServers });
  }

  // B1：settings.json 存在且 mcpServers 含 stdio（command）→ 回傳 { name, type: "stdio" }
  describe("B1：stdio 類型（含 command）", () => {
    it("含 command 欄位的 entry 應判斷為 stdio 類型", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          context7: {
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "context7", type: "stdio" });
    });
  });

  // B2：settings.json 含 http（httpUrl）→ 回傳 { name, type: "http" }
  describe("B2：http 類型（含 httpUrl）", () => {
    it("含 httpUrl 欄位的 entry 應判斷為 http 類型", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          figma: {
            httpUrl: "https://mcp.figma.com/mcp",
          },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "figma", type: "http" });
    });
  });

  // B3：settings.json 含 sse（url，無 command 與 httpUrl）→ 回傳 { name, type: "sse" }
  describe("B3：sse 類型（含 url，無 command 與 httpUrl）", () => {
    it("含 url 欄位（且無 command/httpUrl）的 entry 應判斷為 sse 類型", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "my-sse-server": {
            url: "https://example.com/sse",
          },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "my-sse-server", type: "sse" });
    });
  });

  // B4：同一 entry 同時帶 command 與 httpUrl → command 優先（stdio）
  describe("B4：command 與 httpUrl 並存時，command 優先（stdio）", () => {
    it("同時有 command 與 httpUrl 時應優先判斷為 stdio 類型", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "mixed-server": {
            command: "npx",
            httpUrl: "https://example.com/mcp",
          },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "mixed-server", type: "stdio" });
    });
  });

  // B5：server 名稱含不合法字元 → 略過並 logger.warn（log 只放長度）
  describe("B5：不合法 server 名稱應被略過，logger.warn 被呼叫", () => {
    it("含空格的名稱應被略過", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "bad name": { command: "npx" },
          "good-server": { command: "node" },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const { logger } = await import("../../src/utils/logger.js");

      const result = readGeminiMcpServers();

      // 只回傳合法的 entry
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("good-server");

      // logger.warn 應被呼叫
      expect(logger.warn).toHaveBeenCalled();
    });

    it("以 -- 開頭的名稱應被略過", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "--inject": { command: "npx" },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const { logger } = await import("../../src/utils/logger.js");

      const result = readGeminiMcpServers();

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("含 = 號的名稱應被略過", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "bad=name": { command: "npx" },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const { logger } = await import("../../src/utils/logger.js");

      const result = readGeminiMcpServers();

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("logger.warn 訊息不洩漏完整名稱，只包含長度資訊", async () => {
      const illegalName = "bad=name";
      await writeFile(
        settingsPath,
        makeSettingsJson({
          [illegalName]: { command: "npx" },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const { logger } = await import("../../src/utils/logger.js");

      readGeminiMcpServers();

      // warn 應含長度資訊
      expect(logger.warn).toHaveBeenCalledWith(
        "McpServer",
        "Warn",
        expect.stringContaining(`${illegalName.length}`),
      );

      // warn 訊息不應包含完整的不合法名稱
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const warnMessages = warnCalls.map((args) => args.join(" "));
      warnMessages.forEach((msg) => {
        expect(msg).not.toContain(illegalName);
      });
    });
  });

  // B6：server 名稱含 _ → 仍保留並回傳（系統不在 reader 端攔截）
  describe("B6：含底線（_）的名稱應保留（reader 不攔截 Gemini policy 限制）", () => {
    it("含底線的合法名稱應正常回傳", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          my_server: { command: "node" },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("my_server");
      expect(result[0].type).toBe("stdio");
    });
  });

  // B7：settings.json 不存在 → 回傳 []（不拋例外）
  describe("B7：settings.json 不存在時", () => {
    it("應回傳空陣列，且不拋例外", async () => {
      // 不寫入任何 settings.json
      const { readGeminiMcpServers } = await reimportGeminiMcpReader();

      expect(() => readGeminiMcpServers()).not.toThrow();
      const result = readGeminiMcpServers();
      expect(result).toEqual([]);
    });
  });

  // B8：JSON 解析失敗 → 回傳 []（不拋例外）
  describe("B8：JSON 解析失敗時", () => {
    it("應回傳空陣列，且不拋例外", async () => {
      await writeFile(settingsPath, "this is not valid json{{{");

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();

      expect(() => readGeminiMcpServers()).not.toThrow();
      const result = readGeminiMcpServers();
      expect(result).toEqual([]);
    });
  });

  // B9：mcpServers 不是物件 / 缺欄位 → 回傳 []
  describe("B9：mcpServers 欄位缺失或格式錯誤時", () => {
    it("mcpServers 缺失時應回傳空陣列", async () => {
      await writeFile(settingsPath, JSON.stringify({ someOtherKey: "value" }));

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();
      expect(result).toEqual([]);
    });

    it("mcpServers 為 null 時應回傳空陣列", async () => {
      await writeFile(settingsPath, JSON.stringify({ mcpServers: null }));

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();
      expect(result).toEqual([]);
    });

    it("mcpServers 為陣列時應回傳空陣列", async () => {
      await writeFile(settingsPath, JSON.stringify({ mcpServers: [] }));

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();
      expect(result).toEqual([]);
    });

    it("mcpServers 為字串時應回傳空陣列", async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({ mcpServers: "not-an-object" }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();
      const result = readGeminiMcpServers();
      expect(result).toEqual([]);
    });
  });

  // B10：5 秒 TTL 快取命中：第一次呼叫後立即第二次呼叫，只觸發一次讀檔
  describe("B10：5 秒 TTL 快取命中", () => {
    it("TTL 內第二次呼叫應走快取，結果與第一次相同", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "cached-server": { command: "node" },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();

      // 第一次呼叫（建立快取）
      const result1 = readGeminiMcpServers();

      // 更新磁碟檔案（TTL 內應不影響結果）
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "new-server": { command: "python3" },
        }),
      );

      // 第二次呼叫（應走快取，仍回傳 cached-server）
      const result2 = readGeminiMcpServers();

      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("cached-server");
    });

    it("TTL 自然過期後應重新讀取磁碟", async () => {
      const BASE_TIME = 3000000;
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(BASE_TIME);

      await writeFile(
        settingsPath,
        makeSettingsJson({
          "first-server": { command: "node" },
        }),
      );

      const { readGeminiMcpServers } = await reimportGeminiMcpReader();

      // 第一次呼叫，建立快取
      const result1 = readGeminiMcpServers();
      expect(result1[0].name).toBe("first-server");

      // 模擬時間推進超過 5 秒 TTL
      dateSpy.mockReturnValue(BASE_TIME + 5001);

      // 更新磁碟檔案，模擬內容已變更
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "updated-server": { httpUrl: "https://example.com/mcp" },
        }),
      );

      // TTL 過期後應重新讀取
      const result2 = readGeminiMcpServers();
      expect(result2[0].name).toBe("updated-server");
      expect(result2[0].type).toBe("http");

      dateSpy.mockRestore();
    });
  });

  // B11：resetGeminiMcpCache() 後重讀，能反映 fixture 變更
  describe("B11：resetGeminiMcpCache 後應重新讀取檔案", () => {
    it("呼叫 resetGeminiMcpCache 後再讀取，應反映最新的磁碟內容", async () => {
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "first-server": { command: "node" },
        }),
      );

      const { readGeminiMcpServers, resetGeminiMcpCache } =
        await reimportGeminiMcpReader();

      const result1 = readGeminiMcpServers();
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("first-server");

      // 清除快取並更新磁碟設定檔
      resetGeminiMcpCache();
      await writeFile(
        settingsPath,
        makeSettingsJson({
          "updated-server": { url: "https://example.com/sse" },
        }),
      );

      const result2 = readGeminiMcpServers();
      expect(result2).toHaveLength(1);
      expect(result2[0].name).toBe("updated-server");
      expect(result2[0].type).toBe("sse");
    });
  });
});
