/**
 * 一次性無狀態 AI 查詢的共用型別定義。
 * claudeService 與 codexService 共同使用，避免各自重複定義。
 */

/** 一次性查詢的輸入選項 */
export interface DisposableChatOptions {
  systemPrompt: string;
  userMessage: string;
  workspacePath: string;
  model?: string;
}

/** 一次性查詢的回傳結果 */
export interface DisposableChatResult {
  content: string;
  success: boolean;
  error?: string;
}
