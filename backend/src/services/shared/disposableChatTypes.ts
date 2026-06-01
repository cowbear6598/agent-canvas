import type { LogCategory } from "../../utils/logger.js";

/**
 * 一次性無狀態 AI 查詢的共用型別定義。
 * claudeService 與 codexService 共同使用，避免各自重複定義。
 */

/** 供一次性 task 宣告的工具契約描述。 */
export interface DisposableToolContract {
  name: string;
  description: string;
  inputDescription: string;
  outputDescription: string;
}

/** 一次性 task 的結構化輸出要求。 */
export interface DisposableResponseFormat {
  schemaName: string;
  description: string;
}

/** 一次性查詢的輸入選項 */
export interface DisposableChatOptions {
  systemPrompt: string;
  userMessage: string;
  workspacePath: string;
  model?: string;
  thinkingLevel?: string | null;
  toolContracts?: DisposableToolContract[];
  responseFormat?: DisposableResponseFormat;
  logCategory?: LogCategory;
  logLabel?: string;
}

/** 一次性查詢的回傳結果 */
export interface DisposableChatResult {
  content: string;
  success: boolean;
  error?: string;
}
