import { afterEach, beforeEach, expect, vi } from "vitest";
import { config } from "@vue/test-utils";
import { i18n } from "../src/i18n";
import zhTW from "../src/locales/zh-TW.json";

// UUID 計數器
let uuidCounter = 0;

type CapturedConsoleMethod = "warn" | "error";

interface CapturedConsoleOutput {
  method: CapturedConsoleMethod;
  args: unknown[];
  message: string;
  testName?: string;
}

export interface ConsoleOutputAllowlistEntry {
  method: CapturedConsoleMethod;
  messageIncludes?: string;
  messagePattern?: RegExp;
  testNameIncludes?: string;
}

const capturedConsoleOutputs: CapturedConsoleOutput[] = [];
const runtimeConsoleOutputAllowlist: ConsoleOutputAllowlistEntry[] = [];

// 既有測試允許保留的合法 console warning/error 來源集中列在這裡。
// 新增預期輸出時，優先在測試中用 assertion 或 allowConsoleOutput 明確宣告。
const CONSOLE_OUTPUT_ALLOWLIST: ConsoleOutputAllowlistEntry[] = [
  {
    method: "warn",
    messageIncludes: "[test] 沒有啟用的畫布",
  },
  {
    method: "warn",
    messageIncludes: "語音辨識錯誤：",
  },
  {
    method: "warn",
    messageIncludes: "[ChatStore] 沒有啟用的畫布",
  },
  {
    method: "warn",
    messageIncludes: "[RunStore] 沒有啟用的畫布",
  },
  {
    method: "warn",
    messageIncludes: "[useCanvasWebSocketAction] 沒有啟用的畫布",
  },
  {
    method: "warn",
    messageIncludes: "[podValidation] 未知 provider 或 provider metadata 尚未載入",
  },
  {
    method: "warn",
    messageIncludes: "[createUnifiedHandler] 收到事件但 payload 缺少 canvasId",
  },
  {
    method: "warn",
    messageIncludes: "[Vue warn]: Plugin has already been applied to target app.",
  },
  {
    method: "warn",
    messageIncludes: "[Vue warn]: onUnmounted is called when there is no active component instance",
  },
  {
    method: "error",
    messageIncludes: "[WebSocket] 請求失敗:",
  },
  {
    method: "error",
    messageIncludes: "[WebSocket] 無法發送訊息，未連線:",
  },
  {
    method: "error",
    messageIncludes: "[WebSocket] 發送訊息失敗:",
  },
  {
    method: "error",
    messageIncludes: "[WebSocket] 訊息解析錯誤，資料格式無效",
  },
  {
    method: "error",
    messageIncludes: "[WebSocket] grant 換發失敗:",
  },
  {
    method: "error",
    messageIncludes: "[opencodeAliasStore] 載入 alias 清單失敗：",
  },
  {
    method: "error",
    messageIncludes: "[RunStore] 載入 Run 歷史失敗",
  },
  {
    method: "error",
    messageIncludes: "[RunStore] 刪除 Run 失敗",
  },
  {
    method: "error",
    messageIncludes: "[RunStore] 載入 Run 對話失敗",
  },
];

const formatConsoleArg = (arg: unknown): string => {
  if (arg instanceof Error) {
    return arg.stack ?? arg.message;
  }

  if (typeof arg === "string") {
    return arg;
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

const formatConsoleMessage = (args: unknown[]): string =>
  args.map(formatConsoleArg).join(" ");

export function allowConsoleOutput(
  entry: ConsoleOutputAllowlistEntry,
): () => void {
  runtimeConsoleOutputAllowlist.push(entry);
  return () => {
    const index = runtimeConsoleOutputAllowlist.indexOf(entry);
    if (index >= 0) {
      runtimeConsoleOutputAllowlist.splice(index, 1);
    }
  };
}

export function findUnexpectedConsoleOutputs(
  outputs: CapturedConsoleOutput[],
  allowlist: ConsoleOutputAllowlistEntry[],
): CapturedConsoleOutput[] {
  return outputs.filter(
    (output) =>
      !allowlist.some((entry) => {
        if (entry.method !== output.method) return false;

        if (
          entry.messageIncludes !== undefined &&
          !output.message.includes(entry.messageIncludes)
        ) {
          return false;
        }

        if (
          entry.messagePattern !== undefined &&
          !entry.messagePattern.test(output.message)
        ) {
          return false;
        }

        if (
          entry.testNameIncludes !== undefined &&
          !output.testName?.includes(entry.testNameIncludes)
        ) {
          return false;
        }

        return true;
      }),
  );
}

const recordConsoleOutput =
  (method: CapturedConsoleMethod) =>
  (...args: unknown[]): void => {
    capturedConsoleOutputs.push({
      method,
      args,
      message: formatConsoleMessage(args),
      testName: expect.getState().currentTestName,
    });
  };

const createConsoleMock = (method: CapturedConsoleMethod) =>
  vi.fn(recordConsoleOutput(method));

const assertNoUnexpectedConsoleOutput = (): void => {
  const unexpected = findUnexpectedConsoleOutputs(capturedConsoleOutputs, [
    ...CONSOLE_OUTPUT_ALLOWLIST,
    ...runtimeConsoleOutputAllowlist,
  ]);

  if (unexpected.length === 0) return;

  const details = unexpected
    .map(
      (output) =>
        `[${output.method}] ${output.testName ?? "未知測試"}: ${output.message}`,
    )
    .join("\n");

  throw new Error(`測試期間出現未預期的 console 輸出：\n${details}`);
};

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

// Mock console.warn 和 console.error，並在 afterEach 檢查未預期輸出
console.warn = createConsoleMock("warn");
console.error = createConsoleMock("error");

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
  capturedConsoleOutputs.length = 0;
  runtimeConsoleOutputAllowlist.length = 0;
  console.warn = createConsoleMock("warn");
  console.error = createConsoleMock("error");
});

afterEach(() => {
  try {
    assertNoUnexpectedConsoleOutput();
  } finally {
    capturedConsoleOutputs.length = 0;
    runtimeConsoleOutputAllowlist.length = 0;
    console.warn = createConsoleMock("warn");
    console.error = createConsoleMock("error");
  }
});
