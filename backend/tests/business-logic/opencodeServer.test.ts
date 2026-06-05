/**
 * opencodeServer 單元測試
 *
 * 對應 User Flow：
 *   - F1: opencode 伺服器啟動成功 → state.status = "ready"，baseUrl 寫入正確
 *   - F12: opencode binary 未安裝或啟動失敗 → state.status = "failed"，
 *          failureReason 包含原始錯誤訊息，後端仍正常啟動
 *   - stopOpencodeServer 呼叫 close() 並重置 state
 *
 * Mock 策略：
 *   - 使用 setOpencodeServerLauncher / resetOpencodeServerLauncher 注入假 launcher，
 *     只 mock 自己寫的 OpencodeServerLauncher interface，不 mock SDK 內部。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startOpencodeServer,
  getOpencodeServerState,
  stopOpencodeServer,
  setOpencodeServerLauncher,
  resetOpencodeServerLauncher,
  type OpencodeServerInstance,
} from "../../src/services/provider/opencodeServer.js";

// ================================================================
// 輔助函式
// ================================================================

/** 建立一個假的 OpencodeServerInstance */
function makeMockInstance(
  url: string,
): OpencodeServerInstance & { close: ReturnType<typeof vi.fn> } {
  return {
    url,
    close: vi.fn(),
  };
}

// ================================================================
// 每個 test 前後重置 singleton state
// ================================================================

beforeEach(() => {
  // 確保每次 test 都從乾淨的 state 開始
  stopOpencodeServer();
  resetOpencodeServerLauncher();
});

afterEach(() => {
  resetOpencodeServerLauncher();
  vi.restoreAllMocks();
});

// ================================================================
// startOpencodeServer — 成功情境
// ================================================================
describe("startOpencodeServer — 成功情境", () => {
  it("launcher 應收到後端注入的 full access config", async () => {
    const mockInstance = makeMockInstance("http://127.0.0.1:4096");
    const launcher = vi.fn().mockResolvedValue(mockInstance);
    setOpencodeServerLauncher(launcher);

    await startOpencodeServer();

    expect(launcher).toHaveBeenCalledWith({
      port: 4096,
      timeout: 30000,
      config: {
        mcp: {},
        permission: "allow",
      },
    });
  });

  it("launcher resolve 後 state.status 應為 ready", async () => {
    const mockInstance = makeMockInstance("http://127.0.0.1:4096");
    setOpencodeServerLauncher(() => Promise.resolve(mockInstance));

    await startOpencodeServer();

    const state = getOpencodeServerState();
    expect(state.status).toBe("ready");
  });

  it("launcher resolve 後 state.baseUrl 應寫入正確的 URL", async () => {
    const expectedUrl = "http://127.0.0.1:4096";
    const mockInstance = makeMockInstance(expectedUrl);
    setOpencodeServerLauncher(() => Promise.resolve(mockInstance));

    await startOpencodeServer();

    const state = getOpencodeServerState();
    expect(state.baseUrl).toBe(expectedUrl);
  });

  it("launcher resolve 後 state.failureReason 應為 null", async () => {
    const mockInstance = makeMockInstance("http://127.0.0.1:4096");
    setOpencodeServerLauncher(() => Promise.resolve(mockInstance));

    await startOpencodeServer();

    const state = getOpencodeServerState();
    expect(state.failureReason).toBeNull();
  });
});

// ================================================================
// startOpencodeServer — 失敗情境
// ================================================================
describe("startOpencodeServer — 失敗情境", () => {
  it("launcher reject 後 state.status 應為 failed", async () => {
    setOpencodeServerLauncher(() =>
      Promise.reject(new Error("opencode: command not found")),
    );
    // 抑制 console.error 輸出，避免測試輸出雜訊
    vi.spyOn(console, "error").mockImplementation(() => {});

    await startOpencodeServer();

    const state = getOpencodeServerState();
    expect(state.status).toBe("failed");
  });

  it("launcher reject 後 state.failureReason 應包含原始錯誤訊息", async () => {
    const originalError = "opencode: command not found";
    setOpencodeServerLauncher(() => Promise.reject(new Error(originalError)));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await startOpencodeServer();

    const state = getOpencodeServerState();
    expect(state.failureReason).not.toBeNull();
    expect(state.failureReason).toContain(originalError);
  });

  it("launcher reject 後 state.baseUrl 應為 null", async () => {
    setOpencodeServerLauncher(() => Promise.reject(new Error("啟動逾時")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await startOpencodeServer();

    const state = getOpencodeServerState();
    expect(state.baseUrl).toBeNull();
  });

  it("launcher reject 後 console.error 應被呼叫（記錄詳細原因）", async () => {
    setOpencodeServerLauncher(() => Promise.reject(new Error("spawn ENOENT")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await startOpencodeServer();

    expect(errorSpy).toHaveBeenCalled();
  });
});

// ================================================================
// stopOpencodeServer
// ================================================================
describe("stopOpencodeServer", () => {
  it("呼叫 stopOpencodeServer() 後應呼叫 instance.close()", async () => {
    const mockInstance = makeMockInstance("http://127.0.0.1:4096");
    setOpencodeServerLauncher(() => Promise.resolve(mockInstance));

    await startOpencodeServer();

    // 確認先到 ready 再 stop
    expect(getOpencodeServerState().status).toBe("ready");

    stopOpencodeServer();

    expect(mockInstance.close).toHaveBeenCalledTimes(1);
  });

  it("stopOpencodeServer() 後 state.status 應重置為 idle", async () => {
    const mockInstance = makeMockInstance("http://127.0.0.1:4096");
    setOpencodeServerLauncher(() => Promise.resolve(mockInstance));

    await startOpencodeServer();
    stopOpencodeServer();

    expect(getOpencodeServerState().status).toBe("idle");
  });

  it("stopOpencodeServer() 後 state.baseUrl 應重置為 null", async () => {
    const mockInstance = makeMockInstance("http://127.0.0.1:4096");
    setOpencodeServerLauncher(() => Promise.resolve(mockInstance));

    await startOpencodeServer();
    stopOpencodeServer();

    expect(getOpencodeServerState().baseUrl).toBeNull();
  });

  it("stopOpencodeServer() 後 state.failureReason 應重置為 null", async () => {
    setOpencodeServerLauncher(() => Promise.reject(new Error("啟動失敗")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await startOpencodeServer();
    expect(getOpencodeServerState().status).toBe("failed");

    stopOpencodeServer();

    expect(getOpencodeServerState().failureReason).toBeNull();
  });

  it("在沒有 server 時呼叫 stopOpencodeServer() 不應拋錯", () => {
    // state 已在 beforeEach 重置為 idle（無 server）
    expect(() => stopOpencodeServer()).not.toThrow();
  });
});

// ================================================================
// getOpencodeServerState — 回傳快照
// ================================================================
describe("getOpencodeServerState", () => {
  it("初始 state 應為 idle、baseUrl 為 null、failureReason 為 null", () => {
    const state = getOpencodeServerState();

    expect(state.status).toBe("idle");
    expect(state.baseUrl).toBeNull();
    expect(state.failureReason).toBeNull();
  });

  it("回傳的 state 應為快照（修改回傳物件不影響內部 state）", async () => {
    const mockInstance = makeMockInstance("http://127.0.0.1:4096");
    setOpencodeServerLauncher(() => Promise.resolve(mockInstance));

    await startOpencodeServer();

    const snapshot = getOpencodeServerState();
    // 直接修改快照不應影響內部 state
    (snapshot as Record<string, unknown>).baseUrl = "http://tampered.url";

    const freshSnapshot = getOpencodeServerState();
    expect(freshSnapshot.baseUrl).toBe("http://127.0.0.1:4096");
  });
});
