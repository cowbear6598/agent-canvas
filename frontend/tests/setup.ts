import { beforeEach, vi } from "vitest";
import { config } from "@vue/test-utils";
import { i18n } from "../src/i18n";
import zhTW from "../src/locales/zh-TW.json";

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

// 注意：vue-i18n 會把 @ 符號解析為 linked message 語法，
// 因此需要覆蓋含有 @ 符號的 locale key，以避免測試環境編譯錯誤。
// 只覆蓋會在元件渲染中觸發解析錯誤的 key（hint 字串），
// 保持其他 key（如 validation.gitUrlPrefix）的原始值，以免影響其他測試。
export const zhTWTestMessages = {
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

export function installSharedVueTestSetup(): void {
  i18n.global.setLocaleMessage("zh-TW", zhTWTestMessages);
  config.global.plugins = [i18n];
}

installSharedVueTestSetup();

// 每個測試前重置
beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  i18n.global.locale.value = "zh-TW";
});
