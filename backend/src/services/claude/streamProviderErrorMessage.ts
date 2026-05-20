import type {
  NormalizedEvent,
  ProviderName,
  ProviderSystemMessage,
} from "../provider/types.js";

export function buildProviderErrorSystemMessage(
  event: Extract<NormalizedEvent, { type: "error" }>,
  providerName: ProviderName,
): ProviderSystemMessage {
  if (event.systemMessage) {
    return event.systemMessage;
  }

  return {
    role: "system",
    content: event.message,
    metadata: {
      provider: providerName,
      code: event.code ?? null,
      severity: event.fatal ? "fatal" : "error",
      rawContent: event.message,
      reasonDetail: undefined,
    },
  };
}

const DETAILED_PROVIDER_ERROR_CODES = new Set([
  "STREAM_ERROR",
  "EXIT_CODE",
  "RESULT_ERROR",
]);

/**
 * 判斷此錯誤碼是否屬於需要記錄 rawContent 到 logger 的「細節型錯誤」。
 * 細節型錯誤的 rawContent 含具體 stderr / 子程序輸出，有助於診斷；
 * 其他錯誤碼（如 RATE_LIMIT / AUTH 等）的 rawContent 多半重複於 content，不需重複落 log。
 */
export function shouldLogProviderRawContent(code: string | null): boolean {
  return code === null || DETAILED_PROVIDER_ERROR_CODES.has(code);
}
