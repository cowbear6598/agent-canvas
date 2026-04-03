export interface ThrottledFunction<T extends unknown[]> {
  (...args: T): void;
  cancel: () => void;
  flush: () => void;
}

export function throttle<T extends unknown[]>(
  func: (...args: T) => void,
  delay: number,
): ThrottledFunction<T> {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: T | undefined;

  const throttled = function (...args: T): void {
    pendingArgs = args;
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      func(...args);
      pendingArgs = undefined;
    } else {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        if (pendingArgs !== undefined) {
          func(...pendingArgs);
        }
        timeoutId = undefined;
        pendingArgs = undefined;
      }, delay - timeSinceLastCall);
    }
  };

  throttled.cancel = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    pendingArgs = undefined;
  };

  throttled.flush = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (pendingArgs !== undefined) {
      lastCall = Date.now();
      func(...pendingArgs);
      pendingArgs = undefined;
    }
  };

  return throttled as ThrottledFunction<T>;
}
