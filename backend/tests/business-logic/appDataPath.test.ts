import path from "path";
import { describe, expect, it } from "vitest";
import {
  APP_DATA_ROOT_ENV_NAME,
  CANVAS_DB_FILE_NAME,
  getDefaultAppDataRoot,
  resolveAppDataPaths,
  resolveAppDataRoot,
} from "../../src/config/appDataPath.js";

describe("appDataPath", () => {
  it("有設定 override 時應優先使用指定的 app data root", () => {
    const overrideRoot = "/tmp/AgentCanvas Dev";

    const result = resolveAppDataRoot({
      env: {
        [APP_DATA_ROOT_ENV_NAME]: `  ${overrideRoot}  `,
      },
      homeDir: "/Users/tester",
    });

    expect(result).toBe(overrideRoot);
  });

  it("有設定相對路徑 override 時應正規化成絕對路徑", () => {
    const result = resolveAppDataRoot({
      env: {
        [APP_DATA_ROOT_ENV_NAME]: "./tmp/dev-agent-canvas",
      },
      cwd: "/Users/tester/project",
      homeDir: "/Users/tester",
    });

    expect(result).toBe("/Users/tester/project/tmp/dev-agent-canvas");
  });

  it("未設定 override 時應回退到正式版預設資料根目錄", () => {
    const homeDir = "/Users/tester";

    expect(getDefaultAppDataRoot(homeDir)).toBe(
      path.join(homeDir, "Documents", "AgentCanvas"),
    );
    expect(resolveAppDataRoot({ env: {}, homeDir })).toBe(
      path.join(homeDir, "Documents", "AgentCanvas"),
    );
  });

  it("應從 app data root 衍生 canvas.db 路徑", () => {
    const appDataRoot = "/tmp/agent-canvas-dev";

    const result = resolveAppDataPaths({
      env: {
        [APP_DATA_ROOT_ENV_NAME]: appDataRoot,
      },
      homeDir: "/Users/tester",
    });

    expect(result).toEqual({
      appDataRoot,
      canvasDbPath: path.join(appDataRoot, CANVAS_DB_FILE_NAME),
    });
  });
});
