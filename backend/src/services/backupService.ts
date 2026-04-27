import { simpleGit } from "simple-git";
import { promises as fs } from "fs";
import path from "path";
import { Result, ok, err } from "../types/index.js";
import { config } from "../config/index.js";
import { buildAuthenticatedUrl } from "./workspace/gitService.js";
import { logger } from "../utils/logger.js";

function parseBackupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Authentication failed")) {
    return "認證失敗，請檢查 Token 是否正確";
  }
  if (
    message.includes("Could not resolve host") ||
    message.includes("Network")
  ) {
    return "無法連線至遠端伺服器";
  }
  if (
    message.includes("Repository not found") ||
    message.includes("not found")
  ) {
    return "找不到指定的倉庫";
  }
  return "備份推送失敗";
}

class BackupService {
  private static readonly GITIGNORE_ENTRIES = ["encryption.key"];
  private backupDir: string = config.appDataRoot;
  private isRunning = false;

  async initRepo(): Promise<Result<void>> {
    try {
      const git = simpleGit(this.backupDir);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        await git.init();
        await git.addConfig("user.name", "AgentCanvas Backup");
        await git.addConfig("user.email", "backup@agentcanvas.local");
      }
      await this.ensureGitignore();
      return ok(undefined);
    } catch (error) {
      logger.error("Backup", "Error", "初始化備份 Git 倉庫失敗", error);
      return err("初始化備份倉庫失敗");
    }
  }

  async setupRemote(remoteUrl: string): Promise<Result<void>> {
    try {
      const git = simpleGit(this.backupDir);
      const authUrl = buildAuthenticatedUrl(remoteUrl);
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find((r) => r.name === "origin");

      if (!originRemote) {
        await git.addRemote("origin", authUrl);
      } else {
        const currentUrl =
          originRemote.refs.push || originRemote.refs.fetch || "";
        if (currentUrl !== authUrl) {
          await git.raw(["remote", "set-url", "origin", authUrl]);
        }
      }
      return ok(undefined);
    } catch (error) {
      logger.error("Backup", "Error", "設定備份 Remote 失敗", error);
      return err("設定備份遠端倉庫失敗");
    }
  }

  /**
   * 確保 .gitignore 存在且包含必要的排除規則。
   * 若檔案不存在 → 建立並寫入。
   * 若檔案存在但缺少項目 → 追加。
   */
  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.backupDir, ".gitignore");

    let content = "";
    try {
      content = await fs.readFile(gitignorePath, "utf-8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const existingLines = new Set(
      content.split("\n").map((line) => line.trim()),
    );
    const missingEntries = BackupService.GITIGNORE_ENTRIES.filter(
      (entry) => !existingLines.has(entry),
    );

    if (missingEntries.length > 0) {
      const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      const newContent = content + suffix + missingEntries.join("\n") + "\n";
      await fs.writeFile(gitignorePath, newContent, "utf-8");
      logger.log(
        "Backup",
        "Init",
        `已將 ${missingEntries.join(", ")} 加入 .gitignore`,
      );
    }
  }

  private async commitIfChanged(
    git: ReturnType<typeof simpleGit>,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    try {
      await git.commit(`AgentCanvas 自動備份 ${timestamp}`);
    } catch (commitError) {
      // 無檔案變更時 commit 會失敗，這不視為錯誤，繼續 push
      const commitMessage =
        commitError instanceof Error
          ? commitError.message
          : String(commitError);
      if (
        !commitMessage.includes("nothing to commit") &&
        !commitMessage.includes("nothing added to commit")
      ) {
        logger.error("Backup", "Error", "備份 commit 失敗", commitError);
      }
    }
  }

  async executeBackup(remoteUrl: string): Promise<Result<void>> {
    if (this.isRunning) {
      return err("備份正在執行中");
    }

    this.isRunning = true;
    try {
      const initResult = await this.initRepo();
      if (!initResult.success) return initResult;

      const remoteResult = await this.setupRemote(remoteUrl);
      if (!remoteResult.success) return remoteResult;

      const git = simpleGit(this.backupDir);
      await git.add("-A");
      await this.commitIfChanged(git);
      await git.raw(["push", "--force", "origin", "HEAD"]);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseBackupError(error);
      logger.error("Backup", "Error", "備份推送失敗", error);
      return err(errorMessage);
    } finally {
      this.isRunning = false;
    }
  }

  async testConnection(remoteUrl: string): Promise<Result<void>> {
    const initResult = await this.initRepo();
    if (!initResult.success) return initResult;

    const remoteResult = await this.setupRemote(remoteUrl);
    if (!remoteResult.success) return remoteResult;

    try {
      const authUrl = buildAuthenticatedUrl(remoteUrl);
      const git = simpleGit(this.backupDir);
      await git.raw(["ls-remote", authUrl]);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseBackupError(error);
      return err(errorMessage);
    }
  }
}

export const backupService = new BackupService();
