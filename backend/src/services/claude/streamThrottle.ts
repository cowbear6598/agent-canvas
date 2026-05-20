/**
 * 串流節流持久化的可變狀態。
 * pendingTimer 供 finalize / abort 清除待排程的舊 timer。
 * lastPersistAt 為上次實際寫入 DB 的時間戳（ms），初始值 0。
 */
export interface ThrottleContext {
  pendingTimer: ReturnType<typeof setTimeout> | null;
  lastPersistAt: number;
}

/**
 * 建立節流持久化函式與對應的 ThrottleContext。
 *
 * - 距上次寫入 >= throttleMs 時立即寫入
 * - 否則排程 setTimeout 到下個窗口開頭寫入最後一次 payload
 * - 同一窗口內多次呼叫只排一個 timer，並使用最新 payload（閉包自動取最新 streamState）
 */
export function createThrottledPersist(
  persistFn: () => void,
  throttleMs: number,
): { persistThrottled: () => void; throttleContext: ThrottleContext } {
  const throttleContext: ThrottleContext = {
    lastPersistAt: 0,
    pendingTimer: null,
  };

  const persistThrottled = (): void => {
    const now = Date.now();
    if (now - throttleContext.lastPersistAt >= throttleMs) {
      throttleContext.lastPersistAt = now;
      persistFn();
    } else if (throttleContext.pendingTimer === null) {
      const delay = throttleMs - (now - throttleContext.lastPersistAt);
      throttleContext.pendingTimer = setTimeout(() => {
        throttleContext.pendingTimer = null;
        // lastPersistAt 在呼叫 persistFn 之前更新，防止下一個事件誤判窗口已過造成雙寫
        throttleContext.lastPersistAt = Date.now();
        persistFn();
      }, delay);
    }
  };

  return { persistThrottled, throttleContext };
}
