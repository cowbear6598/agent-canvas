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
import { scanAndLogOrphanRunRepoDirectories } from "../../src/services/runtime/orphanRunRepoScanner.js";
import { runStore } from "../../src/services/runStore.js";
import { logger } from "../../src/utils/logger.js";
import { config } from "../../src/config/index.js";
import { initTestDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

const mockWarn = vi.mocked(logger.warn);
const CANVAS_ID = "canvas-orphan-scan";
const SOURCE_POD_ID = "pod-orphan-source";

describe("scanAndLogOrphanRunRepoDirectories", () => {
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

  it("存在兩個符合命名的目錄，getRunningRuns 只回傳其中一個 runId → 只 warn 另一個為孤兒", async () => {
    const runningRun = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
    const completedRun = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "done");
    runStore.updateRunStatus(completedRun.id, "completed");
    await fs.mkdir(path.join(tmpDir, `repo1-agnet-canvas-${runningRun.id}`));
    await fs.mkdir(path.join(tmpDir, `repo1-agnet-canvas-${completedRun.id}`));

    await scanAndLogOrphanRunRepoDirectories();

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      "Run",
      "Orphan",
      `偵測到孤兒 run 隔離目錄：${path.join(tmpDir, `repo1-agnet-canvas-${completedRun.id}`)}`,
    );
  });

  it("目錄內沒有任何符合命名格式的資料夾 → 完全不 warn", async () => {
    await fs.mkdir(path.join(tmpDir, "repo1"));
    await fs.mkdir(path.join(tmpDir, "some-random-folder"));

    await scanAndLogOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("命名不符合 pattern 的資料夾（如 repo1、some-random-folder）→ 完全不 warn", async () => {
    await fs.mkdir(path.join(tmpDir, "repo1"));
    await fs.mkdir(path.join(tmpDir, "some-random-folder"));
    await fs.mkdir(path.join(tmpDir, "norun-here"));

    await scanAndLogOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("run repo 命名的 repositoryId 或 runId 不完整時 → 完全不 warn", async () => {
    await fs.mkdir(path.join(tmpDir, "repo-agnet-canvas-"));
    await fs.mkdir(path.join(tmpDir, "-agnet-canvas-id"));

    await scanAndLogOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
