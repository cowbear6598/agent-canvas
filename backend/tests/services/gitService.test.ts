import { vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { $ } from "bun";
import {
  detectGitSource,
  buildAuthenticatedUrl,
  parseCloneErrorMessage,
  extractDomainFromUrl,
  getPullLatestError,
  gitService,
} from "../../src/services/workspace/gitService";
import { ok, err } from "../../src/types";
import { config } from "../../src/config";
import { initGitRepo, cleanupRepo } from "../helpers/gitTestHelper";

// ─── 純邏輯函式（不需要 git CLI） ──────────────────────────────────────────

describe("GitService - Git 來源偵測與認證", () => {
  describe("extractDomainFromUrl", () => {
    it("從 HTTPS URL 提取域名", () => {
      expect(extractDomainFromUrl("https://github.com/user/repo.git")).toBe(
        "github.com",
      );
      expect(extractDomainFromUrl("https://gitlab.com/user/repo.git")).toBe(
        "gitlab.com",
      );
      expect(
        extractDomainFromUrl("https://gitlab.example.com/user/repo.git"),
      ).toBe("gitlab.example.com");
    });

    it("從 HTTP URL 提取域名", () => {
      expect(extractDomainFromUrl("http://github.com/user/repo.git")).toBe(
        "github.com",
      );
    });

    it("從 SSH URL 提取域名", () => {
      expect(extractDomainFromUrl("git@github.com:user/repo.git")).toBe(
        "github.com",
      );
      expect(extractDomainFromUrl("git@gitlab.com:user/repo.git")).toBe(
        "gitlab.com",
      );
      expect(extractDomainFromUrl("git@gitlab.example.com:user/repo.git")).toBe(
        "gitlab.example.com",
      );
    });

    it("無法解析的 URL 返回空字串", () => {
      expect(extractDomainFromUrl("invalid-url")).toBe("");
      expect(extractDomainFromUrl("")).toBe("");
    });
  });

  describe("detectGitSource", () => {
    it("偵測 GitHub HTTPS URL", () => {
      expect(detectGitSource("https://github.com/user/repo.git")).toBe(
        "github",
      );
    });

    it("偵測 GitHub SSH URL", () => {
      expect(detectGitSource("git@github.com:user/repo.git")).toBe("github");
    });

    it("偵測 GitLab.com HTTPS URL", () => {
      expect(detectGitSource("https://gitlab.com/user/repo.git")).toBe(
        "gitlab",
      );
    });

    it("偵測 GitLab.com SSH URL", () => {
      expect(detectGitSource("git@gitlab.com:user/repo.git")).toBe("gitlab");
    });

    it("偵測 Self-hosted GitLab URL", () => {
      if (config.gitlabUrl) {
        const url = `${config.gitlabUrl}/user/repo.git`;
        expect(detectGitSource(url)).toBe("gitlab");
      }
    });

    it("偵測其他 Git 服務", () => {
      expect(detectGitSource("https://bitbucket.org/user/repo.git")).toBe(
        "other",
      );
      expect(detectGitSource("https://example.com/user/repo.git")).toBe(
        "other",
      );
    });
  });

  describe("buildAuthenticatedUrl", () => {
    // 保留 vi.spyOn：測試目的是驗證「不同 token 環境下的 URL 組裝格式」，
    // 與真 git repo 無關，mock config getter 是唯一可靠方式
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("GitHub Token 注入格式正確", () => {
      vi.spyOn(config, "githubToken", "get").mockReturnValue("ghp_test123");

      const url = "https://github.com/user/repo.git";
      const result = buildAuthenticatedUrl(url);

      expect(result).toContain("ghp_test123");
      expect(result).toContain("@github.com");
      expect(result).toMatch(/^https:\/\/.*@github\.com\//);
    });

    it("GitLab.com Token 注入格式正確", () => {
      vi.spyOn(config, "githubToken", "get").mockReturnValue(undefined);
      vi.spyOn(config, "gitlabToken", "get").mockReturnValue("glpat_test456");

      const url = "https://gitlab.com/user/repo.git";
      const result = buildAuthenticatedUrl(url);

      expect(result).toContain("oauth2");
      expect(result).toContain("glpat_test456");
      expect(result).toContain("@gitlab.com");
      expect(result).toMatch(/^https:\/\/oauth2:.*@gitlab\.com\//);
    });

    it("Self-hosted GitLab Token 注入格式正確", () => {
      vi.spyOn(config, "githubToken", "get").mockReturnValue(undefined);
      vi.spyOn(config, "gitlabToken", "get").mockReturnValue(
        "glpat_selfhosted",
      );
      vi.spyOn(config, "gitlabUrl", "get").mockReturnValue(
        "https://gitlab.example.com",
      );

      const url = "https://gitlab.example.com/user/repo.git";
      const result = buildAuthenticatedUrl(url);

      expect(result).toContain("oauth2");
      expect(result).toContain("glpat_selfhosted");
    });

    it("無 Token 時返回原始 URL", () => {
      vi.spyOn(config, "githubToken", "get").mockReturnValue(undefined);
      vi.spyOn(config, "gitlabToken", "get").mockReturnValue(undefined);

      const url = "https://bitbucket.org/user/repo.git";
      const result = buildAuthenticatedUrl(url);

      expect(result).toBe(url);
    });

    it("非 HTTPS 格式返回原始 URL", () => {
      const sshUrl = "git@github.com:user/repo.git";
      const result = buildAuthenticatedUrl(sshUrl);

      expect(result).toBe(sshUrl);
    });
  });

  describe("parseCloneErrorMessage", () => {
    it("認證失敗錯誤訊息", () => {
      const error = new Error("Authentication failed");
      const result = parseCloneErrorMessage(error, "github");

      expect(result).toBe("認證失敗，請檢查 Token 是否正確");
    });

    it("倉庫不存在錯誤訊息", () => {
      const error = new Error("Repository not found");
      const result = parseCloneErrorMessage(error, "github");

      expect(result).toBe("找不到指定的倉庫");
    });

    it("無法讀取使用者名稱 - GitHub", () => {
      const error = new Error("could not read Username");
      const result = parseCloneErrorMessage(error, "github");

      expect(result).toBe("無法存取私有倉庫，請設定 GITHUB_TOKEN");
    });

    it("無法讀取使用者名稱 - GitLab", () => {
      const error = new Error("could not read Username");
      const result = parseCloneErrorMessage(error, "gitlab");

      expect(result).toBe("無法存取私有倉庫，請設定 GITLAB_TOKEN");
    });

    it("無法讀取使用者名稱 - 其他", () => {
      const error = new Error("could not read Username");
      const result = parseCloneErrorMessage(error, "other");

      expect(result).toBe("無法存取私有倉庫，請設定對應的 Token");
    });

    it("通用錯誤訊息", () => {
      const error = new Error("Some other error");
      const result = parseCloneErrorMessage(error, "github");

      expect(result).toBe("複製儲存庫失敗");
    });

    it("處理非 Error 物件", () => {
      const result = parseCloneErrorMessage("string error", "github");

      expect(result).toBe("複製儲存庫失敗");
    });
  });

  describe("getPullLatestError", () => {
    it("包含 'Could not resolve host' 回傳無法連線訊息", () => {
      const result = getPullLatestError("Could not resolve host: github.com");

      expect(result).toBe("無法連線至遠端伺服器");
    });

    it("包含 'Network error' 回傳無法連線訊息", () => {
      const result = getPullLatestError("Network error occurred");

      expect(result).toBe("無法連線至遠端伺服器");
    });

    it('包含 "couldn\'t find remote ref" 回傳遠端分支不存在訊息', () => {
      const result = getPullLatestError("couldn't find remote ref main");

      expect(result).toBe("遠端分支不存在");
    });

    it("其他未知錯誤回傳預設失敗訊息", () => {
      const result = getPullLatestError("Some unknown git error");

      expect(result).toBe("Pull 至最新版本失敗");
    });
  });
});

// ─── clone 路徑驗證（純邊界邏輯，不需要真 git） ──────────────────────────

describe("GitService - clone 路徑驗證", () => {
  it("targetPath 在允許範圍外時應回傳錯誤，不執行 git clone", async () => {
    // /tmp 不在 config.repositoriesRoot 內，驗證 path boundary 邏輯
    const outsidePath = path.join(os.tmpdir(), "outside-repo");
    const result = await gitService.clone(
      "https://github.com/user/repo.git",
      outsidePath,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("目標路徑不在允許的範圍內");
  });
});

// ─── fetchRemoteBranch 分支名驗證（純邏輯，不需要真 git） ────────────────

describe("GitService - fetchRemoteBranch 分支名驗證", () => {
  it("無效分支名稱（含路徑穿越）應回傳錯誤", async () => {
    const result = await gitService.fetchRemoteBranch(
      "/fake/path",
      "../evil-branch",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("無效的分支名稱");
  });

  it("含特殊字元的無效分支名稱應回傳錯誤", async () => {
    const result = await gitService.fetchRemoteBranch(
      "/fake/path",
      "branch; rm -rf /",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("無效的分支名稱");
  });
});

// ─── hasCommits：使用真 git repo 驗證邊界行為 ────────────────────────────

describe("GitService - hasCommits（真 git repo）", () => {
  let repoDir: string;

  beforeEach(async () => {
    // 在 os.tmpdir() 下建立唯一測試目錄，跨平台安全
    repoDir = path.join(
      os.tmpdir(),
      `git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(repoDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupRepo(repoDir);
  });

  it("空 git repo（無任何 commit）時回傳 ok(false)", async () => {
    // 建立空 repo：只 init，不做任何 commit
    await $`git init ${repoDir}`.quiet();
    await $`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await $`git -C ${repoDir} config user.name "Test User"`.quiet();

    const result = await gitService.hasCommits(repoDir);

    // 空 repo 的 HEAD 是 ambiguous，應回傳 ok(false)
    expect(result.success).toBe(true);
    expect(result.data).toBe(false);
  });

  it("有 commit 的 repo 回傳 ok(true)", async () => {
    // 使用 helper 建立含初始 commit 的 repo
    await initGitRepo(repoDir);

    const result = await gitService.hasCommits(repoDir);

    expect(result.success).toBe(true);
    expect(result.data).toBe(true);
  });

  it("路徑不存在時回傳 err（非「無 commit」白名單錯誤）", async () => {
    const nonExistentPath = path.join(os.tmpdir(), `nonexistent-${Date.now()}`);

    const result = await gitService.hasCommits(nonExistentPath);

    // 不存在的路徑，git 會拋出非白名單錯誤 → 回傳 err
    expect(result.success).toBe(false);
  });
});

// ─── smartCheckoutBranch：混合策略 ───────────────────────────────────────
//
// 快樂路徑（本地/遠端分支 checkout、建立分支）→ 用真 git repo 驗證
// 失敗路徑（回傳 err 的控制流程）→ 保留 vi.spyOn（無法用真 git 可靠模擬）

describe("GitService - smartCheckoutBranch（真 git repo）", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = path.join(
      os.tmpdir(),
      `smart-checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(repoDir, { recursive: true });
    // 建立含初始 commit 的 repo（user config 已由 initGitRepo 設好）
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await cleanupRepo(repoDir);
  });

  it("本地分支存在時直接 checkout，回傳 switched", async () => {
    // 預先建立 feature-branch 分支
    await $`git -C ${repoDir} branch feature-branch`.quiet();

    const progressCalls: Array<[number, string]> = [];
    const result = await gitService.smartCheckoutBranch(
      repoDir,
      "feature-branch",
      {
        onProgress: (progress, message) =>
          progressCalls.push([progress, message]),
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe("switched");
    // 驗證 onProgress 呼叫次數與每次傳入的結構
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(progressCalls).toContainEqual([10, "檢查本地分支..."]);
    expect(progressCalls).toContainEqual([80, "切換分支..."]);
    // 驗證所有 progress 值都在合法範圍內
    progressCalls.forEach(([progress, message]) => {
      expect(typeof progress).toBe("number");
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(100);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    });
    // 確認實際已切換到 feature-branch
    const currentBranch = await gitService.getCurrentBranch(repoDir);
    expect(currentBranch.success).toBe(true);
    expect(currentBranch.data).toBe("feature-branch");
  });

  it("本地與遠端都不存在時建立新分支，回傳 created", async () => {
    // repo 沒有 remote，所以不存在遠端分支，直接建立新分支
    const progressCalls: Array<[number, string]> = [];
    const result = await gitService.smartCheckoutBranch(repoDir, "new-branch", {
      onProgress: (progress, message) =>
        progressCalls.push([progress, message]),
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("created");
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(progressCalls).toContainEqual([10, "檢查本地分支..."]);
    expect(progressCalls).toContainEqual([80, "建立並切換分支..."]);
    progressCalls.forEach(([progress, message]) => {
      expect(typeof progress).toBe("number");
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(100);
      expect(typeof message).toBe("string");
    });
    // 確認實際已切換到 new-branch
    const currentBranch = await gitService.getCurrentBranch(repoDir);
    expect(currentBranch.success).toBe(true);
    expect(currentBranch.data).toBe("new-branch");
  });

  it("本地不存在、遠端存在時 fetch 後 checkout，回傳 fetched", async () => {
    // 建立有 remote 的 repo，並在 remote 上新增 remote-only-branch
    const remoteDir = path.join(
      os.tmpdir(),
      `smart-co-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(remoteDir, { recursive: true });

    try {
      // 建立 bare remote
      await $`git init --bare ${remoteDir}`.quiet();
      // 設定 origin remote
      await $`git -C ${repoDir} remote add origin ${remoteDir}`.quiet();
      // push initial branch 到 remote
      await $`git -C ${repoDir} push -u origin HEAD`.quiet();
      // 在 remote 建立 remote-only-branch（透過 push 一個本地 ref 到 remote）
      await $`git -C ${repoDir} push origin HEAD:refs/heads/remote-only-branch`.quiet();

      const progressCalls: Array<[number, string]> = [];
      const result = await gitService.smartCheckoutBranch(
        repoDir,
        "remote-only-branch",
        {
          onProgress: (progress, message) =>
            progressCalls.push([progress, message]),
        },
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe("fetched");
      // 驗證 onProgress 呼叫次數與每次傳入的結構
      expect(progressCalls.length).toBeGreaterThanOrEqual(2);
      expect(progressCalls).toContainEqual([10, "檢查本地分支..."]);
      expect(progressCalls).toContainEqual([80, "切換分支..."]);
      progressCalls.forEach(([progress, message]) => {
        expect(typeof progress).toBe("number");
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(100);
        expect(typeof message).toBe("string");
      });
      // 確認實際已切換到 remote-only-branch
      const currentBranch = await gitService.getCurrentBranch(repoDir);
      expect(currentBranch.success).toBe(true);
      expect(currentBranch.data).toBe("remote-only-branch");
    } finally {
      await cleanupRepo(remoteDir);
    }
  });
});

describe("GitService - smartCheckoutBranch（失敗路徑，vi.spyOn）", () => {
  // 保留 vi.spyOn：以下 case 測試「內部流程在某步驟回傳 err 時，
  // 外層能正確傳遞錯誤並提早中止」，與真 git 行為無關，
  // 用 spy 比用真 git 模擬更精確、更穩定
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("無效分支名稱回傳錯誤，不執行任何 git 操作", async () => {
    const branchExistsSpy = vi.spyOn(gitService, "branchExists");

    const result = await gitService.smartCheckoutBranch("/fake/path", "../bad");

    expect(result.success).toBe(false);
    expect(result.error).toBe("無效的分支名稱格式");
    expect(branchExistsSpy).not.toHaveBeenCalled();
  });

  it("checkout 失敗時回傳對應錯誤", async () => {
    vi.spyOn(gitService, "branchExists").mockResolvedValue(ok(true));
    vi.spyOn(gitService, "checkoutBranch").mockResolvedValue(
      err("切換分支失敗"),
    );

    const result = await gitService.smartCheckoutBranch(
      "/fake/path",
      "feature-branch",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("切換分支失敗");
  });

  it("branchExists 失敗時提早回傳錯誤", async () => {
    vi.spyOn(gitService, "branchExists").mockResolvedValue(err("檢查分支失敗"));
    const checkRemoteSpy = vi.spyOn(gitService, "checkRemoteBranchExists");

    const result = await gitService.smartCheckoutBranch(
      "/fake/path",
      "feature-branch",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("檢查分支失敗");
    expect(checkRemoteSpy).not.toHaveBeenCalled();
  });

  it("fetchRemoteBranch 失敗時回傳對應錯誤", async () => {
    vi.spyOn(gitService, "branchExists").mockResolvedValue(ok(false));
    vi.spyOn(gitService, "checkRemoteBranchExists").mockResolvedValue(ok(true));
    vi.spyOn(gitService, "fetchRemoteBranch").mockResolvedValue(
      err("從遠端 fetch 分支失敗"),
    );

    const result = await gitService.smartCheckoutBranch(
      "/fake/path",
      "feature-branch",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("從遠端 fetch 分支失敗");
  });
});
