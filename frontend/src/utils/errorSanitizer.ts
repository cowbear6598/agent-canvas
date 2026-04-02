import { t } from "@/i18n";

const MAX_ERROR_LENGTH = 200;

const SENSITIVE_PATTERNS = [
  /[A-Za-z]:\\[\w\\.-]+/g,
  /\/[\w/.-]+/g,
  /[\w.-]+@[\w.-]+\.\w+/g,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /[a-zA-Z0-9_-]{20,}/g,
  /at\s+[\w.]+\s+\([^)]+\)/g,
];

// 僅保留網路 / 系統層級錯誤碼的 mapping；
// 後端業務錯誤已改為回傳 i18n key，不在此處處理。
const ERROR_CODE_KEYS = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
] as const;

type ErrorCode = (typeof ERROR_CODE_KEYS)[number];

function removeSensitiveInfo(message: string): string {
  let sanitized = message;

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, t("error.redacted"));
  }

  return sanitized;
}

function mapErrorCode(message: string): string {
  for (const code of ERROR_CODE_KEYS) {
    if (message.includes(code)) {
      return t(`error.${code}` as `error.${ErrorCode}`);
    }
  }

  return message;
}

function limitLength(
  message: string,
  maxLength: number = MAX_ERROR_LENGTH,
): string {
  if (message.length <= maxLength) {
    return message;
  }

  return message.substring(0, maxLength) + "...";
}

export function sanitizeErrorForUser(error: unknown): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object" && "message" in error) {
    message = String(error.message);
  } else {
    message = t("common.error.unknown");
  }

  message = mapErrorCode(message);
  message = removeSensitiveInfo(message);
  message = limitLength(message);

  return message;
}
