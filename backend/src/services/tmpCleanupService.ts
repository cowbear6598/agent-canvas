import fs from "fs/promises";
import path from "path";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** 6 小時的毫秒數 */
const TTL_MS = 6 * 60 * 60 * 1000;

/** 每小時執行一次清理 */
const INTERVAL_MS = 60 * 60 * 1000;

/** 每批並行 stat 的 entry 數量上限，避免 entries 極多時 IO fan-out 過大 */
const STAT_CHUNK_SIZE = 20;

/**
 * 本服務同時負責兩類過期目錄的清理：
 *   1. 孤兒正式附件目錄：`tmpRoot/<chatMessageId>/`
 *      訊息送出後 promote 過來的正式附件，6h 後由本服務清理。
 *   2. 孤兒 staging 子目錄：`tmpRoot/staging/<uploadSessionId>/`
 *      HTTP 上傳暫存，若 session 超過 6h 未被認領（promote），整個子目錄一併刪除。
 *      `tmpRoot/staging/` 父目錄本身永遠不刪，保留為固定掛載點。
 */
class TmpCleanupService {
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * 啟動定期清理任務。
   * 首次立即執行一次，之後每小時執行一次。
   * timer.unref() 確保 process 可以在沒有其他活動時正常退出。
   */
  start(): void {
    // 首次不 await，讓啟動流程不受阻擋
    this.runOnce().catch(() => {
      // 清理失敗下次 cycle 會重試
    });

    this.timer = setInterval(() => {
      this.runOnce().catch(() => {
        // 清理失敗下次 cycle 會重試
      });
    }, INTERVAL_MS);

    // 避免 interval 阻擋 process 正常退出
    this.timer.unref();
  }

  /**
   * 停止定期清理任務（主要供測試使用）。
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 執行單次清理：
   *   - 掃描 tmpRoot，對每個 entry 依其類型分派清理策略：
   *     - entry 名稱為 "staging"：進入子目錄掃 <uploadSessionId> 層，6h 過期的 session 子目錄整個刪掉；staging 父目錄本身永遠不刪
   *     - 其他 entry（<chatMessageId> 正式附件目錄）：沿用原本邏輯，6h 過期就刪
   *
   * 使用 chunk 並行策略（每批 STAT_CHUNK_SIZE 個）對 entries 做 fs.stat，
   * 避免 entries 極多時同時發起大量 IO（fan-out 過大），同時比全串行快。
   */
  async runOnce(): Promise<void> {
    const tmpRoot = config.tmpRoot;
    let entries: string[];

    try {
      entries = await fs.readdir(tmpRoot);
    } catch (error) {
      // tmpRoot 尚未建立（首次啟動，還沒有人上傳過附件）
      if (isEnoent(error)) {
        return;
      }
      return;
    }

    const now = Date.now();
    let cleanedCount = 0;

    // 將 entries 切成每批 STAT_CHUNK_SIZE 個，逐批並行 stat + 清理
    for (let start = 0; start < entries.length; start += STAT_CHUNK_SIZE) {
      const chunk = entries.slice(start, start + STAT_CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (entry) => {
          const entryPath = path.join(tmpRoot, entry);

          // staging 父目錄：進入子目錄掃 uploadSessionId 層，父目錄本身永遠不刪
          if (entry === "staging") {
            const cleaned = await this.cleanStagingDir(entryPath, now);
            cleanedCount += cleaned;
            return;
          }

          // 其他 entry：正式附件目錄（<chatMessageId>），沿用原本 6h 過期邏輯
          try {
            const stat = await fs.stat(entryPath);

            // 只處理目錄，且 mtime 超過 6 小時
            if (!stat.isDirectory()) {
              return;
            }

            if (now - stat.mtimeMs < TTL_MS) {
              return;
            }

            await fs.rm(entryPath, { recursive: true, force: true });
            cleanedCount++;
          } catch {
            // 單一目錄失敗不影響其他目錄的清理
          }
        }),
      );
    }

    if (cleanedCount > 0) {
      logger.log("Cleanup", "Complete", `清理 ${cleanedCount} 個過期 tmp 目錄`);
    }
  }

  /**
   * 掃描 staging 父目錄下的 <uploadSessionId> 子目錄，
   * 刪除 mtime 超過 6h 的 session 子目錄。
   * staging 父目錄本身永遠不刪。
   *
   * @param stagingPath - staging 父目錄絕對路徑（tmpRoot/staging）
   * @param now - 當前時間戳記（毫秒），避免在迴圈內重複呼叫 Date.now()
   * @returns 本次清理的 session 子目錄數量
   */
  private async cleanStagingDir(
    stagingPath: string,
    now: number,
  ): Promise<number> {
    let sessionEntries: string[];

    try {
      sessionEntries = await fs.readdir(stagingPath);
    } catch {
      // staging 目錄尚未建立或讀取失敗，靜默略過
      return 0;
    }

    let cleanedCount = 0;

    // chunk 並行清理 session 子目錄
    for (
      let start = 0;
      start < sessionEntries.length;
      start += STAT_CHUNK_SIZE
    ) {
      const chunk = sessionEntries.slice(start, start + STAT_CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (sessionId) => {
          const sessionPath = path.join(stagingPath, sessionId);
          try {
            const stat = await fs.stat(sessionPath);

            // 只處理目錄
            if (!stat.isDirectory()) {
              return;
            }

            // mtime 未超過 6h，保留
            if (now - stat.mtimeMs < TTL_MS) {
              return;
            }

            // session 子目錄超過 6h 未被認領，整個刪除
            await fs.rm(sessionPath, { recursive: true, force: true });
            cleanedCount++;
          } catch {
            // 單一 session 目錄失敗不影響其他 session 的清理
          }
        }),
      );
    }

    return cleanedCount;
  }
}

/**
 * 判斷錯誤是否為 ENOENT（檔案或目錄不存在）
 */
function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export const tmpCleanupService = new TmpCleanupService();
