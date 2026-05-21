/**
 * unlockRateLimiter 單元測試
 *
 * 覆蓋：
 * - 連續輸錯 5 次後，第 6 次回 blocked + AUTH_RATE_LIMITED
 * - 在封鎖窗口過期後可再次嘗試
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 使用真實實作（非 singleton），每個測試建立獨立 instance 以避免狀態污染
import { UnlockRateLimiterClass } from "../../../src/services/auth/unlockRateLimiter.js";

describe("UnlockRateLimiter", () => {
  let limiter: InstanceType<typeof UnlockRateLimiterClass>;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new UnlockRateLimiterClass();
  });

  afterEach(() => {
    limiter.dispose();
    vi.useRealTimers();
  });

  it("5 次失敗後，第 6 次應回 blocked=true 且 errorCode 為 AUTH_RATE_LIMITED", () => {
    const connectionId = "conn-001";
    const ip = "192.168.1.1";

    // 前 5 次失敗
    for (let i = 0; i < 5; i++) {
      expect(limiter.check(connectionId, ip).blocked).toBe(false);
      limiter.recordFailure(connectionId, ip);
    }

    // 第 6 次應被封鎖
    const result = limiter.check(connectionId, ip);
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("封鎖窗口（60 秒）過期後，應可再次嘗試", () => {
    const connectionId = "conn-002";
    const ip = "10.0.0.1";

    // 觸發封鎖
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(connectionId, ip);
    }
    expect(limiter.check(connectionId, ip).blocked).toBe(true);

    // 模擬 60 秒 + 1ms 過後
    vi.advanceTimersByTime(60_001);

    // 封鎖應已過期
    expect(limiter.check(connectionId, ip).blocked).toBe(false);
  });

  it("成功後 reset，之後的失敗計數應從 0 開始", () => {
    const connectionId = "conn-003";
    const ip = null;

    // 累積 4 次失敗
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure(connectionId, ip);
    }
    // 成功 → 清除
    limiter.reset(connectionId, ip);

    // 重新累積 4 次不應封鎖
    for (let i = 0; i < 4; i++) {
      expect(limiter.check(connectionId, ip).blocked).toBe(false);
      limiter.recordFailure(connectionId, ip);
    }
    expect(limiter.check(connectionId, ip).blocked).toBe(false);
  });
});
