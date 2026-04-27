import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { scheduleService } from "./scheduleService.js";
import { backupScheduleService } from "./backupScheduleService.js";
import { canvasStore } from "./canvasStore.js";
import { Result, ok, err } from "../types";
import { config } from "../config";
import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errorHelpers.js";
import {
  integrationRegistry,
  integrationAppStore,
} from "./integration/index.js";
import "./integration/providers/index.js";
import { getDb } from "../database/index.js";
import { encryptionService } from "./encryptionService.js";

class StartupService {
  async initialize(): Promise<Result<void>> {
    // 必須在 ensureDirectories 與 DB 任何初始化之前執行：
    // SQLite WAL 檔在 DB 打開後會被鎖住，無法 rename
    await this.migrateFromClaudeCanvas();

    const dirResult = await this.ensureDirectories([
      config.appDataRoot,
      config.canvasRoot,
      config.repositoriesRoot,
    ]);
    if (!dirResult.success) {
      return dirResult;
    }

    getDb();

    await this.migrateEncryptionIfNeeded();

    const canvases = canvasStore.list();
    if (canvases.length === 0) {
      logger.log("Startup", "Create", "未找到任何畫布，建立預設畫布");
      const defaultCanvasResult = await canvasStore.create("default");
      if (!defaultCanvasResult.success) {
        return err(`建立預設 Canvas 失敗: ${defaultCanvasResult.error}`);
      }
    }

    scheduleService.start();
    backupScheduleService.start();

    this.restoreIntegrationConnections().catch((error) => {
      logger.error(
        "Integration",
        "Error",
        "[StartupService] Integration 連線恢復時發生非預期錯誤",
        error,
      );
    });

    logger.log("Startup", "Complete", "伺服器初始化完成");
    return ok(undefined);
  }

  /**
   * 將舊的 ~/Documents/ClaudeCanvas 資料目錄搬遷至 ~/Documents/AgentCanvas。
   *
   * 必須在 DB 與 ensureDirectories 執行之前呼叫：
   * - DB 打開後 SQLite WAL 檔會被鎖住，無法 rename
   * - ensureDirectories 會先建立空的新目錄，導致無法搬遷
   *
   * 搬遷規則：
   * - 只有舊目錄存在 → 直接 rename
   * - 只有新目錄存在 → 無動作（已搬遷或新安裝）
   * - 兩者都存在 → 跳過並 log warning，由使用者手動處理
   * - 都不存在 → 無動作（首次安裝）
   *
   * 若 rename 失敗（例如跨檔案系統），讓錯誤直接 propagate 出去，阻止啟動。
   */
  private async migrateFromClaudeCanvas(): Promise<void> {
    const oldPath = path.join(os.homedir(), "Documents", "ClaudeCanvas");
    const newPath = path.join(os.homedir(), "Documents", "AgentCanvas");

    const oldExists = await fs
      .access(oldPath)
      .then(() => true)
      .catch(() => false);
    const newExists = await fs
      .access(newPath)
      .then(() => true)
      .catch(() => false);

    if (oldExists && !newExists) {
      logger.log(
        "Startup",
        "Migrate",
        "偵測到舊資料目錄 ~/Documents/ClaudeCanvas，正在搬遷至 ~/Documents/AgentCanvas",
      );
      await fs.rename(oldPath, newPath);
      logger.log("Startup", "Migrate", "資料目錄搬遷完成");
    } else if (oldExists && newExists) {
      logger.warn(
        "Startup",
        "Warn",
        "同時偵測到 ~/Documents/ClaudeCanvas 與 ~/Documents/AgentCanvas，已跳過自動搬遷。請手動處理",
      );
    }
  }

  private async migrateEncryptionIfNeeded(): Promise<void> {
    // 初始化加密服務並遷移未加密的 Integration App 憑證
    await encryptionService.initializeKey();
    const migratedCount = integrationAppStore.migrateUnencryptedConfigs();

    if (migratedCount > 0) {
      // VACUUM 清除 DB 空閒頁面中殘留的明文資料
      getDb().exec("VACUUM");
      logger.log(
        "Encryption",
        "Migrate",
        "已執行 VACUUM 清除 DB 中殘留的明文資料",
      );

      // 清除備份 Git 歷史（舊 commit 可能包含明文 DB）
      const backupGitDir = path.join(config.appDataRoot, ".git");
      try {
        await fs.rm(backupGitDir, { recursive: true, force: true });
        logger.log("Encryption", "Migrate", "已清除備份 Git 歷史");
      } catch {
        // .git 目錄不存在時忽略
      }
    }
  }

  private async ensureDirectories(paths: string[]): Promise<Result<void>> {
    for (const dirPath of paths) {
      const result = await fs
        .mkdir(dirPath, { recursive: true })
        .then(() => ok(undefined))
        .catch((e) =>
          err(
            `伺服器初始化失敗: 建立目錄 ${dirPath} 失敗: ${getErrorMessage(e)}`,
          ),
        );
      if (!result.success) return result;
    }
    return ok(undefined);
  }

  private async restoreIntegrationConnections(): Promise<void> {
    const providers = integrationRegistry.list();
    for (const provider of providers) {
      const apps = integrationAppStore.list(provider.name);
      if (apps.length === 0) continue;

      let successCount = 0;
      for (const app of apps) {
        try {
          await provider.initialize(app);
          successCount++;
        } catch (error) {
          logger.error(
            "Integration",
            "Error",
            `[StartupService] ${provider.name}:${app.id} 初始化失敗`,
            error,
          );
        }
      }

      logger.log(
        "Integration",
        "Complete",
        `[StartupService] ${provider.name} 已恢復 ${successCount} 個連線`,
      );
    }
  }
}

export const startupService = new StartupService();
