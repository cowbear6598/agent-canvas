import { vi, describe, it, expect, afterEach } from "vitest";

import {
  setOpencodeServerLauncher,
  resetOpencodeServerLauncher,
  startOpencodeServer,
  restartOpencodeServer,
  getOpencodeServerState,
  stopOpencodeServer,
} from "../../src/services/provider/opencodeServer.js";

// ─────────────────────────────────────────────────────────────────────────────
// 輔助函式：建立假的 OpencodeServerInstance
// ─────────────────────────────────────────────────────────────────────────────

function makeFakeServer(url = "http://localhost:12345") {
  return {
    url,
    close: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 生命週期：每個 case 結束後重置 launcher 與 singleton state
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  resetOpencodeServerLauncher();
  stopOpencodeServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// opencodeServer 整合測試
// ─────────────────────────────────────────────────────────────────────────────

describe("opencodeServer", () => {
  describe("happy path：startOpencodeServer 成功後再呼叫 restartOpencodeServer", () => {
    it("重啟後 state.status 為 ready、第二次 launcher 被呼叫、第一次 server.close() 在 restart 過程中被觸發", async () => {
      const firstServer = makeFakeServer("http://localhost:11111");
      const secondServer = makeFakeServer("http://localhost:22222");

      const launcher = vi
        .fn()
        .mockResolvedValueOnce(firstServer)
        .mockResolvedValueOnce(secondServer);

      setOpencodeServerLauncher(launcher);

      // 第一次啟動
      await startOpencodeServer();
      expect(getOpencodeServerState().status).toBe("ready");
      expect(getOpencodeServerState().server).toBe(firstServer);

      // 在 restart 前，first server 的 close 尚未被呼叫
      expect(firstServer.close).not.toHaveBeenCalled();

      // restart = stopOpencodeServer（close firstServer）→ startOpencodeServer（spawn secondServer）
      await restartOpencodeServer();

      // 驗證第一次 server 的 close() 有被觸發（stop → start 的順序契約）
      expect(firstServer.close).toHaveBeenCalledTimes(1);

      // 驗證 launcher 被呼叫了兩次（第一次 start + restart 時的 start）
      expect(launcher).toHaveBeenCalledTimes(2);

      // 驗證最終 state 為 ready，且指向第二個 server
      const finalState = getOpencodeServerState();
      expect(finalState.status).toBe("ready");
      expect(finalState.baseUrl).toBe("http://localhost:22222");
      expect(finalState.server).toBe(secondServer);
      expect(finalState.failureReason).toBeNull();
    });
  });

  describe("sad path：restart 時 launcher 第二次拋錯", () => {
    it("restart 失敗後 state.status 為 failed、含 failureReason、server 與 baseUrl 為 null", async () => {
      const firstServer = makeFakeServer("http://localhost:33333");
      const launchError = new Error("spawn 失敗：port 被佔用");

      const launcher = vi
        .fn()
        .mockResolvedValueOnce(firstServer)
        .mockRejectedValueOnce(launchError);

      setOpencodeServerLauncher(launcher);

      // 第一次啟動成功
      await startOpencodeServer();
      expect(getOpencodeServerState().status).toBe("ready");

      // restart：第二次 launcher 拋錯
      await restartOpencodeServer();

      const finalState = getOpencodeServerState();

      // 狀態應為 failed
      expect(finalState.status).toBe("failed");

      // failureReason 應包含 launcher 拋出的訊息
      expect(finalState.failureReason).not.toBeNull();
      expect(finalState.failureReason).toContain(launchError.message);

      // server 與 baseUrl 應被清空
      expect(finalState.server).toBeNull();
      expect(finalState.baseUrl).toBeNull();
    });
  });
});
