import { beforeEach, vi } from "vitest";
import { config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import zhTW from "../src/locales/zh-TW.json";
import en from "../src/locales/en.json";
import ja from "../src/locales/ja.json";

// UUID 計數器
let uuidCounter = 0;

// Mock window.crypto.randomUUID
Object.defineProperty(window.crypto, "randomUUID", {
  writable: true,
  value: vi.fn(() => `test-uuid-${++uuidCounter}`),
});

// Mock window.requestAnimationFrame
window.requestAnimationFrame = vi.fn((cb) => {
  cb(0);
  return 0;
});

// Mock console.warn 和 console.error
console.warn = vi.fn();
console.error = vi.fn();

// 建立測試用 i18n instance（預設使用 zh-TW locale）
// 注意：vue-i18n 會把 @ 符號解析為 linked message 語法，
// 因此需要覆蓋含有 @ 符號的 locale key，以避免測試環境編譯錯誤。
// 只覆蓋會在元件渲染中觸發解析錯誤的 key（hint 字串），
// 保持其他 key（如 validation.gitUrlPrefix）的原始值，以免影響其他測試。
const zhTWTest = {
  ...zhTW,
  integration: {
    ...zhTW.integration,
    telegram: {
      ...zhTW.integration.telegram,
      field: {
        ...zhTW.integration.telegram.field,
        userId: {
          ...zhTW.integration.telegram.field.userId,
          // 移除含有 @userinfobot 的提示，避免 linked message 解析錯誤
          hint: "請輸入 Telegram User ID（可透過 userinfobot 查詢）",
        },
      },
    },
  },
  settings: {
    ...zhTW.settings,
    backup: {
      ...zhTW.settings.backup,
      // 移除含有 git@ 的 placeholder，避免 linked message 解析錯誤
      gitRemoteUrlPlaceholder: "git+ssh://github.com/user/backup.git",
    },
  },
} as typeof zhTW;

const testI18n = createI18n({
  legacy: false,
  locale: "zh-TW",
  fallbackLocale: "zh-TW",
  messages: {
    "zh-TW": zhTWTest,
    en,
    ja,
  },
});

// 全域掛載 vue-i18n，讓所有測試的 mount() 都能使用 $t()
config.global.plugins = [testI18n];

// 修補 @/i18n module 的 global t 函式，使其也能正確處理測試環境中的字串。
// 這樣非 Vue 元件（provider 等）直接呼叫的 t() 也會使用安全版本的 locale。
import("../src/i18n").then((i18nModule) => {
  const originalI18n = i18nModule.i18n;
  // 替換 zh-TW messages 為修補後的版本
  originalI18n.global.setLocaleMessage("zh-TW", zhTWTest);
});

// 每個測試前重置
beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
});
