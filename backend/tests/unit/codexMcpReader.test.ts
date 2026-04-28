import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
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
// 注意：codexMcpReader 讀取路徑說明
//
// codexMcpReader 的 getCodexConfigPath() 優先讀取 process.env.CODEX_CONFIG_PATH，
// 若未設定則使用 path.join(os.homedir(), ".codex", "config.toml")。
// 本測試透過 CODEX_CONFIG_PATH 直接指向 tmp dir 內的測試檔案，
// 避免讀到真實使用者的 ~/.codex/config.toml。
// ─────────────────────────────────────────────

// 建立合法 TOML 字串的輔助函式

function makeStdioToml(name: string, command: string): string {
  return `[mcp_servers.${name}]\ncommand = "${command}"\n`;
}

function makeHttpToml(name: string, url: string): string {
  return `[mcp_servers.${name}]\nurl = "${url}"\n`;
}

function makeBothToml(
  stdioName: string,
  stdioCmd: string,
  httpName: string,
  httpUrl: string,
): string {
  return (
    `[mcp_servers.${stdioName}]\ncommand = "${stdioCmd}"\n\n` +
    `[mcp_servers.${httpName}]\nurl = "${httpUrl}"\n`
  );
}

describe("codexMcpReader", () => {
  let tmpHome: string;
  let codexConfigPath: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    // 建立獨立的 tmp HOME，避免污染真實使用者環境
    tmpHome = await createTmpDir("ccc-codex-mcp-test-");
    const codexDir = join(tmpHome, ".codex");
    await mkdir(codexDir, { recursive: true });
    codexConfigPath = join(codexDir, "config.toml");

    // 儲存並覆寫 CODEX_CONFIG_PATH，讓 codexMcpReader 讀取 tmp 內的測試檔
    restoreEnv = overrideEnv({ CODEX_CONFIG_PATH: codexConfigPath });
  });

  afterEach(async () => {
    restoreEnv();
    await cleanupTmpDir(tmpHome);
  });

  /**
   * 重新 import codexMcpReader（清除 module 快取），
   * 確保每個 it 都從乾淨的快取狀態開始。
   */
  async function reimportCodexMcpReader() {
    vi.resetModules();
    return import("../../src/services/mcp/codexMcpReader.js");
  }

  describe("讀取路徑驗證", () => {
    it("設定 CODEX_CONFIG_PATH 時，應讀取該路徑的檔案", async () => {
      // 在指定路徑寫入有效 TOML，驗證讀取的確是該路徑
      await writeFile(codexConfigPath, makeStdioToml("verify-server", "node"));
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("verify-server");
    });
  });

  describe("非 ENOENT 的讀取錯誤時", () => {
    it("路徑是目錄時應回傳空陣列、且 logger.warn 被呼叫", async () => {
      // 把 codexConfigPath 建為目錄，讓 readFileSync 因 EISDIR 拋錯（非 ENOENT）
      await mkdir(codexConfigPath, { recursive: true });

      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const { logger } = await import("../../src/utils/logger.js");

      const result = readCodexMcpServers();

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("~/.codex/config.toml 不存在時", () => {
    it("應回傳空陣列", async () => {
      // 不寫入任何 config.toml
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toEqual([]);
    });
  });

  describe("mcp_servers 區塊不存在時", () => {
    it("應回傳空陣列", async () => {
      // 有效 TOML 但無 mcp_servers 區塊
      await writeFile(codexConfigPath, '[model]\nname = "gpt-5.5"\n');
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toEqual([]);
    });
  });

  describe("TOML 解析失敗時", () => {
    it("無效 TOML 應回傳空陣列", async () => {
      // 故意給一個不合法的 TOML 字串
      await writeFile(codexConfigPath, "[[[[invalid toml content");
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toEqual([]);
    });
  });

  describe("stdio 類型（含 command）判斷", () => {
    it("含 command 欄位的 entry 應判斷為 stdio 類型", async () => {
      await writeFile(codexConfigPath, makeStdioToml("context7", "npx"));
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "context7", type: "stdio" });
    });

    it("含 command 欄位（同時有其他欄位）的 entry 應判斷為 stdio 類型", async () => {
      await writeFile(
        codexConfigPath,
        '[mcp_servers.my-server]\ncommand = "npx"\nargs = ["-y", "some-pkg"]\n',
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("stdio");
    });
  });

  describe("http 類型（含 url）判斷", () => {
    it("含 url 欄位的 entry 應判斷為 http 類型", async () => {
      await writeFile(
        codexConfigPath,
        makeHttpToml("figma", "https://mcp.figma.com/mcp"),
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "figma", type: "http" });
    });
  });

  describe("stdio 與 http 混合時", () => {
    it("應同時正確判斷兩種類型", async () => {
      await writeFile(
        codexConfigPath,
        makeBothToml("context7", "npx", "figma", "https://mcp.figma.com/mcp"),
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();

      expect(result).toHaveLength(2);
      const stdioEntry = result.find((s) => s.name === "context7");
      const httpEntry = result.find((s) => s.name === "figma");
      expect(stdioEntry?.type).toBe("stdio");
      expect(httpEntry?.type).toBe("http");
    });
  });

  describe("command 與 url 皆無時", () => {
    it("應靜默略過該 entry", async () => {
      await writeFile(
        codexConfigPath,
        "[mcp_servers.invalid]\nsome_other_field = true\n",
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toHaveLength(0);
    });
  });

  describe("server name 字元集驗證", () => {
    it("合法名稱（字母、數字、底線、連字號）應正常回傳", async () => {
      await writeFile(
        codexConfigPath,
        makeStdioToml("valid_server-123", "npx"),
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("valid_server-123");
    });

    it("含 = 號的 server name 應被略過，防止 CLI 旗標注入", async () => {
      await writeFile(
        codexConfigPath,
        '[mcp_servers."bad=name"]\ncommand = "npx"\n',
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toHaveLength(0);
    });

    it("含空格的 server name 應被略過", async () => {
      await writeFile(
        codexConfigPath,
        '[mcp_servers."bad name"]\ncommand = "npx"\n',
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toHaveLength(0);
    });

    it("含 -- 的 server name 應被略過，防止 CLI 旗標注入", async () => {
      await writeFile(
        codexConfigPath,
        '[mcp_servers."--inject"]\ncommand = "npx"\n',
      );
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();
      expect(result).toHaveLength(0);
    });

    it("含合法與不合法 name 混合時，只回傳合法的", async () => {
      const toml =
        '[mcp_servers.good]\ncommand = "npx"\n\n' +
        '[mcp_servers."bad=name"]\ncommand = "node"\n';
      await writeFile(codexConfigPath, toml);
      const { readCodexMcpServers } = await reimportCodexMcpReader();
      const result = readCodexMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("good");
    });
  });

  describe("5 秒 TTL 快取", () => {
    it("TTL 自然過期後應重新讀取磁碟", async () => {
      const BASE_TIME = 2000000;
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(BASE_TIME);

      await writeFile(codexConfigPath, makeStdioToml("first-server", "node"));
      const { readCodexMcpServers } = await reimportCodexMcpReader();

      // 第一次呼叫，建立快取
      const result1 = readCodexMcpServers();
      expect(result1[0].name).toBe("first-server");

      // 模擬時間推進超過 5 秒 TTL
      dateSpy.mockReturnValue(BASE_TIME + 5001);

      // 更新磁碟設定檔，模擬內容已變更
      await writeFile(
        codexConfigPath,
        makeHttpToml("updated-server", "https://example.com/mcp"),
      );

      // TTL 過期後應重新讀取
      const result2 = readCodexMcpServers();
      expect(result2[0].name).toBe("updated-server");
      expect(result2[0].type).toBe("http");

      dateSpy.mockRestore();
    });

    it("5 秒內重複呼叫應走快取，只讀一次磁碟", async () => {
      await writeFile(codexConfigPath, makeStdioToml("cached-server", "node"));
      const { readCodexMcpServers } = await reimportCodexMcpReader();

      // 第一次呼叫
      const result1 = readCodexMcpServers();
      // 第二次呼叫（快取內）
      const result2 = readCodexMcpServers();

      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("cached-server");
    });

    it("resetCodexMcpCache 後應重新讀取檔案", async () => {
      await writeFile(codexConfigPath, makeStdioToml("first-server", "node"));
      const { readCodexMcpServers, resetCodexMcpCache } =
        await reimportCodexMcpReader();

      const result1 = readCodexMcpServers();
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("first-server");

      // 清除快取並更新磁碟設定檔
      resetCodexMcpCache();
      await writeFile(
        codexConfigPath,
        makeHttpToml("updated-server", "https://example.com/mcp"),
      );

      const result2 = readCodexMcpServers();
      expect(result2).toHaveLength(1);
      expect(result2[0].name).toBe("updated-server");
      expect(result2[0].type).toBe("http");
    });
  });
});
