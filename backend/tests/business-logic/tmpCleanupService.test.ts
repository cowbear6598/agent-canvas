/**
 * tmpCleanupService 單元測試
 *
 * 覆蓋以下測試案例（依計畫書編號）：
 * 16 - 刪除 mtime > 6h 的目錄，保留 mtime < 6h 的目錄
 * 17 - tmpRoot 不存在時靜默（ENOENT）
 * 18 - 每小時 tick 失敗不 crash（clearInterval 後不再執行）
 * B  - staging 子目錄超過 6h 會被清；staging 父目錄永遠不會被清
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// mock logger 避免 console 輸出
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// mock config，讓 tmpRoot / stagingRoot 指向 sandbox
vi.mock("../../src/config/index.js", () => ({
  config: {
    tmpRoot: "/mock-tmp-root",
    stagingRoot: "/mock-tmp-root/staging",
  },
}));

// 動態 import 真實 tmpCleanupService（在 mock 設定後）
const { tmpCleanupService } =
  await import("../../src/services/tmpCleanupService.js");
const { config } = await import("../../src/config/index.js");

/** sandbox 暫存目錄 */
let sandboxDir: string;

/**
 * 設定目錄的 mtime 為指定時間戳記（毫秒）
 * 注意：Node.js fs.utimes 使用 seconds，需要 / 1000
 */
async function setMtime(dirPath: string, mtimeMs: number): Promise<void> {
  const mtimeSec = mtimeMs / 1000;
  await fs.utimes(dirPath, mtimeSec, mtimeSec);
}

/** 6 小時的毫秒數 */
const TTL_MS = 6 * 60 * 60 * 1000;

beforeEach(async () => {
  vi.clearAllMocks();

  // 建立 sandbox 暫存目錄
  sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-cleanup-test-"));

  // 讓 config.tmpRoot 指向 sandbox
  (config as { tmpRoot: string }).tmpRoot = sandboxDir;
});

afterEach(async () => {
  // 確保停止 timer
  tmpCleanupService.stop();

  // 清除 sandbox
  await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => void 0);

  vi.restoreAllMocks();
});

// ================================================================
// 測試案例 16 — 刪 mtime > 6h
// ================================================================
describe("tmpCleanupService.runOnce — 刪除過期目錄（案例 16）", () => {
  it("mtime 超過 6h 的目錄應被刪除", async () => {
    // 建立超過 6h 的目錄
    const expiredDir = path.join(sandboxDir, "expired-msg-id");
    await fs.mkdir(expiredDir);

    // 設 mtime 為 7 小時前
    const expiredMtime = Date.now() - TTL_MS - 60 * 60 * 1000;
    await setMtime(expiredDir, expiredMtime);

    await tmpCleanupService.runOnce();

    // 已過期目錄應被刪除
    await expect(fs.stat(expiredDir)).rejects.toThrow();
  });

  it("mtime 未超過 6h 的目錄應被保留", async () => {
    // 建立剛建立（新鮮）的目錄
    const freshDir = path.join(sandboxDir, "fresh-msg-id");
    await fs.mkdir(freshDir);

    // mtime 為 5 小時前（未過期）
    const freshMtime = Date.now() - TTL_MS + 60 * 60 * 1000;
    await setMtime(freshDir, freshMtime);

    await tmpCleanupService.runOnce();

    // 未過期目錄應保留
    const stat = await fs.stat(freshDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("混合過期與未過期目錄時，只刪除過期的", async () => {
    // 建立已過期目錄
    const expiredDir = path.join(sandboxDir, "old-dir");
    await fs.mkdir(expiredDir);
    await setMtime(expiredDir, Date.now() - TTL_MS - 3600_000);

    // 建立未過期目錄
    const freshDir = path.join(sandboxDir, "new-dir");
    await fs.mkdir(freshDir);

    await tmpCleanupService.runOnce();

    // 已過期 → 刪除
    await expect(fs.stat(expiredDir)).rejects.toThrow();
    // 未過期 → 保留
    const stat = await fs.stat(freshDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("非目錄（檔案）不應被刪除", async () => {
    // 建立一個普通檔案（非目錄）
    const filePath = path.join(sandboxDir, "some-file.txt");
    await fs.writeFile(filePath, "不該被刪");
    // 設為超過 6h 的 mtime
    await setMtime(filePath, Date.now() - TTL_MS - 3600_000);

    await tmpCleanupService.runOnce();

    // 只刪目錄，檔案應保留
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });
});

// ================================================================
// 測試案例 31 — `.staging` 子目錄也應被清除
// ================================================================
describe("tmpCleanupService.runOnce — .staging 殘餘目錄清理（案例 31）", () => {
  it("mtime 超過 6h 的 .staging 子目錄應被刪除", async () => {
    // 建立 <id>.staging 格式的殘餘目錄（中途失敗殘留的 staging 目錄）
    const stagingDir = path.join(sandboxDir, "some-msg-id.staging");
    await fs.mkdir(stagingDir);

    // 設 mtime 為 7 小時前（超過 6h TTL）
    await setMtime(stagingDir, Date.now() - TTL_MS - 60 * 60 * 1000);

    await tmpCleanupService.runOnce();

    // staging 殘餘目錄應被刪除
    await expect(fs.stat(stagingDir)).rejects.toThrow();
  });
});

// ================================================================
// 測試案例 B — staging 子目錄超過 6h 會被清；staging 父目錄永遠不清
// ================================================================
describe("tmpCleanupService.runOnce — staging 子目錄清理（案例 B）", () => {
  it("staging 子目錄（uploadSessionId）mtime 超過 6h 應被刪除", async () => {
    // 建立 tmpRoot/staging/
    const stagingParent = path.join(sandboxDir, "staging");
    await fs.mkdir(stagingParent);

    // 建立過期的 uploadSession 子目錄
    const expiredSession = path.join(stagingParent, "session-expired-id");
    await fs.mkdir(expiredSession);

    // 設 mtime 為 7 小時前（超過 6h TTL）
    await setMtime(expiredSession, Date.now() - TTL_MS - 60 * 60 * 1000);

    await tmpCleanupService.runOnce();

    // 過期的 session 子目錄應被刪除
    await expect(fs.stat(expiredSession)).rejects.toThrow();
  });

  it("staging 子目錄 mtime 未超過 6h 應被保留", async () => {
    // 建立 tmpRoot/staging/
    const stagingParent = path.join(sandboxDir, "staging");
    await fs.mkdir(stagingParent);

    // 建立未過期的 uploadSession 子目錄
    const freshSession = path.join(stagingParent, "session-fresh-id");
    await fs.mkdir(freshSession);

    // 設 mtime 為 5 小時前（未過期）
    await setMtime(freshSession, Date.now() - TTL_MS + 60 * 60 * 1000);

    await tmpCleanupService.runOnce();

    // 未過期的 session 子目錄應保留
    const stat = await fs.stat(freshSession);
    expect(stat.isDirectory()).toBe(true);
  });

  it("staging 父目錄本身永遠不應被刪除", async () => {
    // 建立 tmpRoot/staging/，且 mtime 設為超過 6h
    const stagingParent = path.join(sandboxDir, "staging");
    await fs.mkdir(stagingParent);

    // 即使 staging 父目錄的 mtime 超過 6h，也不應被刪除
    await setMtime(stagingParent, Date.now() - TTL_MS - 60 * 60 * 1000);

    await tmpCleanupService.runOnce();

    // staging 父目錄應永遠保留
    const stat = await fs.stat(stagingParent);
    expect(stat.isDirectory()).toBe(true);
  });
});

// ================================================================
// 測試案例 17 — tmp/ 不存在靜默
// ================================================================
describe("tmpCleanupService.runOnce — tmpRoot 不存在靜默（案例 17）", () => {
  it("tmpRoot 不存在時應靜默回傳（不拋錯）", async () => {
    // 讓 config.tmpRoot 指向一個不存在的目錄
    (config as { tmpRoot: string }).tmpRoot = path.join(
      sandboxDir,
      "non-existent-tmp",
    );

    // 不應拋錯
    await expect(tmpCleanupService.runOnce()).resolves.toBeUndefined();
  });
});

// ================================================================
// 測試案例 18 — 每小時 tick 失敗不 crash
// ================================================================
describe("tmpCleanupService.start/stop — tick 失敗不 crash（案例 18）", () => {
  it("start() 後多次 tick 失敗不應讓 process crash，stop() 後不再執行", async () => {
    // 讓 runOnce 每次都拋錯（模擬讀取 tmp 目錄時失敗）
    const runOnceSpy = vi
      .spyOn(tmpCleanupService, "runOnce")
      .mockRejectedValue(new Error("模擬 tick 失敗"));

    // start() 不應拋錯（首次 runOnce 失敗被 catch 吞掉）
    expect(() => tmpCleanupService.start()).not.toThrow();

    // 等待首次非同步 runOnce 完成（即使失敗）
    await new Promise((resolve) => setTimeout(resolve, 10));

    // stop() 停止 interval
    tmpCleanupService.stop();

    const callCountAfterStop = runOnceSpy.mock.calls.length;

    // 再等一段時間，確認 stop() 後 runOnce 不再被呼叫
    await new Promise((resolve) => setTimeout(resolve, 50));

    // call count 不應增加
    expect(runOnceSpy.mock.calls.length).toBe(callCountAfterStop);
  });

  it("stop() 在未 start() 的情況下呼叫不應拋錯", () => {
    expect(() => tmpCleanupService.stop()).not.toThrow();
  });
});
