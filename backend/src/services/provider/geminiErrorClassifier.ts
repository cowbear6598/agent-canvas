export const GEMINI_RATE_LIMITED_ERROR_CODE = "GEMINI_RATE_LIMITED";
export const GEMINI_CAPACITY_EXHAUSTED_ERROR_CODE =
  "GEMINI_CAPACITY_EXHAUSTED";
export const GEMINI_QUOTA_EXCEEDED_ERROR_CODE = "GEMINI_QUOTA_EXCEEDED";

function hasQuotaSignal(lower: string): boolean {
  return (
    lower.includes("quota exceeded") ||
    lower.includes("quota exhausted") ||
    lower.includes("retryablequotaerror") ||
    (lower.includes("429") && lower.includes("quota"))
  );
}

function hasRateSignal(lower: string): boolean {
  return (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    (lower.includes("429") && lower.includes("rate"))
  );
}

const GEMINI_TERMINAL_ERROR_RULES = [
  {
    code: GEMINI_QUOTA_EXCEEDED_ERROR_CODE,
    content:
      "Gemini 目前回報帳號配額不足，這次請求未完成，請稍後再試或切換模型。",
    reasonDetail: "這次失敗是帳號配額不足，不是單純暫時塞車。",
    matches: (lower: string): boolean =>
      hasQuotaSignal(lower),
  },
  {
    code: GEMINI_RATE_LIMITED_ERROR_CODE,
    content: "Gemini 暫時回報速率限制，這次請求未完成，請稍後再試。",
    reasonDetail: "這次失敗是暫時性的速率限制，不代表帳號額度已用完。",
    matches: (lower: string): boolean => hasRateSignal(lower),
  },
  {
    code: GEMINI_CAPACITY_EXHAUSTED_ERROR_CODE,
    content:
      "Gemini 目前回報模型容量不足，這次請求未完成，請稍後再試或切換模型。",
    reasonDetail: "這次失敗是模型當下容量不足，與帳號配額不足不同。",
    matches: (lower: string): boolean =>
      lower.includes("exhausted your capacity on this model") ||
      lower.includes("capacity exhausted") ||
      ((lower.includes("resource_exhausted") ||
        lower.includes("resource exhausted")) &&
        !hasQuotaSignal(lower) &&
        !hasRateSignal(lower)) ||
      (lower.includes("429") &&
        (lower.includes("capacity") ||
          (lower.includes("resource") &&
            !hasQuotaSignal(lower) &&
            !hasRateSignal(lower)))),
  },
] as const;

export interface GeminiClassifiedError {
  code: string;
  content: string;
  rawContent: string;
  reasonDetail: string;
}

export function classifyGeminiTerminalError(
  rawContent: string,
): GeminiClassifiedError | null {
  const normalized = rawContent.trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  const matchedRule = GEMINI_TERMINAL_ERROR_RULES.find((rule) =>
    rule.matches(lower),
  );

  if (!matchedRule) {
    return null;
  }

  return {
    code: matchedRule.code,
    content: matchedRule.content,
    rawContent: normalized,
    reasonDetail: matchedRule.reasonDetail,
  };
}
