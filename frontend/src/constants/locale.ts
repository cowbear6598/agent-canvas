// 支援的語系型別，與 i18n.ts 保持一致
export type SupportedLocale = "zh-TW" | "en" | "ja";

// 語系選項清單，供 AppHeader 與 GlobalSettingsModal 共用，避免兩處重複維護
export const LOCALE_OPTIONS: {
  value: SupportedLocale;
  label: string;
  abbr: string;
}[] = [
  { value: "zh-TW", label: "繁體中文", abbr: "中" },
  { value: "en", label: "English", abbr: "EN" },
  { value: "ja", label: "日本語", abbr: "日" },
];
