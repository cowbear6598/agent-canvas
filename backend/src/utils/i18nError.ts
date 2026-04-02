export interface I18nError {
  key: string;
  params?: Record<string, string | number>;
}

// 建立 i18n 格式的錯誤物件，前端負責根據 key 翻譯
export function createI18nError(
  key: string,
  params?: Record<string, string | number>,
): I18nError {
  return params ? { key, params } : { key };
}
