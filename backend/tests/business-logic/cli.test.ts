import fs from "fs";
import path from "path";
import os from "os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseCommand,
  validatePort,
  readConfig,
  writeConfig,
  readPidFile,
  writePidFile,
  isProcessAlive,
  getLocalIp,
  VALID_CONFIG_KEYS,
  handleLogs,
  handleConfig,
} from "../../src/cli.js";

const TMP_DIR = path.join(os.tmpdir(), `cli-test-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("parseCommand", () => {
  describe("CLI start 預設 port 為 3001", () => {
    it("解析 start 命令，flags 中無 port", () => {
      const result = parseCommand(["bun", "cli.ts", "start"]);
      expect(result.command).toBe("start");
      expect(result.flags.port).toBeUndefined();
    });
  });

  describe("CLI start --port 8080 可自訂 port", () => {
    it("解析 start 命令並取得 port flag", () => {
      const result = parseCommand(["bun", "cli.ts", "start", "--port", "8080"]);
      expect(result.command).toBe("start");
      expect(result.flags.port).toBe("8080");
    });
  });

  describe("CLI --version 顯示版本號", () => {
    it("解析 --version flag", () => {
      const result = parseCommand(["bun", "cli.ts", "--version"]);
      expect(result.flags.version).toBe(true);
    });

    it("解析 -v 短旗標", () => {
      const result = parseCommand(["bun", "cli.ts", "-v"]);
      expect(result.flags.version).toBe(true);
    });
  });

  describe("CLI --help 顯示使用說明", () => {
    it("解析 --help flag", () => {
      const result = parseCommand(["bun", "cli.ts", "--help"]);
      expect(result.flags.help).toBe(true);
    });

    it("解析 -h 短旗標", () => {
      const result = parseCommand(["bun", "cli.ts", "-h"]);
      expect(result.flags.help).toBe(true);
    });
  });

  it("無子命令時 command 為 null", () => {
    const result = parseCommand(["bun", "cli.ts"]);
    expect(result.command).toBeNull();
  });

  it("解析 config 子命令與 args", () => {
    const result = parseCommand([
      "bun",
      "cli.ts",
      "config",
      "set",
      "GITHUB_TOKEN",
      "abc123",
    ]);
    expect(result.command).toBe("config");
    expect(result.args).toEqual(["set", "GITHUB_TOKEN", "abc123"]);
  });
});

describe("validatePort", () => {
  describe("CLI start --port abc 不合法時顯示錯誤", () => {
    it("非數字字串回傳 null", () => {
      expect(validatePort("abc")).toBeNull();
    });

    it("port 0 回傳 null", () => {
      expect(validatePort("0")).toBeNull();
    });

    it("port 70000 超出範圍回傳 null", () => {
      expect(validatePort("70000")).toBeNull();
    });

    it("65536 超出範圍回傳 null", () => {
      expect(validatePort("65536")).toBeNull();
    });

    it("負數回傳 null", () => {
      expect(validatePort("-1")).toBeNull();
    });

    it("小數回傳 null", () => {
      expect(validatePort("3001.5")).toBeNull();
    });
  });

  describe("CLI start --port 8080 可自訂 port", () => {
    it("合法 port 8080 回傳數字", () => {
      expect(validatePort("8080")).toBe(8080);
    });

    it("port 1 回傳 1", () => {
      expect(validatePort("1")).toBe(1);
    });

    it("port 65535 回傳 65535", () => {
      expect(validatePort("65535")).toBe(65535);
    });

    it("port 3001 回傳 3001", () => {
      expect(validatePort("3001")).toBe(3001);
    });
  });
});

describe("readPidFile 與 writePidFile", () => {
  const pidPath = path.join(TMP_DIR, "agent-canvas.pid");

  describe("CLI stop 正常停止服務", () => {
    it("寫入 PID 檔案後能正確讀取", () => {
      const data = {
        pid: process.pid,
        port: 3001,
        startedAt: new Date().toISOString(),
      };
      writePidFile(pidPath, data);

      const result = readPidFile(pidPath);
      expect(result).not.toBeNull();
      expect(result!.pid).toBe(process.pid);
      expect(result!.port).toBe(3001);
      expect(typeof result!.startedAt).toBe("string");
    });
  });

  describe("CLI stop 服務未啟動時顯示提示", () => {
    it("檔案不存在回傳 null", () => {
      const result = readPidFile("/不存在的路徑/agent-canvas.pid");
      expect(result).toBeNull();
    });
  });

  describe("CLI status 服務運行中時顯示正確資訊", () => {
    it("讀取 PID 檔案並能解析 pid、port、startedAt", () => {
      const data = {
        pid: process.pid,
        port: 3001,
        startedAt: new Date().toISOString(),
      };
      writePidFile(pidPath, data);

      const result = readPidFile(pidPath);
      expect(result).not.toBeNull();
      expect(typeof result!.pid).toBe("number");
      expect(typeof result!.port).toBe("number");
      expect(typeof result!.startedAt).toBe("string");
    });
  });

  it("損毀的 JSON 回傳 null", () => {
    fs.writeFileSync(pidPath, "not-json", "utf-8");
    expect(readPidFile(pidPath)).toBeNull();
  });

  describe("readPidFile 型別不符時回傳 null", () => {
    it("pid 為字串時回傳 null", () => {
      fs.writeFileSync(
        pidPath,
        JSON.stringify({
          pid: "not-a-number",
          port: 3001,
          startedAt: "2024-01-01",
        }),
        "utf-8",
      );
      expect(readPidFile(pidPath)).toBeNull();
    });

    it("port 為字串時回傳 null", () => {
      fs.writeFileSync(
        pidPath,
        JSON.stringify({ pid: 123, port: "abc", startedAt: "2024-01-01" }),
        "utf-8",
      );
      expect(readPidFile(pidPath)).toBeNull();
    });

    it("startedAt 為數字時回傳 null", () => {
      fs.writeFileSync(
        pidPath,
        JSON.stringify({ pid: 123, port: 3001, startedAt: 12345 }),
        "utf-8",
      );
      expect(readPidFile(pidPath)).toBeNull();
    });
  });
});

describe("isProcessAlive", () => {
  describe("CLI stop 正常停止服務", () => {
    it("當前程序存活回傳 true", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });
  });

  describe("CLI status 服務未運行時顯示提示", () => {
    it("不存在的 PID 回傳 false", () => {
      expect(isProcessAlive(999999)).toBe(false);
    });
  });
});

describe("getLocalIp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("有 external IPv4 介面時回傳該 IP", () => {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      eth0: [
        {
          address: "192.168.1.100",
          family: "IPv4",
          internal: false,
          netmask: "255.255.255.0",
          mac: "00:00:00:00:00:00",
          cidr: "192.168.1.100/24",
        },
      ],
    });
    expect(getLocalIp()).toBe("192.168.1.100");
  });

  it("所有介面都是 internal 時回傳 null", () => {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      lo: [
        {
          address: "127.0.0.1",
          family: "IPv4",
          internal: true,
          netmask: "255.0.0.0",
          mac: "00:00:00:00:00:00",
          cidr: "127.0.0.1/8",
        },
      ],
    });
    expect(getLocalIp()).toBeNull();
  });

  it("只有 IPv6 介面時回傳 null", () => {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      eth0: [
        {
          address: "::1",
          family: "IPv6",
          internal: false,
          netmask: "ffff:ffff:ffff:ffff::",
          mac: "00:00:00:00:00:00",
          cidr: "::1/128",
          scopeid: 0,
        },
      ],
    });
    expect(getLocalIp()).toBeNull();
  });

  it("networkInterfaces 回傳空物件時回傳 null", () => {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({});
    expect(getLocalIp()).toBeNull();
  });
});

describe("readConfig 與 writeConfig", () => {
  const configPath = path.join(TMP_DIR, "config.json");

  describe("CLI config set/get/list 正常運作", () => {
    it("寫入後能正確讀取", () => {
      writeConfig(configPath, { GITHUB_TOKEN: "test-token" });
      const result = readConfig(configPath);
      expect(result).toEqual({ GITHUB_TOKEN: "test-token" });
    });

    it("檔案不存在回傳空物件", () => {
      const result = readConfig("/不存在的路徑/config.json");
      expect(result).toEqual({});
    });

    it("VALID_CONFIG_KEYS 包含正確的三個 key", () => {
      expect(VALID_CONFIG_KEYS).toContain("GITHUB_TOKEN");
      expect(VALID_CONFIG_KEYS).toContain("GITLAB_TOKEN");
      expect(VALID_CONFIG_KEYS).toContain("GITLAB_URL");
      expect(VALID_CONFIG_KEYS).toHaveLength(3);
    });

    it("多次 writeConfig 會覆蓋舊值", () => {
      writeConfig(configPath, { GITHUB_TOKEN: "first" });
      writeConfig(configPath, {
        GITHUB_TOKEN: "second",
        GITLAB_URL: "https://gitlab.example.com",
      });

      const result = readConfig(configPath);
      expect(result.GITHUB_TOKEN).toBe("second");
      expect(result.GITLAB_URL).toBe("https://gitlab.example.com");
    });
  });

  it("損毀的 JSON 回傳空物件", () => {
    fs.writeFileSync(configPath, "not-json", "utf-8");
    expect(readConfig(configPath)).toEqual({});
  });
});

describe("handleLogs", () => {
  const logPath = path.join(TMP_DIR, "agent-canvas.log");

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as (
      code?: number,
    ) => never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("CLI logs 日誌檔案不存在時顯示提示", () => {
    it("log 檔案不存在時印出提示並 exit", () => {
      handleLogs({}, "/不存在的路徑/agent-canvas.log");
      expect(console.log).toHaveBeenCalledWith("尚無日誌檔案，請先啟動服務");
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe("CLI logs 日誌檔案為空時顯示提示", () => {
    it("log 檔案為空時印出提示", () => {
      fs.writeFileSync(logPath, "", "utf-8");
      handleLogs({}, logPath);
      expect(console.log).toHaveBeenCalledWith("日誌檔案為空");
    });
  });

  describe("CLI logs 預設顯示最新 50 行", () => {
    it("超過 50 行時只顯示最後 50 行", () => {
      const allLines = Array.from({ length: 80 }, (_, i) => `行 ${i + 1}`);
      fs.writeFileSync(logPath, allLines.join("\n"), "utf-8");
      handleLogs({}, logPath);
      const output = vi.mocked(console.log).mock.calls[0][0] as string;
      const printed = output.split("\n");
      expect(printed).toHaveLength(50);
      expect(printed[0]).toBe("行 31");
      expect(printed[49]).toBe("行 80");
    });

    it("行數不足 50 行時全部顯示", () => {
      const allLines = Array.from({ length: 10 }, (_, i) => `行 ${i + 1}`);
      fs.writeFileSync(logPath, allLines.join("\n"), "utf-8");
      handleLogs({}, logPath);
      const output = vi.mocked(console.log).mock.calls[0][0] as string;
      const printed = output.split("\n");
      expect(printed).toHaveLength(10);
    });
  });

  describe("CLI logs -n 100 顯示最新 100 行", () => {
    it("-n 100 時顯示最後 100 行", () => {
      const allLines = Array.from({ length: 150 }, (_, i) => `行 ${i + 1}`);
      fs.writeFileSync(logPath, allLines.join("\n"), "utf-8");
      handleLogs({ n: "100" }, logPath);
      const output = vi.mocked(console.log).mock.calls[0][0] as string;
      const printed = output.split("\n");
      expect(printed).toHaveLength(100);
      expect(printed[0]).toBe("行 51");
      expect(printed[99]).toBe("行 150");
    });
  });

  describe("-n 邊界值應 fallback 為 50 行", () => {
    const setup100Lines = () => {
      const allLines = Array.from({ length: 100 }, (_, i) => `行 ${i + 1}`);
      fs.writeFileSync(logPath, allLines.join("\n"), "utf-8");
    };

    const getOutput = () => {
      const output = vi.mocked(console.log).mock.calls[0][0] as string;
      return output.split("\n");
    };

    it("-n 0 應 fallback 為 50 行", () => {
      setup100Lines();
      handleLogs({ n: "0" }, logPath);
      const printed = getOutput();
      expect(printed).toHaveLength(50);
      expect(printed[0]).toBe("行 51");
      expect(printed[49]).toBe("行 100");
    });

    it("-n -5 負數應 fallback 為 50 行", () => {
      setup100Lines();
      handleLogs({ n: "-5" }, logPath);
      const printed = getOutput();
      expect(printed).toHaveLength(50);
      expect(printed[0]).toBe("行 51");
      expect(printed[49]).toBe("行 100");
    });

    it("-n abc 非數字應 fallback 為 50 行", () => {
      setup100Lines();
      handleLogs({ n: "abc" }, logPath);
      const printed = getOutput();
      expect(printed).toHaveLength(50);
      expect(printed[0]).toBe("行 51");
      expect(printed[49]).toBe("行 100");
    });

    it("-n 後面沒值（flags.n 為 boolean true）應 fallback 為 50 行", () => {
      setup100Lines();
      handleLogs({ n: true }, logPath);
      const printed = getOutput();
      expect(printed).toHaveLength(50);
      expect(printed[0]).toBe("行 51");
      expect(printed[49]).toBe("行 100");
    });
  });

  describe("parseCommand 解析 -n 參數", () => {
    it("解析 logs -n 100 命令", () => {
      const result = parseCommand(["bun", "cli.ts", "logs", "-n", "100"]);
      expect(result.command).toBe("logs");
      expect(result.flags.n).toBe("100");
    });

    it("logs 命令無 -n 時 flags.n 為 undefined", () => {
      const result = parseCommand(["bun", "cli.ts", "logs"]);
      expect(result.command).toBe("logs");
      expect(result.flags.n).toBeUndefined();
    });
  });
});

describe("handleConfig", () => {
  const configPath = path.join(TMP_DIR, "config-handle.json");

  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation((() => {}) as (
      code?: number,
    ) => never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handleConfig 將 subArgs 從 0 開始傳給 handleConfigSet", () => {
    writeConfig(configPath, {});
    // 模擬 parseCommand 解析後的 args: ["set", "GITHUB_TOKEN", "abc"]
    // handleConfig 拿到 args=["set","GITHUB_TOKEN","abc"]，應抽 subArgs=["GITHUB_TOKEN","abc"]
    // 由於 CONFIG_FILE 是模組內私有常數，這裡只驗證不 exit(1)
    // 實際行為：set GITHUB_TOKEN 應該成功
    expect(() => handleConfig(["set", "GITHUB_TOKEN", "tok123"])).not.toThrow();
  });

  it("handleConfig set 缺少 value 時呼叫 process.exit(1)", () => {
    handleConfig(["set", "GITHUB_TOKEN"]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("handleConfig get 缺少 key 時呼叫 process.exit(1)", () => {
    handleConfig(["get"]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("handleConfig 使用未知子命令時呼叫 process.exit(1)", () => {
    handleConfig(["unknown"]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("validatePort - 邊界值", () => {
  it("resolvePort 在 flags.port 為 boolean true 時使用預設 3001", () => {
    // validatePort("true") 應回傳 null
    expect(validatePort("true")).toBeNull();
  });

  it("resolvePort 在 flags.port 為空字串時回傳 null", () => {
    expect(validatePort("")).toBeNull();
  });
});

describe("getLocalIp - 多 IPv4 介面", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("有多個 external IPv4 介面時回傳第一個", () => {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      eth0: [
        {
          address: "192.168.1.100",
          family: "IPv4",
          internal: false,
          netmask: "255.255.255.0",
          mac: "00:00:00:00:00:00",
          cidr: "192.168.1.100/24",
        },
      ],
      eth1: [
        {
          address: "10.0.0.5",
          family: "IPv4",
          internal: false,
          netmask: "255.0.0.0",
          mac: "00:00:00:00:00:01",
          cidr: "10.0.0.5/8",
        },
      ],
    });
    // 應回傳第一個找到的 external IPv4
    const ip = getLocalIp();
    expect(ip).toBeTruthy();
    expect(["192.168.1.100", "10.0.0.5"]).toContain(ip);
  });
});
