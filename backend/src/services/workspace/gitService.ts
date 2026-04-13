import { simpleGit, SimpleGitProgressEvent } from "simple-git";
import { Result, ok, err, getResultErrorString } from "../../types";
import { config } from "../../config";
import { logger } from "../../utils/logger.js";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import {
  gitOperation,
  gitOperationWithPath,
  resultOrDefault,
  getGitStageMessage,
  maskTokenInError,
} from "../../utils/operationHelpers.js";
import path from "path";
import fs from "fs/promises";

interface GitCloneProgress {
  stage: string;
  progress: number;
}

interface GitCloneOptions {
  branch?: string;
  onProgress?: (progress: GitCloneProgress) => void;
}

export type CheckoutProgressCallback = (
  progress: number,
  message: string,
) => void;

export interface SmartCheckoutOptions {
  force?: boolean;
  onProgress?: CheckoutProgressCallback;
}

type GitSource = "github" | "gitlab" | "other";

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9_.\-/]+$/;

const PULL_FETCH_PROGRESS_START = 10;
const PULL_FETCH_PROGRESS_WEIGHT = 0.7;

const FETCH_CHECKOUT_PROGRESS_START = 20;
const FETCH_CHECKOUT_PROGRESS_WEIGHT = 0.6;

function isValidBranchName(branchName: string): boolean {
  if (!BRANCH_NAME_PATTERN.test(branchName)) {
    return false;
  }
  if (branchName.includes("//")) {
    return false;
  }
  if (branchName.includes("..")) {
    return false;
  }

  return !(branchName.startsWith("/") || branchName.endsWith("/"));
}

function parseGitErrorMessage(error: unknown): string {
  return maskTokenInError(error);
}

function getPullLatestError(errorMessage: string): string {
  if (
    errorMessage.includes("Could not resolve host") ||
    errorMessage.includes("Network") ||
    errorMessage.includes("network")
  ) {
    return "無法連線至遠端伺服器";
  }
  if (errorMessage.includes("couldn't find remote ref")) {
    return "遠端分支不存在";
  }
  return "Pull 至最新版本失敗";
}

function getBranchDeletionError(
  errorMessage: string,
  branchName: string,
): string {
  if (errorMessage.includes("not fully merged")) {
    return `分支「${branchName}」尚未合併，是否要強制刪除？`;
  }
  return "刪除分支失敗";
}

function getCheckoutError(errorMessage: string, branchName: string): string {
  if (
    errorMessage.includes("is already checked out at") ||
    errorMessage.includes("is already used by worktree at")
  ) {
    return `無法切換到分支「${branchName}」，該分支已被 Worktree 使用`;
  }
  return "切換分支失敗";
}

function extractDomainFromUrl(url: string): string {
  const match = url.match(/^(?:git@|https?:\/\/)([^/:]+)/);
  return match ? match[1] : "";
}

const sourceDetectors: Array<{
  check: (url: string, domain: string) => boolean;
  source: GitSource;
}> = [
  {
    check: (url, domain) =>
      url.includes("github.com") || domain === "github.com",
    source: "github",
  },
  {
    check: (url, domain) =>
      url.includes("gitlab.com") || domain === "gitlab.com",
    source: "gitlab",
  },
  {
    check: (_url, domain): boolean => {
      if (!config.gitlabUrl) return false;
      const gitlabDomain = extractDomainFromUrl(config.gitlabUrl);
      return domain === gitlabDomain;
    },
    source: "gitlab",
  },
];

function detectGitSource(repoUrl: string): GitSource {
  const domain = extractDomainFromUrl(repoUrl);
  return (
    sourceDetectors.find(({ check }) => check(repoUrl, domain))?.source ??
    "other"
  );
}

function buildGithubAuthUrl(repoUrl: string, token: string): string {
  if (!repoUrl.startsWith("https://github.com/")) {
    return repoUrl;
  }
  return repoUrl.replace("https://github.com/", `https://${token}@github.com/`);
}

function buildGitlabAuthUrl(repoUrl: string, token: string): string {
  if (repoUrl.startsWith("https://gitlab.com/")) {
    return repoUrl.replace(
      "https://gitlab.com/",
      `https://oauth2:${token}@gitlab.com/`,
    );
  }

  if (config.gitlabUrl && repoUrl.startsWith(config.gitlabUrl)) {
    const urlWithoutProtocol = config.gitlabUrl.replace(/^https?:\/\//, "");
    return repoUrl.replace(
      `https://${urlWithoutProtocol}/`,
      `https://oauth2:${token}@${urlWithoutProtocol}/`,
    );
  }

  return repoUrl;
}

const authUrlBuilders: Partial<
  Record<
    GitSource,
    {
      getToken: () => string | undefined;
      build: (url: string, token: string) => string;
    }
  >
> = {
  github: { getToken: () => config.githubToken, build: buildGithubAuthUrl },
  gitlab: { getToken: () => config.gitlabToken, build: buildGitlabAuthUrl },
};

function buildAuthenticatedUrl(repoUrl: string): string {
  const source = detectGitSource(repoUrl);
  const builder = authUrlBuilders[source];
  const token = builder?.getToken();
  if (!builder || !token) return repoUrl;
  return builder.build(repoUrl, token);
}

const privateRepoMessages: Record<GitSource, string> = {
  github: "無法存取私有倉庫，請設定 GITHUB_TOKEN",
  gitlab: "無法存取私有倉庫，請設定 GITLAB_TOKEN",
  other: "無法存取私有倉庫，請設定對應的 Token",
};

const cloneErrorPatterns: Array<{
  match: string;
  getMessage: (source: GitSource) => string;
}> = [
  {
    match: "Authentication failed",
    getMessage: () => "認證失敗，請檢查 Token 是否正確",
  },
  { match: "Repository not found", getMessage: () => "找不到指定的倉庫" },
  { match: "not found", getMessage: () => "找不到指定的倉庫" },
  {
    match: "could not read Username",
    getMessage: (source) => privateRepoMessages[source],
  },
];

function parseCloneErrorMessage(error: unknown, source: GitSource): string {
  const errorMessage = parseGitErrorMessage(error);
  return (
    cloneErrorPatterns
      .find(({ match }) => errorMessage.includes(match))
      ?.getMessage(source) ?? "複製儲存庫失敗"
  );
}

function buildCheckoutArgs(branchName: string, force?: boolean): string[] {
  return force ? [branchName, "--force"] : [branchName];
}

function parseWorktreeLine(
  line: string,
  realWorkspacePath: string,
): string | null {
  const pathMatch = line.match(/^(.+?)\s+/);
  if (!pathMatch) return null;

  const worktreePath = path.normalize(pathMatch[1]);
  if (worktreePath === realWorkspacePath) return null;

  const branchMatch = line.match(/\[(.+?)]/);
  if (!branchMatch || !branchMatch[1]) return null;

  return branchMatch[1];
}

class GitService {
  async clone(
    repoUrl: string,
    targetPath: string,
    options?: GitCloneOptions,
  ): Promise<Result<void>> {
    const source = detectGitSource(repoUrl);

    if (!isPathWithinDirectory(targetPath, config.repositoriesRoot)) {
      return err("目標路徑不在允許的範圍內");
    }

    try {
      const git = simpleGit({
        progress: options?.onProgress
          ? (event: SimpleGitProgressEvent): void => {
              const progressData: GitCloneProgress = {
                stage: event.stage,
                progress: event.progress,
              };
              options.onProgress!(progressData);
            }
          : undefined,
      });

      const authenticatedUrl = buildAuthenticatedUrl(repoUrl);
      const cloneOptions = options?.branch ? ["--branch", options.branch] : [];
      await git.clone(authenticatedUrl, targetPath, cloneOptions);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseCloneErrorMessage(error, source);
      logger.error(
        "Git",
        "Error",
        `[Git] Clone Repository 失敗`,
        maskTokenInError(error),
      );
      return err(errorMessage);
    }
  }

  async getCurrentBranch(workspacePath: string): Promise<Result<string>> {
    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        const status = await git.status();
        return status.current || "unknown";
      },
      "取得目前分支失敗",
    );
  }

  async isGitRepository(workspacePath: string): Promise<Result<boolean>> {
    const gitPath = path.join(workspacePath, ".git");
    // 一般 repo 的 .git 是目錄，worktree 的 .git 是指向主 repo 的檔案
    const stat = await fs.stat(gitPath).catch(() => null);
    return ok(stat !== null);
  }

  async hasCommits(workspacePath: string): Promise<Result<boolean>> {
    try {
      const git = simpleGit(workspacePath);
      await git.revparse(["HEAD"]);
      return ok(true);
    } catch {
      // 空 repo 沒有 HEAD，這是正常情況不需要 log
      return ok(false);
    }
  }

  async branchExists(
    workspacePath: string,
    branchName: string,
  ): Promise<Result<boolean>> {
    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        const branches = await git.branch();
        return branches.all.includes(branchName);
      },
      "檢查分支失敗",
    );
  }

  async createWorktree(
    workspacePath: string,
    worktreePath: string,
    branchName: string,
  ): Promise<Result<void>> {
    if (!isPathWithinDirectory(worktreePath, config.repositoriesRoot)) {
      return err("無效的 worktree 路徑");
    }

    if (!isValidBranchName(branchName)) {
      return err("無效的分支名稱格式");
    }

    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        await git.raw(["worktree", "add", "-b", branchName, worktreePath]);
      },
      "建立 Worktree 失敗",
    );
  }

  async createDetachedWorktree(
    parentRepoPath: string,
    worktreePath: string,
  ): Promise<Result<void>> {
    if (!isPathWithinDirectory(worktreePath, config.repositoriesRoot)) {
      return err("無效的 worktree 路徑");
    }

    return gitOperationWithPath(
      parentRepoPath,
      async (git) => {
        await git.raw(["worktree", "add", "--detach", worktreePath, "HEAD"]);
      },
      "建立 Detached Worktree 失敗",
    );
  }

  async removeWorktree(
    parentRepoPath: string,
    worktreePath: string,
  ): Promise<Result<void>> {
    if (!isPathWithinDirectory(worktreePath, config.repositoriesRoot)) {
      return err("無效的 worktree 路徑");
    }

    return gitOperationWithPath(
      parentRepoPath,
      async (git) => {
        await git.raw(["worktree", "remove", "--force", worktreePath]);
      },
      "移除 Worktree 失敗",
    );
  }

  private async validateBranchForDeletion(
    workspacePath: string,
    branchName: string,
  ): Promise<string | null> {
    const currentBranchResult = await this.getCurrentBranch(workspacePath);
    if (!currentBranchResult.success)
      return getResultErrorString(currentBranchResult.error);
    if (currentBranchResult.data === branchName)
      return "無法刪除目前所在的分支";
    return null;
  }

  async deleteBranch(
    workspacePath: string,
    branchName: string,
    force?: boolean,
  ): Promise<Result<void>> {
    const validationError = await this.validateBranchForDeletion(
      workspacePath,
      branchName,
    );
    if (validationError) return err(validationError);

    try {
      const git = simpleGit(workspacePath);
      const flag = force ? "-D" : "-d";
      await git.raw(["branch", flag, branchName]);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseGitErrorMessage(error);
      const errorText = getBranchDeletionError(errorMessage, branchName);
      if (errorText === "刪除分支失敗") {
        logger.error(
          "Git",
          "Error",
          `[Git] 刪除分支失敗`,
          maskTokenInError(error),
        );
      }
      return err(errorText);
    }
  }

  async hasUncommittedChanges(workspacePath: string): Promise<Result<boolean>> {
    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        const status = await git.status();
        return !status.isClean();
      },
      "檢查未 commit 修改失敗",
    );
  }

  async checkoutBranch(
    workspacePath: string,
    branchName: string,
    force?: boolean,
  ): Promise<Result<void>> {
    if (!isValidBranchName(branchName)) {
      return err("無效的分支名稱格式");
    }

    try {
      const git = simpleGit(workspacePath);
      const args = buildCheckoutArgs(branchName, force);
      await git.checkout(args);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseGitErrorMessage(error);
      const errorText = getCheckoutError(errorMessage, branchName);
      if (errorText === "切換分支失敗") {
        logger.error(
          "Git",
          "Error",
          `[Git] 切換分支失敗`,
          maskTokenInError(error),
        );
      }
      return err(errorText);
    }
  }

  async getWorktreeBranches(workspacePath: string): Promise<Result<string[]>> {
    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        const worktreeList = await git.raw(["worktree", "list"]);

        const lines = worktreeList.trim().split("\n");

        // macOS 上 /tmp 是 /private/tmp 的 symlink，需要解析真實路徑才能正確比較
        const realWorkspacePath = await fs.realpath(workspacePath);

        return lines
          .map((line) => parseWorktreeLine(line, realWorkspacePath))
          .filter((branch): branch is string => branch !== null);
      },
      "取得 Worktree 分支列表失敗",
    );
  }

  async getLocalBranches(workspacePath: string): Promise<
    Result<{
      branches: string[];
      current: string;
      worktreeBranches: string[];
    }>
  > {
    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        const branchSummary = await git.branch();

        const localBranches = branchSummary.all.filter(
          (branch) => !branch.startsWith("remotes/"),
        );

        const worktreeBranchesResult =
          await this.getWorktreeBranches(workspacePath);
        const worktreeBranches: string[] = worktreeBranchesResult.success
          ? worktreeBranchesResult.data
          : [];

        return {
          branches: localBranches,
          current: branchSummary.current,
          worktreeBranches,
        };
      },
      "取得本地分支列表失敗",
    );
  }

  async checkRemoteBranchExists(
    workspacePath: string,
    branchName: string,
  ): Promise<Result<boolean>> {
    const result = await gitOperationWithPath(
      workspacePath,
      async (git) => {
        const remotes = await git.getRemotes();

        if (
          remotes.length === 0 ||
          !remotes.some((remote) => remote.name === "origin")
        ) {
          return false;
        }

        const lsRemoteResult = await git.raw([
          "ls-remote",
          "--heads",
          "origin",
          branchName,
        ]);
        return lsRemoteResult.trim().length > 0;
      },
      "檢查遠端分支失敗",
    );

    return resultOrDefault(result, false);
  }

  async fetchRemoteBranch(
    workspacePath: string,
    branchName: string,
    onProgress?: (progress: GitCloneProgress) => void,
  ): Promise<Result<void>> {
    if (!isValidBranchName(branchName)) {
      return err("無效的分支名稱");
    }

    return gitOperation(async () => {
      const git = simpleGit({
        baseDir: workspacePath,
        progress: onProgress
          ? (event: SimpleGitProgressEvent): void => {
              onProgress({ stage: event.stage, progress: event.progress });
            }
          : undefined,
      });
      await git.raw(["fetch", "origin", `${branchName}:${branchName}`]);
    }, "從遠端 fetch 分支失敗");
  }

  async createAndCheckoutBranch(
    workspacePath: string,
    branchName: string,
  ): Promise<Result<void>> {
    if (!isValidBranchName(branchName)) {
      return err("無效的分支名稱格式");
    }

    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        await git.checkout(["-b", branchName]);
      },
      "建立並切換分支失敗",
    );
  }

  private async validateCurrentBranch(
    workspacePath: string,
  ): Promise<Result<string>> {
    const currentBranchResult = await this.getCurrentBranch(workspacePath);
    if (!currentBranchResult.success) {
      return err("取得目前分支失敗");
    }

    const currentBranch = currentBranchResult.data;
    if (!currentBranch || !isValidBranchName(currentBranch)) {
      return err("無效的分支名稱格式");
    }

    return ok(currentBranch);
  }

  private async performPullWithProgress(
    workspacePath: string,
    currentBranch: string,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Result<void>> {
    try {
      const git = simpleGit({
        baseDir: workspacePath,
        progress: onProgress
          ? (event: SimpleGitProgressEvent): void => {
              const mappedProgress = Math.floor(
                PULL_FETCH_PROGRESS_START +
                  event.progress * PULL_FETCH_PROGRESS_WEIGHT,
              );
              const stageMessage = getGitStageMessage(event.stage);
              onProgress(mappedProgress, stageMessage);
            }
          : undefined,
      });
      await git.fetch(["origin", currentBranch]);
      onProgress?.(85, "重設至最新版本...");
      await git.reset(["--hard", `origin/${currentBranch}`]);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseGitErrorMessage(error);
      const errorText = getPullLatestError(errorMessage);
      logger.error(
        "Git",
        "Error",
        `[Git] Pull 最新版本失敗`,
        maskTokenInError(error),
      );
      return err(errorText);
    }
  }

  /**
   * 將 repo 同步到 remote 最新版本（供 Run 啟動前使用）
   * - 無 remote 時靜默跳過
   * - 失敗時回傳 err 但不拋出例外
   */
  async syncToRemoteLatest(workspacePath: string): Promise<Result<void>> {
    // 檢查是否有 origin remote
    const hasRemoteResult = await gitOperationWithPath(
      workspacePath,
      async (git) => {
        const remotes = await git.getRemotes();
        return remotes.some((remote) => remote.name === "origin");
      },
      "檢查 remote 失敗",
    );

    // 檢查 remote 失敗（例如 .git 損壞），回傳錯誤
    if (!hasRemoteResult.success) {
      return err(
        `檢查 remote 失敗：${getResultErrorString(hasRemoteResult.error)}`,
      );
    }

    // 沒有 origin remote，靜默跳過
    if (!hasRemoteResult.data) {
      return ok(undefined);
    }

    // 取得當前分支名稱
    const branchResult = await this.validateCurrentBranch(workspacePath);
    if (!branchResult.success) {
      return err(`同步失敗：${branchResult.error}`);
    }

    const currentBranch = branchResult.data;

    // 執行 fetch + reset --hard（不執行 clean -fd，避免刪除 .claude/ 等動態管理的 untracked 檔案）
    return gitOperationWithPath(
      workspacePath,
      async (git) => {
        await git.fetch(["origin", currentBranch]);
        await git.reset(["--hard", `origin/${currentBranch}`]);
      },
      "同步 remote 最新版本失敗",
    );
  }

  async pullLatest(
    workspacePath: string,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Result<void>> {
    const branchResult = await this.validateCurrentBranch(workspacePath);
    if (!branchResult.success) {
      return err(branchResult.error);
    }

    const currentBranch = branchResult.data;
    onProgress?.(5, "取得分支資訊...");

    return this.performPullWithProgress(
      workspacePath,
      currentBranch,
      onProgress,
    );
  }

  private async checkoutLocalBranch(
    workspacePath: string,
    branchName: string,
    force: boolean | undefined,
    onProgress?: CheckoutProgressCallback,
  ): Promise<Result<"switched">> {
    onProgress?.(80, "切換分支...");
    const checkoutResult = await this.checkoutBranch(
      workspacePath,
      branchName,
      force,
    );
    if (!checkoutResult.success) {
      return err(checkoutResult.error);
    }
    return ok("switched");
  }

  private async fetchAndCheckoutRemoteBranch(
    workspacePath: string,
    branchName: string,
    force: boolean | undefined,
    onProgress?: CheckoutProgressCallback,
  ): Promise<Result<"fetched">> {
    const fetchResult = await this.fetchRemoteBranch(
      workspacePath,
      branchName,
      (progressData) => {
        const mappedProgress = Math.floor(
          FETCH_CHECKOUT_PROGRESS_START +
            progressData.progress * FETCH_CHECKOUT_PROGRESS_WEIGHT,
        );
        const stageMessage = getGitStageMessage(progressData.stage);
        onProgress?.(mappedProgress, stageMessage);
      },
    );
    if (!fetchResult.success) {
      return err(fetchResult.error);
    }

    onProgress?.(80, "切換分支...");
    const checkoutResult = await this.checkoutBranch(
      workspacePath,
      branchName,
      force,
    );
    if (!checkoutResult.success) {
      return err(checkoutResult.error);
    }
    return ok("fetched");
  }

  private async createNewBranch(
    workspacePath: string,
    branchName: string,
    onProgress?: CheckoutProgressCallback,
  ): Promise<Result<"created">> {
    onProgress?.(80, "建立並切換分支...");
    const createResult = await this.createAndCheckoutBranch(
      workspacePath,
      branchName,
    );
    if (!createResult.success) {
      return err(createResult.error);
    }
    return ok("created");
  }

  async smartCheckoutBranch(
    workspacePath: string,
    branchName: string,
    options?: SmartCheckoutOptions,
  ): Promise<Result<"switched" | "fetched" | "created">> {
    const { force, onProgress } = options ?? {};

    if (!isValidBranchName(branchName)) {
      return err("無效的分支名稱格式");
    }

    const localBranchExists = await this.branchExists(
      workspacePath,
      branchName,
    );
    if (!localBranchExists.success) {
      return err(localBranchExists.error);
    }

    onProgress?.(10, "檢查本地分支...");

    if (localBranchExists.data) {
      return this.checkoutLocalBranch(
        workspacePath,
        branchName,
        force,
        onProgress,
      );
    }

    onProgress?.(20, "檢查遠端分支...");
    const remoteBranchExists = await this.checkRemoteBranchExists(
      workspacePath,
      branchName,
    );
    if (!remoteBranchExists.success) {
      return err(remoteBranchExists.error);
    }

    if (remoteBranchExists.data) {
      return this.fetchAndCheckoutRemoteBranch(
        workspacePath,
        branchName,
        force,
        onProgress,
      );
    }

    return this.createNewBranch(workspacePath, branchName, onProgress);
  }
}

export const gitService = new GitService();

// @internal - 僅供測試使用
export {
  detectGitSource,
  buildAuthenticatedUrl,
  parseCloneErrorMessage,
  extractDomainFromUrl,
  getPullLatestError,
  type GitSource,
};
