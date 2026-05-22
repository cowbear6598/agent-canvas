const MAX_RUN_RESPONSE_SUMMARY_LENGTH = 1000;

export function deriveRunResponseSummary(content: string): string | null {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= MAX_RUN_RESPONSE_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_RUN_RESPONSE_SUMMARY_LENGTH).trimEnd()}...`;
}
