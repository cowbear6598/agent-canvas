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

// 必須在任何可能使用 logger 的模組載入之前執行，且必須完全覆蓋 Logger 類別的所有方法
vi.mock("../../src/utils/logger.js", () => {
  class MockLogger {
    log(): void {}
    warn(): void {}
    error(): void {}
  }

  return {
    Logger: MockLogger,
    logger: new MockLogger(),
  };
});

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
