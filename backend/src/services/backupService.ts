import { simpleGit } from "simple-git";
import { promises as fs } from "fs";
import path from "path";
import { Result, ok, err } from "../types/index.js";
import { config } from "../config/index.js";
import { buildAuthenticatedUrl } from "./workspace/gitService.js";
import { logger } from "../utils/logger.js";
import { getDb } from "../database/index.js";
import { createDirectoryArchive } from "../utils/directoryArchive.js";

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

const DEFAULT_BACKUP_USER = "AgentCanvas Backup";
const DEFAULT_BACKUP_EMAIL = "backup@agentcanvas.local";

class BackupService {
  private isRunning = false;

  private get backupDir(): string {
    return path.join(config.appDataRoot, "backup");
  }

  async initRepo(): Promise<Result<void>> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      const git = simpleGit(this.backupDir);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        const backupUser =
          process.env.AGENT_CANVAS_BACKUP_USER ?? DEFAULT_BACKUP_USER;
        const backupEmail =
          process.env.AGENT_CANVAS_BACKUP_EMAIL ?? DEFAULT_BACKUP_EMAIL;
        await git.init();
        await git.addConfig("user.name", backupUser);
        await git.addConfig("user.email", backupEmail);
      }
      return ok(undefined);
    } catch {
      return err("初始化備份倉庫失敗");
    }
  }

  async setupRemote(remoteUrl: string): Promise<Result<void>> {
    try {
      const git = simpleGit(this.backupDir);
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find((r) => r.name === "origin");

      if (!originRemote) {
        await git.addRemote("origin", remoteUrl);
      } else {
        const currentUrl =
          originRemote.refs.push || originRemote.refs.fetch || "";
        if (currentUrl !== remoteUrl) {
          await git.raw(["remote", "set-url", "origin", remoteUrl]);
        }
      }
      return ok(undefined);
    } catch {
      return err("設定備份遠端倉庫失敗");
    }
  }

  private async commitIfChanged(
    git: ReturnType<typeof simpleGit>,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    try {
      await git.commit(`AgentCanvas 自動備份 ${timestamp}`);
    } catch (commitError) {
      const commitMessage =
        commitError instanceof Error
          ? commitError.message
          : String(commitError);
      // 沒有變更的 commit 視為正常（空 commit），允許繼續推送
      if (
        commitMessage.includes("nothing to commit") ||
        commitMessage.includes("nothing added to commit")
      ) {
        return;
      }
      // 其他 commit 失敗是真實錯誤，由上層 executeBackup 統一捕捉與記錄
      throw commitError;
    }
  }

  private async createCanvasSnapshot(): Promise<void> {
    const snapshotPath = path.join(this.backupDir, "canvas.db");
    await fs.rm(snapshotPath, { force: true });
    getDb().run("VACUUM INTO ?", [snapshotPath]);
  }

  private async createDirectorySnapshots(): Promise<void> {
    const dataDir = path.join(this.backupDir, "data");
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.mkdir(dataDir, { recursive: true });

    const targets = [
      ["canvas.zip", config.canvasRoot],
      ["repositories.zip", config.repositoriesRoot],
      ["plugins.zip", config.pluginsRoot],
      ["agents.zip", config.agentsPath],
      ["commands.zip", config.commandsPath],
    ] as const;

    for (const [archiveName, sourceDir] of targets) {
      await createDirectoryArchive(
        sourceDir,
        path.join(dataDir, archiveName),
      );
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

      await this.createCanvasSnapshot();
      await this.createDirectorySnapshots();
      const git = simpleGit(this.backupDir);
      await git.add(["canvas.db", "data"]);
      await this.commitIfChanged(git);
      const authUrl = buildAuthenticatedUrl(remoteUrl);
      await git.raw(["push", "--force-with-lease", authUrl, "HEAD"]);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseBackupError(error);
      logger.error("Backup", "Error", errorMessage);
      return err(errorMessage);
    } finally {
      this.isRunning = false;
    }
  }

  async testConnection(remoteUrl: string): Promise<Result<void>> {
    try {
      const authUrl = buildAuthenticatedUrl(remoteUrl);
      await simpleGit().raw(["ls-remote", authUrl]);
      return ok(undefined);
    } catch (error) {
      const errorMessage = parseBackupError(error);
      return err(errorMessage);
    }
  }
}

export const backupService = new BackupService();
