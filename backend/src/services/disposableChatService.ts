/**
 * disposableChatService
 *
 * 統一的一次性無狀態查詢抽象層，依 provider 分發到對應的 AI 服務。
 * 適用於 summary、AI decide 等非 Pod 場景。
 *
 * provider 白名單（未在清單內的 provider 會 throw，不會 silent fallthrough）：
 * - provider === "claude"  → claudeService.executeDisposableChat
 * - provider === "codex"   → codexService.executeDisposableChat
 * - provider === "gemini"  → geminiService.executeDisposableChat
 * - 其他 provider          → 直接 throw「不支援的 provider」錯誤
 *
 * - 不合法的 model 會 fallback 到 provider 預設模型，並透過 resolvedModel 回傳實際使用值
 */

import { resolveModelWithFallback } from "./provider/index.js";
import type { ProviderName } from "./provider/index.js";
import { claudeService } from "./claude/claudeService.js";
import { codexService } from "./codex/codexService.js";
import { geminiService } from "./gemini/geminiService.js";
import { logger } from "../utils/logger.js";

// ─── 公開介面 ────────────────────────────────────────────────────────────────

export interface DisposableChatInput {
  provider: ProviderName;
  model: string;
  systemPrompt: string;
  userMessage: string;
  workspacePath: string;
}

export interface DisposableChatOutput {
  content: string;
  success: boolean;
  error?: string;
  /** 實際使用的模型名稱（可能因 fallback 與輸入不同），呼叫端可用來回寫 connection */
  resolvedModel: string;
}

// ─── 模型驗證 helper ──────────────────────────────────────────────────────────

/**
 * 驗證傳入的 model 是否在該 provider 的合法清單內。
 * 不合法時 fallback 到 provider 預設模型。
 * 共用邏輯由 provider/index.ts 的 resolveModelWithFallback 提供。
 * @returns 實際使用的 model 字串
 */
function resolveModel(provider: ProviderName, requestedModel: string): string {
  const { resolved, didFallback } = resolveModelWithFallback(
    provider,
    requestedModel,
  );

  if (didFallback) {
    logger.warn(
      "Chat",
      "Warn",
      `[DisposableChatService] model "${requestedModel}" 不在 ${provider} 合法清單內，fallback 到預設模型 "${resolved}"`,
    );
  }

  return resolved;
}

// ─── 核心函數 ─────────────────────────────────────────────────────────────────

/**
 * 依 provider 分發到對應 AI 服務執行一次性查詢。
 *
 * @param input - 查詢參數（provider、model、systemPrompt、userMessage、workspacePath）
 * @returns Promise<DisposableChatOutput> 含實際使用模型（resolvedModel）
 */
export async function executeDisposableChat(
  input: DisposableChatInput,
): Promise<DisposableChatOutput> {
  const { provider, systemPrompt, userMessage, workspacePath } = input;

  // 驗證 model，不合法則 fallback 到 provider 預設模型
  const resolvedModel = resolveModel(provider, input.model);

  if (provider === "claude") {
    const result = await claudeService.executeDisposableChat({
      systemPrompt,
      userMessage,
      workspacePath,
      model: resolvedModel,
    });
    return { ...result, resolvedModel };
  } else if (provider === "codex") {
    const result = await codexService.executeDisposableChat({
      systemPrompt,
      userMessage,
      workspacePath,
      model: resolvedModel,
    });
    return { ...result, resolvedModel };
  } else if (provider === "gemini") {
    const result = await geminiService.executeDisposableChat({
      systemPrompt,
      userMessage,
      workspacePath,
      model: resolvedModel,
    });
    return { ...result, resolvedModel };
  } else {
    logger.error(
      "Chat",
      "Error",
      `[DisposableChatService] 不支援的 provider（provider: ${provider}）`,
    );
    throw new Error("不支援的 provider");
  }
}
