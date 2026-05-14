vi.mock("../../src/services/runStore.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/runStore.js")>();
  return {
    ...actual,
    runStore: {
      getRunningRuns: vi.fn(),
    },
  };
});

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

const mockGetRunningRuns = vi.mocked(runStore.getRunningRuns);
const mockWarn = vi.mocked(logger.warn);

describe("scanAndLogOrphanRunRepoDirectories", () => {
  let tmpDir: string;
  let originalRepositoriesRoot: string;

  beforeEach(async () => {
    // 建立暫存目錄作為 config.repositoriesRoot
    tmpDir = path.join(
      os.tmpdir(),
      `orphan-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });

    // 儲存並替換 config.repositoriesRoot
    originalRepositoriesRoot = config.repositoriesRoot;
    Object.assign(config, { repositoriesRoot: tmpDir });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // 還原 config.repositoriesRoot
    Object.assign(config, { repositoriesRoot: originalRepositoriesRoot });

    // 清理暫存目錄
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("存在兩個符合命名的目錄，getRunningRuns 只回傳其中一個 runId → 只 warn 另一個為孤兒", async () => {
    // 建立兩個符合命名格式的資料夾
    await fs.mkdir(path.join(tmpDir, "repo1-run-aaa"));
    await fs.mkdir(path.join(tmpDir, "repo1-run-bbb"));

    // runStore 只回傳 runId 為 aaa 的 run
    mockGetRunningRuns.mockReturnValue([
      {
        id: "aaa",
        canvasId: "canvas-1",
        sourcePodId: "pod-1",
        triggerMessage: "test",
        status: "running",
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    ]);

    await scanAndLogOrphanRunRepoDirectories();

    // 應只對 bbb 發出 warn
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      "Run",
      "Orphan",
      `偵測到孤兒 run 隔離目錄：${path.join(tmpDir, "repo1-run-bbb")}`,
    );
  });

  it("目錄內沒有任何符合命名格式的資料夾 → 完全不 warn", async () => {
    // 建立不符合命名的資料夾
    await fs.mkdir(path.join(tmpDir, "repo1"));
    await fs.mkdir(path.join(tmpDir, "some-random-folder"));

    mockGetRunningRuns.mockReturnValue([]);

    await scanAndLogOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("命名不符合 pattern 的資料夾（如 repo1、some-random-folder）→ 完全不 warn", async () => {
    await fs.mkdir(path.join(tmpDir, "repo1"));
    await fs.mkdir(path.join(tmpDir, "some-random-folder"));
    await fs.mkdir(path.join(tmpDir, "norun-here"));

    mockGetRunningRuns.mockReturnValue([]);

    await scanAndLogOrphanRunRepoDirectories();

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
