/**
 * unlock 操作的 rate limit 服務。
 * 以「connectionId + 來源 IP」雙鍵記錄失敗次數。
 * 超過閾值後封鎖 60 秒，回傳 AUTH_RATE_LIMITED 錯誤碼。
 */

const MAX_FAILURES = 5;
const BLOCK_WINDOW_MS = 60 * 1000;

interface RateLimitEntry {
  failures: number;
  blockedUntil: number | null;
}

export class UnlockRateLimiterClass {
  private entries = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 每分鐘清理過期條目，避免 Map 無限成長
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * 組合 connectionId 與 ip 成為唯一鍵。
   * ip 為 null 時使用 "unknown"。
   */
  private makeKey(connectionId: string, ip: string | null): string {
    return `${connectionId}::${ip ?? "unknown"}`;
  }

  /**
   * 檢查是否被封鎖。
   * 回傳 null 表示可繼續；回傳數字表示剩餘封鎖秒數。
   */
  check(
    connectionId: string,
    ip: string | null,
  ): { blocked: false } | { blocked: true; retryAfterSeconds: number } {
    const key = this.makeKey(connectionId, ip);
    const entry = this.entries.get(key);

    if (!entry) {
      return { blocked: false };
    }

    if (entry.blockedUntil !== null) {
      const remaining = entry.blockedUntil - Date.now();
      if (remaining > 0) {
        return {
          blocked: true,
          retryAfterSeconds: Math.ceil(remaining / 1000),
        };
      }
      // 封鎖窗口已過期，清除記錄
      this.entries.delete(key);
      return { blocked: false };
    }

    return { blocked: false };
  }

  /**
   * 記錄一次失敗。超過閾值後封鎖。
   */
  recordFailure(connectionId: string, ip: string | null): void {
    const key = this.makeKey(connectionId, ip);
    const entry = this.entries.get(key) ?? { failures: 0, blockedUntil: null };

    entry.failures += 1;

    if (entry.failures >= MAX_FAILURES) {
      entry.blockedUntil = Date.now() + BLOCK_WINDOW_MS;
    }

    this.entries.set(key, entry);
  }

  /**
   * 密碼比對成功時清空對應鍵的記錄。
   */
  reset(connectionId: string, ip: string | null): void {
    const key = this.makeKey(connectionId, ip);
    this.entries.delete(key);
  }

  /**
   * 清理過期條目（封鎖窗口已過且失敗次數未達閾值的也一併清除）。
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.blockedUntil !== null && entry.blockedUntil <= now) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * 停止背景清理 timer，供測試使用以避免 hang。
   */
  dispose(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export const unlockRateLimiter = new UnlockRateLimiterClass();
