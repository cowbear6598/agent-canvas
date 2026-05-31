vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { scanAndCleanupOrphanRunRepoDirectories } from "../../src/services/runtime/orphanRunRepoScanner.js";
import { runStore } from "../../src/services/runStore.js";
import { logger } from "../../src/utils/logger.js";
import { config } from "../../src/config/index.js";
import { initTestDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

const mockWarn = vi.mocked(logger.warn);
const mockLog = vi.mocked(logger.log);
const CANVAS_ID = "canvas-orphan-scan";
const SOURCE_POD_ID = "pod-orphan-source";

describe("scanAndCleanupOrphanRunRepoDirectories", () => {
  let tmpDir: string;
  let originalRunRepositoriesRoot: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `orphan-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });

    originalRunRepositoriesRoot = config.runRepositoriesRoot;
    Object.assign(config, { runRepositoriesRoot: tmpDir });

    resetStatements();
    initTestDb();
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
      )
      .run(CANVAS_ID, CANVAS_ID, 0);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    Object.assign(config, { runRepositoriesRoot: originalRunRepositoriesRoot });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("存在兩個符合命名的目錄，getRunningRuns 只回傳其中一個 runId → 刪除孤兒目錄並保留 active run 目錄", async () => {
    const runningRun = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
    const completedRun = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "done");
    const runningDir = path.join(tmpDir, `repo1-agnet-canvas-${runningRun.id}`);
    const orphanDir = path.join(tmpDir, `repo1-agnet-canvas-${completedRun.id}`);
    runStore.updateRunStatus(completedRun.id, "completed");
    await fs.mkdir(runningDir);
    await fs.mkdir(orphanDir);

    await scanAndCleanupOrphanRunRepoDirectories();

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      "Run",
      "Orphan",
      `偵測到孤兒 run 隔離目錄：${orphanDir}`,
    );
    await expect(fs.access(runningDir)).resolves.toBeNull();
    await expect(fs.access(orphanDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("目錄內沒有任何符合命名格式的資料夾 → 完全不 warn", async () => {
    await fs.mkdir(path.join(tmpDir, "repo1"));
    await fs.mkdir(path.join(tmpDir, "some-random-folder"));

    await scanAndCleanupOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("命名不符合 pattern 的資料夾（如 repo1、some-random-folder）→ 完全不 warn", async () => {
    await fs.mkdir(path.join(tmpDir, "repo1"));
    await fs.mkdir(path.join(tmpDir, "some-random-folder"));
    await fs.mkdir(path.join(tmpDir, "norun-here"));

    await scanAndCleanupOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("run repo 命名的 repositoryId 或 runId 不完整時 → 完全不 warn", async () => {
    await fs.mkdir(path.join(tmpDir, "repo-agnet-canvas-"));
    await fs.mkdir(path.join(tmpDir, "-agnet-canvas-id"));

    await scanAndCleanupOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("符合命名但不是目錄的 entry → 不視為孤兒清理目標", async () => {
    const orphanFilePath = path.join(tmpDir, "repo1-agnet-canvas-orphan-file");
    await fs.writeFile(orphanFilePath, "test");

    await scanAndCleanupOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
    await expect(fs.readFile(orphanFilePath, "utf8")).resolves.toBe("test");
  });
});
