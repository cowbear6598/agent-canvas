/**
 * BranchAbortError
 *
 * Branch 決策流程中由 abortSignal 觸發的中止錯誤。
 * 使用自訂 class 取代 DOMException，避免 Bun 環境 ESLint no-undef 問題。
 *
 * name 設為 "AbortError" 以確保與 isAbortError() helper 相容：
 *   error instanceof Error && error.name === "AbortError"
 */
export class BranchAbortError extends Error {
  constructor() {
    super("Branch decision aborted");
    this.name = "AbortError";
  }
}
