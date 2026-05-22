import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottledPersist } from "../../src/services/claude/streamThrottle.js";

describe("createThrottledPersist", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T10:00:00.000Z"));
  });

  it("同一節流窗口內只應追加一次 trailing persist，且使用最新內容", () => {
    let currentContent = "A";
    const persistedContents: string[] = [];
    const { persistThrottled } = createThrottledPersist(() => {
      persistedContents.push(currentContent);
    }, 2000);

    persistThrottled();
    currentContent = "AB";
    vi.advanceTimersByTime(300);
    persistThrottled();
    currentContent = "ABC";
    vi.advanceTimersByTime(300);
    persistThrottled();

    expect(persistedContents).toEqual(["A"]);

    vi.advanceTimersByTime(2000);

    expect(persistedContents).toEqual(["A", "ABC"]);
  });
});
