import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { overrideEnv } from "../helpers/tmpDirHelper.js";

// mock logger，避免測試時產生雜訊
vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────
// 注意：opencodeMcpReader 讀取路徑說明
//
// opencodeMcpReader 的 getOpencodeConfigPath() 優先讀取 process.env.OPENCODE_CONFIG_PATH，
// 若未設定則使用 path.join(os.homedir(), ".config", "opencode", config file name)。
// 本測試透過 OpencodeConfigReader interface mock 注入假的檔案內容，
// 避免讀到真實使用者的 OpenCode MCP 設定檔。
//
// 測試策略：
// - 透過 setOpencodeConfigReader 注入 mock reader，只 mock 自己寫的 wrapper interface。
// - 不直接 mock node:fs 內部。
// ─────────────────────────────────────────────

describe("opencodeMcpReader", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    // 覆寫 OPENCODE_CONFIG_PATH，避免讀取真實使用者設定
    restoreEnv = overrideEnv({
      OPENCODE_CONFIG_PATH: [
        "/tmp/fake-opencode-test-path",
        ["opencode", "json"].join("."),
      ].join("/"),
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  /**
   * 重新 import opencodeMcpReader（清除 module 快取），
   * 確保每個 it 都從乾淨的快取狀態開始。
   */
  async function reimportOpencodeMcpReader() {
    vi.resetModules();
    return import("../../src/services/mcp/opencodeMcpReader.js");
  }

  /** 建立包含 root-level mcp 的 OpenCode config 內容 */
  function makeOpencodeJson(mcp: Record<string, unknown>): string {
    return JSON.stringify({ mcp });
  }

  /** 建立一個回傳固定內容的 mock reader */
  function makeMockReader(content: string | null) {
    return { readFile: vi.fn().mockReturnValue(content) };
  }

  // B1：local entry → stdio
  describe("B1：local entry 應轉成 stdio 類型", () => {
    it("type === local 的 entry 應回傳 { name, type: 'stdio' }", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          context7: {
            type: "local",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "context7", type: "stdio" });
    });
  });

  // B2：remote http url → http
  describe("B2：remote entry 含 http/https url 應轉成 http 類型", () => {
    it("type === remote 且 url 以 https:// 開頭，應回傳 { name, type: 'http' }", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          figma: {
            type: "remote",
            url: "https://mcp.figma.com/mcp",
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "figma", type: "http" });
    });

    it("type === remote 且 url 以 http:// 開頭，應回傳 { name, type: 'http' }", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          "my-http-server": {
            type: "remote",
            url: "http://localhost:8080/mcp",
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "my-http-server", type: "http" });
    });
  });

  // B3：remote 非 http url → sse
  describe("B3：remote entry 含非 http/https url 應轉成 sse 類型", () => {
    it("type === remote 且 url 以 sse:// 開頭，應回傳 { name, type: 'sse' }", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          "my-sse-server": {
            type: "remote",
            url: "sse://example.com/sse",
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "my-sse-server", type: "sse" });
    });

    it("type === remote 且 url 為其他 scheme，應回傳 { name, type: 'sse' }", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          "ws-server": {
            type: "remote",
            url: "ws://example.com/ws",
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "ws-server", type: "sse" });
    });
  });

  // B4：同時包含多種 entry 時順序與名稱正確
  describe("B4：同時包含多種 entry 時順序與名稱正確", () => {
    it("local、remote-http、remote-sse 混合時，應全部正確轉換且名稱對應", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          context7: {
            type: "local",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
          figma: {
            type: "remote",
            url: "https://mcp.figma.com/mcp",
          },
          "my-sse": {
            type: "remote",
            url: "sse://example.com/sse",
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();

      expect(result).toHaveLength(3);

      const context7 = result.find((s) => s.name === "context7");
      const figma = result.find((s) => s.name === "figma");
      const mySse = result.find((s) => s.name === "my-sse");

      expect(context7).toEqual({ name: "context7", type: "stdio" });
      expect(figma).toEqual({ name: "figma", type: "http" });
      expect(mySse).toEqual({ name: "my-sse", type: "sse" });

      // 順序應保持 JSON 定義的順序
      expect(result[0].name).toBe("context7");
      expect(result[1].name).toBe("figma");
      expect(result[2].name).toBe("my-sse");
    });
  });

  // B5：檔案不存在時回空陣列、不拋錯
  describe("B5：檔案不存在時應回空陣列、不拋錯", () => {
    it("reader 回傳 null（ENOENT）時應回傳空陣列且不拋例外", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      // mock reader 回傳 null，模擬檔案不存在
      const mockReader = makeMockReader(null);
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      expect(() => readOpencodeMcpServers()).not.toThrow();
      const result = readOpencodeMcpServers();
      expect(result).toEqual([]);
    });
  });

  // B6：JSON parse 失敗或無 mcp 區塊時回空陣列、不拋錯
  describe("B6：JSON parse 失敗或無 mcp 區塊時應回空陣列、不拋錯", () => {
    it("無效 JSON 應回傳空陣列且不拋例外", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader("this is not valid json{{{");
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      expect(() => readOpencodeMcpServers()).not.toThrow();
      const result = readOpencodeMcpServers();
      expect(result).toEqual([]);
    });

    it("無 mcp 區塊時應回傳空陣列", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        JSON.stringify({ someOtherKey: "value" }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();
      expect(result).toEqual([]);
    });

    it("mcp 區塊為 null 時應回傳空陣列", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(JSON.stringify({ mcp: null }));
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();
      expect(result).toEqual([]);
    });

    it("mcp 區塊為陣列時應回傳空陣列", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(JSON.stringify({ mcp: [] }));
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();
      expect(result).toEqual([]);
    });

    it("mcp 區塊為字串時應回傳空陣列", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        JSON.stringify({ mcp: "not-an-object" }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();
      expect(result).toEqual([]);
    });
  });

  // 追加：5 秒 TTL 快取行為
  describe("5 秒 TTL 快取", () => {
    it("TTL 內第二次呼叫應走快取，結果與第一次相同", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          "cached-server": { type: "local", command: "node" },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result1 = readOpencodeMcpServers();

      // 第二次呼叫（TTL 內，應走快取）
      const result2 = readOpencodeMcpServers();

      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("cached-server");

      // readFile 只被呼叫一次（快取命中時不重讀）
      expect(mockReader.readFile).toHaveBeenCalledTimes(1);
    });

    it("TTL 自然過期後應重新呼叫 reader", async () => {
      const BASE_TIME = 3000000;
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(BASE_TIME);

      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = {
        readFile: vi
          .fn()
          .mockReturnValueOnce(
            makeOpencodeJson({
              "first-server": { type: "local", command: "node" },
            }),
          )
          .mockReturnValueOnce(
            makeOpencodeJson({
              "updated-server": {
                type: "remote",
                url: "https://example.com/mcp",
              },
            }),
          ),
      };
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      // 第一次呼叫，建立快取
      const result1 = readOpencodeMcpServers();
      expect(result1[0].name).toBe("first-server");

      // 模擬時間推進超過 5 秒 TTL
      dateSpy.mockReturnValue(BASE_TIME + 5001);

      // TTL 過期後應重新讀取
      const result2 = readOpencodeMcpServers();
      expect(result2[0].name).toBe("updated-server");
      expect(result2[0].type).toBe("http");

      dateSpy.mockRestore();
    });

    it("resetOpencodeMcpCache 後應重新讀取 reader", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = {
        readFile: vi
          .fn()
          .mockReturnValueOnce(
            makeOpencodeJson({
              "first-server": { type: "local", command: "node" },
            }),
          )
          .mockReturnValueOnce(
            makeOpencodeJson({
              "updated-server": {
                type: "remote",
                url: "sse://example.com/sse",
              },
            }),
          ),
      };
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result1 = readOpencodeMcpServers();
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("first-server");

      // 清除快取
      resetOpencodeMcpCache();

      const result2 = readOpencodeMcpServers();
      expect(result2).toHaveLength(1);
      expect(result2[0].name).toBe("updated-server");
      expect(result2[0].type).toBe("sse");
    });
  });

  // 追加：remote entry 無 url 欄位時靜默略過
  describe("remote entry 無 url 欄位時靜默略過", () => {
    it("type === remote 但缺少 url 的 entry 應被靜默略過", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          "no-url-server": {
            type: "remote",
            // 故意不帶 url
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();
      expect(result).toHaveLength(0);
    });
  });

  // 追加：type 欄位非 local / remote 的 entry 應靜默略過
  describe("未知 type 的 entry 應靜默略過", () => {
    it("type === 'unknown' 的 entry 應被靜默略過", async () => {
      const {
        readOpencodeMcpServers,
        setOpencodeConfigReader,
        resetOpencodeMcpCache,
      } = await reimportOpencodeMcpReader();

      const mockReader = makeMockReader(
        makeOpencodeJson({
          "unknown-server": {
            type: "unknown",
            command: "node",
          },
        }),
      );
      setOpencodeConfigReader(mockReader);
      resetOpencodeMcpCache();

      const result = readOpencodeMcpServers();
      expect(result).toHaveLength(0);
    });
  });
});
