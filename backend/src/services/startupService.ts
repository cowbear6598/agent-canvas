import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { Database } from "bun:sqlite";
import { scheduleService } from "./scheduleService.js";
import { backupScheduleService } from "./backupScheduleService.js";
import { tmpCleanupService } from "./tmpCleanupService.js";
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

/**
 * DB 路徑遷移用的舊/新目錄片段常數。
 * 僅在 migrateDbPaths 的 SQL 中使用，集中定義避免硬編碼散落。
 */
const OLD_DATA_DIR_PATTERN = "/Documents/ClaudeCanvas/";
const NEW_DATA_DIR_PATTERN = "/Documents/AgentCanvas/";

class StartupService {
  async initialize(): Promise<Result<void>> {
    // 必須在 ensureDirectories 與 DB 任何初始化之前執行
    await this.runMigrations();

    const dirResult = await this.ensureDirectories([
      config.appDataRoot,
      config.canvasRoot,
      config.repositoriesRoot,
      config.runtimeRoot,
      config.runWorkspacesRoot,
      config.claudeSandboxRoot,
    ]);
    if (!dirResult.success) {
      return dirResult;
    }

    getDb();

    await this.migrateEncryptionIfNeeded();

    const defaultCanvasResult = await this.ensureDefaultCanvas();
    if (!defaultCanvasResult.success) {
      return defaultCanvasResult;
    }

    this.startBackgroundServices();

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
   * 執行所有資料遷移任務：
   * 1. 資料目錄從 ClaudeCanvas → AgentCanvas
   * 2. SQLite 內的絕對路徑更新
   * 必須在 DB 初始化（getDb()）與 ensureDirectories 之前呼叫。
   */
  private async runMigrations(): Promise<void> {
    // SQLite WAL 檔在 DB 打開後會被鎖住，無法 rename
    await this.migrateFromClaudeCanvas();
    // 無條件執行 DB 路徑遷移：無論 fs.rename 是否發生（例如舊資料夾早已改名），
    // 都需要確保 SQLite 內的路徑已從 ClaudeCanvas 更新為 AgentCanvas。
    // 此函式具冪等性：無舊路徑紀錄時為 0 changes，不會有副作用。
    await this.migrateDbPaths(
      path.join(os.homedir(), "Documents", "AgentCanvas"),
    );
  }

  /**
   * 啟動所有背景排程服務：
   * - scheduleService（Pod 排程）
   * - backupScheduleService（備份排程）
   * - tmpCleanupService（tmp 目錄定期清理）
   */
  private startBackgroundServices(): void {
    scheduleService.start();
    backupScheduleService.start();
    // 啟動 tmp 目錄定期清理（每小時執行一次，超過 6 小時的目錄會被刪除）
    tmpCleanupService.start();
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

  /**
   * 將 SQLite 內殘留的 ClaudeCanvas 絕對路徑全面替換為 AgentCanvas 路徑。
   * 利用 SQLite PRAGMA user_version 作為遷移版本戳記，避免每次啟動都執行全表 LIKE 掃描：
   *   - user_version < DB_PATHS_MIGRATION_VERSION → 執行遷移並更新版本號
   *   - user_version >= DB_PATHS_MIGRATION_VERSION → 已完成，直接跳過
   * 此函式在 getDb() 初始化前呼叫，因此需要自行開啟 DB。
   * 若 DB 檔案不存在（首次安裝），靜默跳過不報錯。
   */
  private async migrateDbPaths(newAppDataRoot: string): Promise<void> {
    /** PRAGMA user_version 版本號；累加此值可觸發下一輪路徑遷移 */
    const DB_PATHS_MIGRATION_VERSION = 1;

    const dbPath = path.join(newAppDataRoot, "canvas.db");
    const dbExists = await fs
      .access(dbPath)
      .then(() => true)
      .catch(() => false);

    if (!dbExists) {
      // 首次安裝，DB 尚未建立，直接跳過
      return;
    }

    const db = new Database(dbPath);
    try {
      // 讀取目前的遷移版本
      const versionRow = db.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      const currentVersion = versionRow.user_version;

      if (currentVersion >= DB_PATHS_MIGRATION_VERSION) {
        // 已執行過路徑遷移，直接跳過
        return;
      }

      // pods.workspace_path
      const podsResult = db
        .prepare(
          `UPDATE pods SET workspace_path = REPLACE(workspace_path, '${OLD_DATA_DIR_PATTERN}', '${NEW_DATA_DIR_PATTERN}') WHERE workspace_path LIKE '%${OLD_DATA_DIR_PATTERN}%'`,
        )
        .run();

      // repository_metadata.path
      const reposResult = db
        .prepare(
          `UPDATE repository_metadata SET path = REPLACE(path, '${OLD_DATA_DIR_PATTERN}', '${NEW_DATA_DIR_PATTERN}') WHERE path LIKE '%${OLD_DATA_DIR_PATTERN}%'`,
        )
        .run();

      // 更新版本戳記，後續啟動將跳過此遷移
      db.exec(`PRAGMA user_version = ${DB_PATHS_MIGRATION_VERSION}`);

      const totalUpdated = podsResult.changes + reposResult.changes;
      if (totalUpdated > 0) {
        logger.log(
          "Startup",
          "Migrate",
          `已更新 SQLite 路徑：pods ${podsResult.changes} 筆、repository_metadata ${reposResult.changes} 筆（共 ${totalUpdated} 筆）`,
        );
      }
    } finally {
      db.close();
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

      // 清除備份 Git 歷史（舊 commit 可能包含明文 DB），僅忽略目錄不存在的情況
      const backupGitDir = path.join(config.appDataRoot, ".git");
      try {
        await fs.rm(backupGitDir, { recursive: true, force: true });
        logger.log("Encryption", "Migrate", "已清除備份 Git 歷史");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.warn(
            "Encryption",
            "Warn",
            `清除備份 Git 歷史失敗，請手動確認：${errMsg}`,
          );
        }
      }
    }
  }

  private async ensureDefaultCanvas(): Promise<Result<void>> {
    const canvases = canvasStore.list();
    if (canvases.length === 0) {
      logger.log("Startup", "Create", "未找到任何畫布，建立預設畫布");
      const defaultCanvasResult = await canvasStore.create("default");
      if (!defaultCanvasResult.success) {
        return err(`建立預設 Canvas 失敗: ${defaultCanvasResult.error}`);
      }
    }
    return ok(undefined);
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
    await Promise.all(
      providers.map(async (provider) => {
        const apps = integrationAppStore.list(provider.name);
        if (apps.length === 0) return;

        const results = await Promise.all(
          apps.map(async (app) => {
            try {
              await provider.initialize(app);
              return true;
            } catch (error) {
              logger.error(
                "Integration",
                "Error",
                `[StartupService] ${provider.name}:${app.id} 初始化失敗`,
                error,
              );
              return false;
            }
          }),
        );

        const successCount = results.filter(Boolean).length;
        logger.log(
          "Integration",
          "Complete",
          `[StartupService] ${provider.name} 已恢復 ${successCount} 個連線`,
        );
      }),
    );
  }
}

export const startupService = new StartupService();
