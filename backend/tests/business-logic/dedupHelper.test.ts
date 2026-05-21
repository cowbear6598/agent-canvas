import { createDedupTracker } from '../../src/services/integration/dedupHelper.js';

describe('createDedupTracker - 基本去重功能', () => {
  it('首次出現的 id 應回傳 false（非重複）', () => {
    const tracker = createDedupTracker();
    expect(tracker.isDuplicate('id-1')).toBe(false);
  });

  it('相同 id 再次出現應回傳 true（重複）', () => {
    const tracker = createDedupTracker();
    tracker.isDuplicate('id-1');
    expect(tracker.isDuplicate('id-1')).toBe(true);
  });

  it('不同 id 應各自獨立，不互相影響', () => {
    const tracker = createDedupTracker();
    tracker.isDuplicate('id-1');
    expect(tracker.isDuplicate('id-2')).toBe(false);
  });

  it('多個 tracker 實例應相互獨立', () => {
    const tracker1 = createDedupTracker();
    const tracker2 = createDedupTracker();

    tracker1.isDuplicate('id-1');
    expect(tracker2.isDuplicate('id-1')).toBe(false);
  });
});

describe('createDedupTracker - 過期清除', () => {
  it('過期的 id 應被清除並視為新事件', () => {
    vi.useFakeTimers();

    const tracker = createDedupTracker();
    tracker.isDuplicate('id-1');

    // 超過 5 分鐘
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(tracker.isDuplicate('id-1')).toBe(false);

    vi.useRealTimers();
  });

  it('未過期的 id 應仍被視為重複', () => {
    vi.useFakeTimers();

    const tracker = createDedupTracker();
    tracker.isDuplicate('id-1');

    vi.advanceTimersByTime(4 * 60 * 1000);

    expect(tracker.isDuplicate('id-1')).toBe(true);

    vi.useRealTimers();
  });
});

describe('createDedupTracker - Map 大小限制', () => {
  it('超過 MAX_DEDUP_MAP_SIZE 應移除最舊的 entry', () => {
    const tracker = createDedupTracker();

    // 填滿 10000 個 entry
    for (let i = 0; i < 10000; i++) {
      tracker.isDuplicate(`id-${i}`);
    }

    // 第 10001 個 entry 加入時，最舊的 id-0 應被移除
    tracker.isDuplicate('id-new');

    // id-0 應已被移除，視為新 id
    expect(tracker.isDuplicate('id-0')).toBe(false);
  });
});
