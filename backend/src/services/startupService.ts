import { promises as fs } from 'fs';
import { scheduleService } from './scheduleService.js';
import { canvasStore } from './canvasStore.js';
import { Result, ok, err } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger.js';
import { slackAppStore } from './slack/slackAppStore.js';
import { slackClientManager } from './slack/slackClientManager.js';
import { getDb } from '../database/index.js';

class StartupService {
  async initialize(): Promise<Result<void>> {
    const dirResult = await this.ensureDirectories([
      config.appDataRoot,
      config.canvasRoot,
      config.repositoriesRoot,
    ]);
    if (!dirResult.success) {
      return dirResult;
    }

    // 初始化 SQLite 資料庫
    getDb();

    // 檢查是否需要建立預設 Canvas
    const canvases = canvasStore.list();
    if (canvases.length === 0) {
      logger.log('Startup', 'Create', '未找到任何畫布，建立預設畫布');
      const defaultCanvasResult = await canvasStore.create('default');
      if (!defaultCanvasResult.success) {
        return err(`建立預設 Canvas 失敗: ${defaultCanvasResult.error}`);
      }
    }

    scheduleService.start();

    this.restoreSlackConnections().catch((error) => {
      logger.error('Slack', 'Error', '[StartupService] Slack 連線恢復時發生非預期錯誤', error);
    });

    logger.log('Startup', 'Complete', '伺服器初始化完成');
    return ok(undefined);
  }

  private async ensureDirectories(paths: string[]): Promise<Result<void>> {
    for (const dirPath of paths) {
      try {
        await fs.mkdir(dirPath, {recursive: true});
      } catch {
        return err(`伺服器初始化失敗: 建立目錄 ${dirPath} 失敗`);
      }
    }
    return ok(undefined);
  }

  private async restoreSlackConnections(): Promise<void> {
    const apps = slackAppStore.list();
    if (apps.length === 0) {
      return;
    }

    logger.log('Slack', 'Load', `[StartupService] 開始恢復 ${apps.length} 個 Slack App 連線`);

    const results = await Promise.allSettled(
      apps.map((app) => slackClientManager.initialize(app))
    );

    const appsWithResults = apps.map((slackApp, index) => ({ slackApp, result: results[index] }));
    for (const { slackApp, result } of appsWithResults) {
      if (result.status === 'rejected') {
        logger.error('Slack', 'Error', `[StartupService] Slack App「${slackApp.name}」初始化恢復失敗`, result.reason);
      }
    }

    logger.log('Slack', 'Complete', '[StartupService] Slack App 初始化恢復完成');
  }
}

export const startupService = new StartupService();
