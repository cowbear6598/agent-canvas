import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// mock simple-git 以避免真實 git 操作
const mockGit = {
  checkIsRepo: vi.fn(),
  init: vi.fn(),
  addConfig: vi.fn(),
};

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
}));

// mock buildAuthenticatedUrl
vi.mock("../../src/services/workspace/gitService.js", () => ({
  buildAuthenticatedUrl: vi.fn((url: string) => url),
}));

// mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

// mock config（先佔位，實際 backupDir 在測試中透過 as any 替換）
vi.mock("../../src/config/index.js", () => ({
  config: {
    appDataRoot: "/mock/data",
  },
}));

// 在所有 mock 設置後才 import
const { backupService } = await import("../../src/services/backupService.js");

describe("BackupService — ensureGitignore", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 建立唯一暫存目錄
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "backup-gitignore-test-"));
    // 替換 singleton 的 backupDir 指向暫存目錄
    (backupService as unknown as Record<string, unknown>).backupDir = tmpDir;
    // initRepo 需要 git mock
    mockGit.checkIsRepo.mockResolvedValue(true);
  });

  afterEach(async () => {
    // 清理暫存目錄
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it(".gitignore 不存在時建立並包含 encryption.key", async () => {
    const result = await backupService.initRepo();

    expect(result.success).toBe(true);

    const gitignorePath = path.join(tmpDir, ".gitignore");
    const content = await fs.readFile(gitignorePath, "utf-8");
    expect(content).toContain("encryption.key");
  });

  it(".gitignore 已存在但缺少 encryption.key 時追加", async () => {
    const gitignorePath = path.join(tmpDir, ".gitignore");
    await fs.writeFile(gitignorePath, "node_modules\n", "utf-8");

    const result = await backupService.initRepo();

    expect(result.success).toBe(true);

    const content = await fs.readFile(gitignorePath, "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain("encryption.key");
  });

  it(".gitignore 已包含 encryption.key 時不重複追加", async () => {
    const gitignorePath = path.join(tmpDir, ".gitignore");
    const originalContent = "node_modules\nencryption.key\n";
    await fs.writeFile(gitignorePath, originalContent, "utf-8");

    const result = await backupService.initRepo();

    expect(result.success).toBe(true);

    const content = await fs.readFile(gitignorePath, "utf-8");
    // 確認內容沒有變化（不重複加入）
    expect(content).toBe(originalContent);
    // 確認只出現一次
    const occurrences = content.split("encryption.key").length - 1;
    expect(occurrences).toBe(1);
  });

  it(".gitignore 最後一行無換行時正確追加（前面有換行符）", async () => {
    const gitignorePath = path.join(tmpDir, ".gitignore");
    // 無尾部換行
    await fs.writeFile(gitignorePath, "node_modules", "utf-8");

    const result = await backupService.initRepo();

    expect(result.success).toBe(true);

    const content = await fs.readFile(gitignorePath, "utf-8");
    // 確認 encryption.key 前面有換行
    expect(content).toContain("node_modules\nencryption.key");
  });
});
