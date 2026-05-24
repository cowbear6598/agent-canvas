import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";

import { config } from "../../src/config/index.js";
import { repositoryService } from "../../src/services/repositoryService.js";

// 驗證移除 worktree 概念後，repositoryService 的核心 API 不再讀寫 parentRepoId / branchName。
describe("repositoryService（worktree 概念移除後的最小行為）", () => {
  beforeEach(async () => {
    await fs.mkdir(config.repositoriesRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs
      .rm(config.repositoriesRoot, { recursive: true, force: true })
      .catch(() => undefined);
    await fs.mkdir(config.repositoriesRoot, { recursive: true });
  });

  it("create 後可在 list 中看到該 repository（不含 parentRepoId / branchName 欄位）", async () => {
    const name = `repo-test-${Date.now()}`;
    const created = await repositoryService.create(name);

    expect(created.id).toBe(name);
    expect(created.name).toBe(name);

    const list = await repositoryService.list();
    const found = list.find((r) => r.id === name);
    expect(found).toBeDefined();
    expect(found!.name).toBe(name);
    // 確保已移除的欄位不再出現於回傳結構
    expect("parentRepoId" in (found as Record<string, unknown>)).toBe(false);
    expect("branchName" in (found as Record<string, unknown>)).toBe(false);
  });

  it("list 應排除 workflow run repo 目錄", async () => {
    const repositoryId = `repo-list-${Date.now()}`;
    const runRepositoryId = `${repositoryId}-agnet-canvas-run-1`;
    await repositoryService.create(repositoryId);
    await fs.mkdir(path.join(config.repositoriesRoot, runRepositoryId), {
      recursive: true,
    });

    const list = await repositoryService.list();

    expect(list.map((r) => r.id)).toContain(repositoryId);
    expect(list.map((r) => r.id)).not.toContain(runRepositoryId);
  });

  it("registerMetadata 後 getMetadata 應只回傳 currentBranch 欄位", async () => {
    const name = `repo-meta-${Date.now()}`;
    await repositoryService.create(name);

    await repositoryService.registerMetadata(name, {
      currentBranch: "main",
    });

    const metadata = repositoryService.getMetadata(name);
    expect(metadata).toBeDefined();
    expect(metadata!.currentBranch).toBe("main");
    expect("parentRepoId" in (metadata as Record<string, unknown>)).toBe(false);
    expect("branchName" in (metadata as Record<string, unknown>)).toBe(false);
  });

  it("getRepositoryPath 對含 .. 字串的 repositoryId 應拋錯（路徑越界保護）", () => {
    expect(() => repositoryService.getRepositoryPath("..evil")).toThrow();
    expect(() =>
      repositoryService.getRepositoryPath("normal/../escape"),
    ).toThrow();
  });
});
