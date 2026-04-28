import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
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
// 注意：claudeMcpReader 讀取路徑說明
//
// claudeMcpReader 的 getClaudeJsonPath() 優先讀取 process.env.CLAUDE_JSON_PATH，
// 若未設定則使用 path.join(os.homedir(), ".claude.json")。
// 由於 Bun 的 os.homedir() 不受 process.env.HOME 動態改變影響，
// 本測試改用 CLAUDE_JSON_PATH 直接指向 tmp dir 內的測試檔案。
//
// 另外，readClaudeMcpServers 讀取 projects[homedir].mcpServers，
// 其中 homedir 是在呼叫時由 os.homedir() 取得的真實 home path。
// 因此 JSON 內的 key 必須使用真實的 os.homedir() 值。
// ─────────────────────────────────────────────

// 取得真實 homedir（Bun 不支援動態改變，用真實值作為 JSON key）
const REAL_HOMEDIR = homedir();

describe("claudeMcpReader", () => {
  let tmpHome: string;
  let claudeJsonPath: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    // 建立獨立的 tmp HOME，避免污染真實使用者環境
    tmpHome = await createTmpDir("ccc-claude-mcp-test-");
    claudeJsonPath = join(tmpHome, ".claude.json");

    // 儲存並覆寫 CLAUDE_JSON_PATH，讓 claudeMcpReader 讀取 tmp 內的測試檔
    restoreEnv = overrideEnv({ CLAUDE_JSON_PATH: claudeJsonPath });
  });

  afterEach(async () => {
    restoreEnv();
    await cleanupTmpDir(tmpHome);
  });

  /**
   * 重新 import claudeMcpReader（清除 module 快取），
   * 同時清除 module 內的快取狀態，確保每個 it 都能從乾淨狀態開始。
   */
  async function reimportClaudeMcpReader() {
    vi.resetModules();
    return import("../../src/services/mcp/claudeMcpReader.js");
  }

  /** 建立包含 projects[homedir].mcpServers 的 claude.json 內容 */
  function makeClaudeJson(mcpServers: Record<string, unknown>): string {
    return JSON.stringify({
      projects: {
        [REAL_HOMEDIR]: { mcpServers },
      },
    });
  }

  describe("檔案不存在時", () => {
    it("應回傳空陣列", async () => {
      // 不寫入任何 .claude.json
      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();
      expect(result).toEqual([]);
    });
  });

  describe("非 ENOENT 的讀取錯誤時", () => {
    it("目錄存在但路徑是目錄時應靜默回空陣列", async () => {
      // 把 claudeJsonPath 建為目錄，讓 readFileSync 因 EISDIR 拋錯
      await mkdir(claudeJsonPath, { recursive: true });
      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      expect(() => readClaudeMcpServers()).not.toThrow();
      const result = readClaudeMcpServers();
      expect(result).toEqual([]);
    });
  });

  describe("JSON parse 失敗時", () => {
    it("應回傳空陣列", async () => {
      await writeFile(claudeJsonPath, "this is not valid json{{{");
      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();
      expect(result).toEqual([]);
    });
  });

  describe("projects 欄位不存在時", () => {
    it("應回傳空陣列", async () => {
      await writeFile(
        claudeJsonPath,
        JSON.stringify({ someOtherKey: "value" }),
      );
      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();
      expect(result).toEqual([]);
    });

    it("projects 為 null 時應回傳空陣列", async () => {
      await writeFile(claudeJsonPath, JSON.stringify({ projects: null }));
      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();
      expect(result).toEqual([]);
    });
  });

  describe("user-scoped MCP server 解析（projects[homedir].mcpServers）", () => {
    it("應正確解析 command、args、env", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "my-server": {
            command: "npx",
            args: ["-y", "some-mcp-package"],
            env: { API_KEY: "secret" },
          },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "my-server",
        command: "npx",
        args: ["-y", "some-mcp-package"],
        env: { API_KEY: "secret" },
      });
    });

    it("args 缺失時應預設為空陣列", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({ "no-args-server": { command: "node" } }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual([]);
    });

    it("env 缺失時應預設為空物件", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "no-env-server": { command: "python3", args: ["server.py"] },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].env).toEqual({});
    });

    it("command 不是字串時應略過該 entry", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "invalid-command": { command: 123, args: [] },
          "valid-server": { command: "node", args: ["server.js"] },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("valid-server");
    });

    it("command 為空字串時應略過該 entry", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({ "empty-command": { command: "   ", args: [] } }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(0);
    });

    it("多個 server 應全部解析", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "server-a": { command: "node", args: ["a.js"], env: {} },
          "server-b": {
            command: "python3",
            args: ["b.py"],
            env: { FOO: "bar" },
          },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(2);
      const names = result.map((s) => s.name);
      expect(names).toContain("server-a");
      expect(names).toContain("server-b");
    });

    it("top-level mcpServers 不影響結果（只讀 projects[homedir].mcpServers）", async () => {
      // 驗證 bug fix：不應讀取 top-level mcpServers，而是讀 projects[homedir].mcpServers
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: {
            "top-level-server": { command: "node", args: [] },
          },
          projects: {
            [REAL_HOMEDIR]: {
              mcpServers: {
                "user-server": { command: "python3", args: [] },
              },
            },
          },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("user-server");
    });

    it("env 高風險 key（LD_*、DYLD_*、PATH）應被過濾", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "risky-server": {
            command: "node",
            args: [],
            env: {
              API_KEY: "safe",
              LD_PRELOAD: "/evil.so",
              DYLD_INSERT_LIBRARIES: "/evil.dylib",
              PATH: "/injected",
              SAFE_KEY: "ok",
            },
          },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();
      const result = readClaudeMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0].env).toEqual({ API_KEY: "safe", SAFE_KEY: "ok" });
      expect(result[0].env).not.toHaveProperty("LD_PRELOAD");
      expect(result[0].env).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
      expect(result[0].env).not.toHaveProperty("PATH");
    });
  });

  describe("5 秒 TTL 快取", () => {
    it("5 秒內重複呼叫應走快取，只讀一次磁碟", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "cached-server": { command: "node", args: [], env: {} },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();

      // 第一次呼叫
      const result1 = readClaudeMcpServers();
      // 第二次呼叫（快取內）
      const result2 = readClaudeMcpServers();

      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("cached-server");
    });

    it("TTL 自然過期後應重新讀取磁碟", async () => {
      const BASE_TIME = 1000000;
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(BASE_TIME);

      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "first-server": { command: "node", args: [], env: {} },
        }),
      );

      const { readClaudeMcpServers } = await reimportClaudeMcpReader();

      // 第一次呼叫，建立快取
      const result1 = readClaudeMcpServers();
      expect(result1[0].name).toBe("first-server");

      // 模擬時間推進超過 5 秒 TTL
      dateSpy.mockReturnValue(BASE_TIME + 5001);

      // 更新磁碟檔案，模擬內容已變更
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "updated-server": { command: "python3", args: [], env: {} },
        }),
      );

      // TTL 過期後應重新讀取
      const result2 = readClaudeMcpServers();
      expect(result2[0].name).toBe("updated-server");

      dateSpy.mockRestore();
    });

    it("resetClaudeMcpCache 後應重新讀取快取", async () => {
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "first-server": { command: "node", args: [], env: {} },
        }),
      );

      const { readClaudeMcpServers, resetClaudeMcpCache } =
        await reimportClaudeMcpReader();

      const result1 = readClaudeMcpServers();
      expect(result1).toHaveLength(1);
      expect(result1[0].name).toBe("first-server");

      // 清除快取並更新磁碟檔案
      resetClaudeMcpCache();
      await writeFile(
        claudeJsonPath,
        makeClaudeJson({
          "updated-server": { command: "python3", args: [], env: {} },
        }),
      );

      const result2 = readClaudeMcpServers();
      expect(result2).toHaveLength(1);
      expect(result2[0].name).toBe("updated-server");
    });
  });
});
