import { createI18n } from "vue-i18n";
import zhTW from "./locales/zh-TW.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

// 支援的語言清單
type SupportedLocale = "zh-TW" | "en" | "ja";

const SUPPORTED_LOCALES: SupportedLocale[] = ["zh-TW", "en", "ja"];
const DEFAULT_LOCALE: SupportedLocale = "zh-TW";
const LOCALE_STORAGE_KEY = "locale";

// 從 localStorage 讀取語言偏好，若不在支援清單內則回退到預設值
// 在測試環境或 SSR 中 localStorage 可能不可用，安全降級為預設語言
function getInitialLocale(): SupportedLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) {
      return stored as SupportedLocale;
    }
  } catch {
    // localStorage 不可用（測試環境、SSR 等），使用預設語言
  }
  return DEFAULT_LOCALE;
}

const i18n = createI18n({
  legacy: false, // 使用 Composition API 模式
  locale: getInitialLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    "zh-TW": zhTW,
    en,
    ja,
  },
});

// 切換語言，並同步寫入 localStorage；若 locale 不在白名單則忽略
export function setLocale(locale: string): void {
  if (!(SUPPORTED_LOCALES as string[]).includes(locale)) return;
  i18n.global.locale.value = locale as SupportedLocale;
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

// 匯出 i18n instance，供需要存取 global 屬性的地方使用
export { i18n };

// 供非元件環境（store、composable、utility 等）直接 import 使用
export const t = i18n.global.t;

export default i18n;
