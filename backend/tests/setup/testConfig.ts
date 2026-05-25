import path from "path";
import { fileURLToPath } from "node:url";

const TEST_MAX_EVENT_LISTENERS = 50;

// 增加 EventEmitter 的 max listeners 限制，避免測試中的警告
// 每個測試都會建立 socket 連線，導致 listeners 累積
process.setMaxListeners(TEST_MAX_EVENT_LISTENERS);

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

// 既有測試允許保留的合法 console warning/error 來源集中列在這裡。
// 若新增預期輸出，請優先在測試中用 assertion 驗證；只有共用 helper 的背景輸出才加入 allowlist。
const CONSOLE_OUTPUT_ALLOWLIST: ConsoleOutputAllowlistEntry[] = [
  {
    method: "error",
    messageIncludes: "Failed to parse message:",
  },
];

const capturedConsoleOutputs: CapturedConsoleOutput[] = [];
const runtimeConsoleOutputAllowlist: ConsoleOutputAllowlistEntry[] = [];

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
        if (entry.method !== output.method) {
          return false;
        }

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
    const testName = expect.getState().currentTestName;
    capturedConsoleOutputs.push({
      method,
      args,
      message: formatConsoleMessage(args),
      testName,
    });
  };

const assertNoUnexpectedConsoleOutput = (): void => {
  const unexpected = findUnexpectedConsoleOutputs(capturedConsoleOutputs, [
    ...CONSOLE_OUTPUT_ALLOWLIST,
    ...runtimeConsoleOutputAllowlist,
  ]);

  if (unexpected.length === 0) {
    return;
  }

  const details = unexpected
    .map(
      (output) =>
        `[${output.method}] ${output.testName ?? "未知測試"}: ${output.message}`,
    )
    .join("\n");

  throw new Error(`測試期間出現未預期的 console 輸出：\n${details}`);
};

// 必須在最早期就執行。warn/error 會被 capture，未列入 allowlist 會讓測試失敗。
console.log = () => {};
console.error = recordConsoleOutput("error");
console.warn = recordConsoleOutput("warn");
console.info = () => {};
console.debug = () => {};

beforeEach(() => {
  capturedConsoleOutputs.length = 0;
  runtimeConsoleOutputAllowlist.length = 0;
  console.error = recordConsoleOutput("error");
  console.warn = recordConsoleOutput("warn");
});

afterEach(() => {
  try {
    assertNoUnexpectedConsoleOutput();
  } finally {
    capturedConsoleOutputs.length = 0;
    runtimeConsoleOutputAllowlist.length = 0;
    console.error = recordConsoleOutput("error");
    console.warn = recordConsoleOutput("warn");
  }
});

// 必須在任何可能使用 logger 的模組載入之前執行
// 透過 importOriginal 保留真實模組的所有 named export（例如純函式 sanitizeSensitiveInfo），
// 只覆寫會產生副作用的 Logger 類別與 logger 實例，避免測試輸出被污染
vi.mock("../../src/utils/logger.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/logger.js")>();

  class MockLogger {
    log(): void {}
    warn(): void {}
    error(): void {}
  }

  return {
    ...actual,
    Logger: MockLogger,
    logger: new MockLogger(),
  };
});

// integration test 透過 vi.mock 攔截 SDK 的 query()，但 runClaudeQuery 會在呼叫
// query() 之前先解析 claude 可執行檔路徑（getClaudeCodePath → Bun.which('claude')）。
// CI runner 沒裝 claude CLI 時會 throw，整個 chat 路徑根本走不到 mock。
// 這裡跟既有 unit / provider 測試一致，回傳固定假路徑。
vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: () => "/usr/local/bin/claude",
}));

const timestamp = Date.now();
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export interface TestConfig {
  port: number;
  nodeEnv: string;
  appDataRoot: string;
  canvasRoot: string;
  repositoriesRoot: string;
  runRepositoriesRoot: string;
  pluginsRoot: string;
  tmpRoot: string;
  stagingRoot: string;
  corsOrigin: string;
  githubToken?: string;
  skillsPath: string;
  agentsPath: string;
  commandsPath: string;
}

export const AGENT_CANVAS_TEST_ROOT = path.resolve(
  repoRoot,
  "tmp",
  "AgentCanvas",
);

const testRoot = path.join(AGENT_CANVAS_TEST_ROOT, `test-canvas-${timestamp}`);

process.env.AGENT_CANVAS_APP_DATA_DIR = testRoot;

export const testConfig: TestConfig = {
  port: 0, // 動態分配 port
  nodeEnv: "test",
  appDataRoot: testRoot,
  canvasRoot: path.join(testRoot, "canvas"),
  repositoriesRoot: path.join(testRoot, "repositories"),
  runRepositoriesRoot: path.join(testRoot, "runtime", "run-repositories"),
  pluginsRoot: path.join(testRoot, "plugins"),
  tmpRoot: path.join(testRoot, "tmp"),
  stagingRoot: path.join(testRoot, "tmp", "staging"),
  corsOrigin: "http://localhost:5173",
  githubToken: undefined,
  skillsPath: path.join(testRoot, "skills"),
  agentsPath: path.join(testRoot, "agents"),
  commandsPath: path.join(testRoot, "commands"),
};

export async function overrideConfig(): Promise<void> {
  const configModule = await import("../../src/config/index.js");
  Object.assign(configModule.config, testConfig);

  configModule.config.getCanvasPath = function (canvasName: string): string {
    const canvasPath = path.join(testConfig.canvasRoot, canvasName);
    const resolvedPath = path.resolve(canvasPath);
    const resolvedRoot = path.resolve(testConfig.canvasRoot);

    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      throw new Error("無效的 canvas 名稱：偵測到路徑穿越");
    }

    return canvasPath;
  };

  configModule.config.getCanvasDataPath = function (
    canvasName: string,
  ): string {
    const canvasPath = path.join(testConfig.canvasRoot, canvasName, "data");
    const resolvedPath = path.resolve(canvasPath);
    const resolvedRoot = path.resolve(testConfig.canvasRoot);

    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      throw new Error("無效的 canvas 名稱：偵測到路徑穿越");
    }

    return canvasPath;
  };
}

// 在 setupFiles 階段立即覆寫，確保在任何測試模組載入之前就覆寫 config
const configModule = await import("../../src/config/index.js");
Object.assign(configModule.config, testConfig);

configModule.config.getCanvasPath = function (canvasName: string): string {
  const canvasPath = path.join(testConfig.canvasRoot, canvasName);
  const resolvedPath = path.resolve(canvasPath);
  const resolvedRoot = path.resolve(testConfig.canvasRoot);

  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("無效的 canvas 名稱：偵測到路徑穿越");
  }

  return canvasPath;
};

configModule.config.getCanvasDataPath = function (canvasName: string): string {
  const canvasPath = path.join(testConfig.canvasRoot, canvasName, "data");
  const resolvedPath = path.resolve(canvasPath);
  const resolvedRoot = path.resolve(testConfig.canvasRoot);

  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("無效的 canvas 名稱：偵測到路徑穿越");
  }

  return canvasPath;
};
