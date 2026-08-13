import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabaseHarness,
  createTestWorkspaceHarness,
  type TestDatabaseHarness,
  type TestWorkspaceHarness,
} from "../helpers";
import { config } from "../../src/config/index.js";
import { canvasStore } from "../../src/services/canvasStore.js";
import { workspaceService } from "../../src/services/workspace/index.js";

const originalCanvasConfig = {
  canvasRoot: config.canvasRoot,
  getCanvasPath: config.getCanvasPath,
};

describe("CanvasStore 與檔案系統整合", () => {
  let workspace: TestWorkspaceHarness;
  let database: TestDatabaseHarness;
  let canvasId: string;
  let canvasDirectory: string;

  beforeEach(async () => {
    workspace = await createTestWorkspaceHarness("canvas-store");
    config.canvasRoot = join(workspace.rootDir, "canvas");
    config.getCanvasPath = (canvasName: string): string =>
      join(config.canvasRoot, canvasName);
    database = await createTestDatabaseHarness(workspace.rootDir);

    const result = await canvasStore.create("canvas-store-test");
    if (!result.success) {
      throw new Error("建立測試 Canvas 失敗");
    }

    canvasId = result.data.id;
    canvasDirectory = config.getCanvasPath(result.data.name);
    await mkdir(canvasDirectory, { recursive: true });
    await writeFile(join(canvasDirectory, "artifact.txt"), "測試內容");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.cleanup();
    await workspace.cleanup();
    Object.assign(config, originalCanvasConfig);
  });

  it("刪除 Canvas 時會一併刪除整個資料夾", async () => {
    const result = await canvasStore.delete(canvasId);

    expect(result).toEqual({ success: true, data: true });
    expect(canvasStore.getById(canvasId)).toBeUndefined();
    expect(existsSync(canvasDirectory)).toBe(false);
  });

  it("資料夾刪除失敗時會保留 Canvas 資料庫紀錄", async () => {
    vi.spyOn(workspaceService, "deleteWorkspace").mockResolvedValue({
      success: false,
      error: "刪除工作區失敗：測試錯誤",
    });

    const result = await canvasStore.delete(canvasId);

    expect(result).toEqual({
      success: false,
      error: "刪除工作區失敗：測試錯誤",
    });
    expect(canvasStore.getById(canvasId)).toBeDefined();
    expect(existsSync(canvasDirectory)).toBe(true);
  });
});
