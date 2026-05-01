export const GEMINI_QUOTA_ERROR_CODE = "GEMINI_QUOTA_EXHAUSTED";

export const GEMINI_QUOTA_ERROR_MESSAGE =
  "Gemini 目前回報模型配額或容量不足，已停止等待自動重試，請稍後再試或切換模型。";

const STRONG_GEMINI_QUOTA_SIGNALS = [
  "retryablequotaerror",
  "exhausted your capacity on this model",
  "rate limit",
  "resource_exhausted",
  "resource exhausted",
  "quota exceeded",
  "too many requests",
];

export interface GeminiClassifiedError {
  code: string;
  content: string;
  rawContent: string;
}

export function classifyGeminiFailFastError(
  rawContent: string,
): GeminiClassifiedError | null {
  const normalized = rawContent.trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  const hasStrongSignal = STRONG_GEMINI_QUOTA_SIGNALS.some((signal) =>
    lower.includes(signal),
  );
  const has429Context =
    lower.includes("429") &&
    (lower.includes("quota") ||
      lower.includes("capacity") ||
      lower.includes("rate") ||
      lower.includes("resource"));

  if (!hasStrongSignal && !has429Context) {
    return null;
  }

  return {
    code: GEMINI_QUOTA_ERROR_CODE,
    content: GEMINI_QUOTA_ERROR_MESSAGE,
    rawContent: normalized,
  };
}
