import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { $ } from "bun";
import { gitService } from "../../src/services/workspace/gitService.js";
import { config } from "../../src/config/index.js";
import { cleanupRepo } from "../helpers/gitTestHelper.js";

// vi.mock 為 ESM 模組級攔截：預設委派到真實 simple-git，
// 個別測試可透過 simpleGitOverride.impl 切換為自定義 mock。
const { simpleGitOverride } = vi.hoisted(() => ({
  simpleGitOverride: {
    impl: null as ((basePath?: string) => unknown) | null,
  },
}));

vi.mock("simple-git", async () => {
  const actual =
    await vi.importActual<typeof import("simple-git")>("simple-git");
  return {
    ...actual,
    simpleGit: (basePath?: string) => {
      if (simpleGitOverride.impl) {
        return simpleGitOverride.impl(basePath);
      }
      return actual.simpleGit(basePath);
    },
  };
});

// ─── 成功流程：createLocalClone 使用真實檔案系統 ──────────────────────────

describe("GitService — createLocalClone（成功流程）", () => {
  let bareRemoteDir: string;
  let sourceRepoDir: string;
  let runDir: string;

  beforeEach(async () => {
    // bareRemoteDir 扮演「真實遠端 origin」
    bareRemoteDir = path.join(
      os.tmpdir(),
      `clone-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // sourceRepoDir 扮演「主 repo（workspace）」，其 origin 指向 bareRemoteDir
    sourceRepoDir = path.join(
      os.tmpdir(),
      `clone-source-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // runDir 必須在 config.repositoriesRoot 內，才能通過安全檢查
    runDir = path.join(
      config.repositoriesRoot,
      `run-clone-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    // 建立 bare remote
    await $`git init --bare ${bareRemoteDir}`.quiet();

    // 建立 source repo，設定 origin 並 push initial commit
    await $`git init ${sourceRepoDir}`.quiet();
    await $`git -C ${sourceRepoDir} config user.email "test@example.com"`.quiet();
    await $`git -C ${sourceRepoDir} config user.name "Test User"`.quiet();
    await $`echo "hello" > ${sourceRepoDir}/README.md`.quiet();
    await $`git -C ${sourceRepoDir} add .`.quiet();
    await $`git -C ${sourceRepoDir} commit -m "init"`.quiet();
    await $`git -C ${sourceRepoDir} remote add origin ${bareRemoteDir}`.quiet();
    await $`git -C ${sourceRepoDir} push -u origin HEAD`.quiet();

    // 確保 runDir 父目錄存在（config.repositoriesRoot 由 testConfig.ts 指向 tmpdir 子目錄）
    await fs.mkdir(config.repositoriesRoot, { recursive: true });
  });

  afterEach(async () => {
    await cleanupRepo(bareRemoteDir);
    await cleanupRepo(sourceRepoDir);
    await cleanupRepo(runDir);
  });

  it("對含 origin 的 source repo 呼叫 createLocalClone，runDir 應存在 .git", async () => {
    const result = await gitService.createLocalClone(sourceRepoDir, runDir);

    expect(result.success).toBe(true);

    // 驗證 runDir 內有 .git（代表是合法的 git repo）
    const gitDirStat = await fs
      .stat(path.join(runDir, ".git"))
      .catch(() => null);
    expect(gitDirStat).not.toBeNull();
  });

  it("clone 後 runDir 的 origin URL 應指向 source repo 的 origin URL（非 sourceRepoPath）", async () => {
    const result = await gitService.createLocalClone(sourceRepoDir, runDir);

    expect(result.success).toBe(true);

    // 取得 runDir 的 origin URL
    const originUrl = await $`git -C ${runDir} remote get-url origin`
      .quiet()
      .text();

    // 應等於 bareRemoteDir（source repo 的 origin），而非 sourceRepoDir
    expect(originUrl.trim()).toBe(bareRemoteDir);
    expect(originUrl.trim()).not.toBe(sourceRepoDir);
  });
});

// ─── 安全檢查：runDir 不在 repositoriesRoot 內 ────────────────────────────

describe("GitService — createLocalClone（安全檢查）", () => {
  it("runDir 位於 config.repositoriesRoot 之外時應回傳 err", async () => {
    const outsideRunDir = path.join(os.tmpdir(), `outside-run-${Date.now()}`);

    const result = await gitService.createLocalClone(
      "/some/source/repo",
      outsideRunDir,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("runDir 路徑不在允許的範圍內");
  });
});

// ─── syncToRemoteLatest：per-repo 並發去重 ───────────────────────────────

describe("GitService — syncToRemoteLatest（並發去重）", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 模擬輕微延遲以驗證並發情境下去重效果
    mockFetch = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<string>((resolve) => setTimeout(() => resolve(""), 20)),
      );

    const mockGetRemotes = vi
      .fn()
      .mockResolvedValue([{ name: "origin", refs: {} }]);

    simpleGitOverride.impl = () =>
      ({
        fetch: mockFetch,
        getRemotes: mockGetRemotes,
      }) as unknown as ReturnType<typeof import("simple-git").simpleGit>;
  });

  afterEach(() => {
    simpleGitOverride.impl = null;
  });

  it("同一 workspacePath 並發呼叫 3 次，底層 fetch 只被觸發 1 次", async () => {
    const workspacePath = path.join(config.repositoriesRoot, "dedup-test-repo");

    // 並發呼叫 3 次
    const results = await Promise.all([
      gitService.syncToRemoteLatest(workspacePath),
      gitService.syncToRemoteLatest(workspacePath),
      gitService.syncToRemoteLatest(workspacePath),
    ]);

    // 3 次都應該回傳 success（共用同一個 Promise）
    for (const result of results) {
      expect(result.success).toBe(true);
    }

    // 底層 fetch 只應被呼叫 1 次（去重機制）
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── syncToRemoteLatest：fetch all 且不執行 reset --hard ─────────────────

describe("GitService — syncToRemoteLatest（fetch all，不 reset）", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockReset: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue("");
    mockReset = vi.fn().mockResolvedValue("");

    const mockGetRemotes = vi
      .fn()
      .mockResolvedValue([{ name: "origin", refs: {} }]);

    simpleGitOverride.impl = () =>
      ({
        fetch: mockFetch,
        reset: mockReset,
        getRemotes: mockGetRemotes,
      }) as unknown as ReturnType<typeof import("simple-git").simpleGit>;
  });

  afterEach(() => {
    simpleGitOverride.impl = null;
  });

  it("底層執行的是 git fetch origin --prune，且不執行 reset --hard", async () => {
    const workspacePath = path.join(
      config.repositoriesRoot,
      "fetch-all-test-repo",
    );

    const result = await gitService.syncToRemoteLatest(workspacePath);

    expect(result.success).toBe(true);

    // 驗證 fetch 以正確參數被呼叫（fetch origin --prune）
    expect(mockFetch).toHaveBeenCalledWith(["origin", "--prune"]);

    // 驗證 reset 從未被呼叫（不修改工作樹）
    expect(mockReset).not.toHaveBeenCalled();
  });
});

// ─── getLocalBranches：回傳值不含 worktreeBranches ───────────────────────

describe("GitService — getLocalBranches（不含 worktreeBranches 欄位）", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = path.join(
      os.tmpdir(),
      `local-branches-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await $`git init ${repoDir}`.quiet();
    await $`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await $`git -C ${repoDir} config user.name "Test User"`.quiet();
    await $`echo "test" > ${repoDir}/README.md`.quiet();
    await $`git -C ${repoDir} add .`.quiet();
    await $`git -C ${repoDir} commit -m "init"`.quiet();
  });

  afterEach(async () => {
    await cleanupRepo(repoDir);
  });

  it("回傳值應含 branches 與 current 欄位，且不含 worktreeBranches 欄位", async () => {
    const result = await gitService.getLocalBranches(repoDir);

    expect(result.success).toBe(true);

    const data = result.data;

    // 確認有 branches 與 current 欄位
    expect(Array.isArray(data.branches)).toBe(true);
    expect(typeof data.current).toBe("string");

    // 確認不含 worktreeBranches 欄位
    expect("worktreeBranches" in data).toBe(false);
  });
});
