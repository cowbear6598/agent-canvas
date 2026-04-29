import { beforeEach } from "vitest";
import { setActivePinia } from "pinia";
import { vi } from "vitest";
import { setupTestPinia } from "./mockStoreFactory";
import { resetMockWebSocket } from "./mockWebSocket";
import { resetFactoryCounters } from "./factories";

/**
 * 標準 store 測試 setup，封裝常見的 4 行 beforeEach 初始化邏輯。
 *
 * **注意：此函式會自動在目前 describe 區塊中註冊 `beforeEach`，
 * 呼叫端不需自己再寫 `beforeEach(() => ...)`。**
 * 每次測試前會依序執行：重置 Pinia、啟用 Pinia、重置 WebSocket mock、清除所有 vi mock 狀態，
 * 再執行 `extra`（若有傳入）。
 *
 * @param extra - 可選的額外初始化邏輯，會在標準初始化後執行
 *
 * @example
 * ```ts
 * describe('MyStore', () => {
 *   setupStoreTest() // 不需要再寫 beforeEach
 *
 *   it('should ...', () => { ... })
 * })
 * ```
 */
export function setupStoreTest(extra?: () => void): void {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    resetMockWebSocket();
    resetFactoryCounters();
    vi.clearAllMocks();
    extra?.();
  });
}

/**
 * errorSanitizer 的標準 mock factory。
 * 傳入 vi.mock() 的第二參數使用。
 *
 * @example
 * ```ts
 * vi.mock('@/utils/errorSanitizer', mockErrorSanitizerFactory)
 * ```
 */
export function mockErrorSanitizerFactory() {
  return {
    sanitizeErrorForUser: vi.fn((error: unknown) => {
      if (error instanceof Error) return error.message;
      if (typeof error === "string") return error;
      return "未知錯誤";
    }),
  };
}

/**
 * useToast 的標準 mock factory（簡單版，不需要在 assertion 中存取 mock 函式）。
 * 傳入 vi.mock() 的第二參數使用。
 *
 * @example
 * ```ts
 * vi.mock('@/composables/useToast', mockToastFactory)
 * ```
 */
export function mockToastFactory() {
  return {
    useToast: () => ({
      toast: vi.fn(),
      showSuccessToast: vi.fn(),
      showErrorToast: vi.fn(),
    }),
  };
}
