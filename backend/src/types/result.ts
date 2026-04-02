import type { I18nError } from "../utils/i18nError.js";

export type Result<T = void> =
  | { success: true; data: T }
  | { success: false; error: string | I18nError };

export function ok<T = void>(data?: T): Result<T> {
  return { success: true, data: data as T };
}

export function err<T = void>(error: string | I18nError): Result<T> {
  return { success: false, error };
}

export function errI18n<T = void>(error: I18nError): Result<T> {
  return { success: false, error };
}

// 將 Result 的 error 轉為字串（給 logger 等內部用途）
export function getResultErrorString(error: string | I18nError): string {
  return typeof error === "string" ? error : error.key;
}
