import { promises as fs } from "fs";
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

class StartupService {
  async initialize(): Promise<Result<void>> {
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

    // 初始化加密金鑰（仍需在每次啟動時載入金鑰）
    await encryptionService.initializeKey();

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

    return ok(undefined);
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

  private async ensureDefaultCanvas(): Promise<Result<void>> {
    const canvases = canvasStore.list();
    if (canvases.length === 0) {
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
