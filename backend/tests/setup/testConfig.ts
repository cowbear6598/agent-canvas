import path from "path";
import os from "os";

// 增加 EventEmitter 的 max listeners 限制，避免測試中的警告
// 每個測試都會建立 socket 連線，導致 listeners 累積
process.setMaxListeners(50);

// 必須在最早期就執行
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};

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

// integration test 透過 vi.mock 攔截 SDK 的 query()，但 d2d1cf6a 之後 runClaudeQuery
// 會在呼叫 query() 之前先解析 claude 沙箱可執行檔路徑（resolveClaudeExecutablePath →
// getClaudeCodePath → Bun.which('claude')）。CI runner 沒裝 claude CLI 時會 throw，
// 整個 chat 路徑根本走不到 mock。這裡跟既有 unit / provider 測試一致，回傳固定假路徑。
vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: () => "/usr/local/bin/claude",
}));

const timestamp = Date.now();

export interface TestConfig {
  port: number;
  nodeEnv: string;
  appDataRoot: string;
  canvasRoot: string;
  repositoriesRoot: string;
  corsOrigin: string;
  githubToken?: string;
  skillsPath: string;
  agentsPath: string;
  commandsPath: string;
}

const testRoot = path.join(os.tmpdir(), `test-canvas-${timestamp}`);

export const testConfig: TestConfig = {
  port: 0, // 動態分配 port
  nodeEnv: "test",
  appDataRoot: testRoot,
  canvasRoot: path.join(testRoot, "canvas"),
  repositoriesRoot: path.join(testRoot, "repositories"),
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
