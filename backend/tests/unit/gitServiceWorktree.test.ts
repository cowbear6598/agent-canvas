// 必須在 import 前 mock，避免 simple-git 真實執行 git 命令
const mockRaw = vi.fn();
const mockGit = { raw: mockRaw };

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    repositoriesRoot: "/test/repos",
    gitlabUrl: undefined,
    githubToken: undefined,
    gitlabToken: undefined,
  },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { gitService } from "../../src/services/workspace/gitService.js";

describe("GitService — createDetachedWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成功建立 detached HEAD worktree", async () => {
    mockRaw.mockResolvedValue("");

    const result = await gitService.createDetachedWorktree(
      "/test/repos/my-repo",
      "/test/repos/my-repo-run-123-pod-abc",
    );

    expect(result.success).toBe(true);
    expect(mockRaw).toHaveBeenCalledWith([
      "worktree",
      "add",
      "--detach",
      "/test/repos/my-repo-run-123-pod-abc",
      "HEAD",
    ]);
  });

  it("worktree 路徑不在 repositoriesRoot 內時回傳錯誤", async () => {
    const result = await gitService.createDetachedWorktree(
      "/test/repos/my-repo",
      "/other/path/worktree",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("無效的 worktree 路徑");
    expect(mockRaw).not.toHaveBeenCalled();
  });
});
