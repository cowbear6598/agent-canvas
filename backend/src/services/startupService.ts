import { podStore } from './podStore.js';
import { messageStore } from './messageStore.js';
import { noteStore, skillNoteStore, commandNoteStore, subAgentNoteStore, repositoryNoteStore, mcpServerNoteStore } from './noteStores.js';
import { mcpServerStore } from './mcpServerStore.js';
import { connectionStore } from './connectionStore.js';
import { scheduleService } from './scheduleService.js';
import { canvasStore } from './canvasStore.js';
import { repositoryService } from './repositoryService.js';
import { Result, ok, err } from '../types';
import { config } from '../config';
import { persistenceService } from './persistence';
import { logger } from '../utils/logger.js';
import { slackAppStore } from './slack/slackAppStore.js';
import { slackConnectionManager } from './slack/slackConnectionManager.js';

class StartupService {
  async initialize(): Promise<Result<void>> {
    const appDataResult = await persistenceService.ensureDirectory(config.appDataRoot);
    if (!appDataResult.success) {
      return err(`伺服器初始化失敗: ${appDataResult.error}`);
    }

    const canvasRootResult = await persistenceService.ensureDirectory(config.canvasRoot);
    if (!canvasRootResult.success) {
      return err(`伺服器初始化失敗: ${canvasRootResult.error}`);
    }

    const repoResult = await persistenceService.ensureDirectory(config.repositoriesRoot);
    if (!repoResult.success) {
      return err(`伺服器初始化失敗: ${repoResult.error}`);
    }

    await repositoryService.initialize();

    await mcpServerStore.loadFromDisk(config.appDataRoot);

    const canvasLoadResult = await canvasStore.loadFromDisk();
    if (!canvasLoadResult.success) {
      return err(`伺服器初始化失敗: ${canvasLoadResult.error}`);
    }

    const canvases = canvasStore.list();
    if (canvases.length === 0) {
      logger.log('Startup', 'Create', '未找到任何畫布，建立預設畫布');
      const defaultCanvasResult = await canvasStore.create('default');
      if (!defaultCanvasResult.success) {
        return err(`建立預設 Canvas 失敗: ${defaultCanvasResult.error}`);
      }
      canvases.push(defaultCanvasResult.data);
    }

    for (const canvas of canvases) {
      const canvasDir = canvasStore.getCanvasDir(canvas.id);
      const canvasDataDir = canvasStore.getCanvasDataDir(canvas.id);

      if (!canvasDir || !canvasDataDir) {
        logger.error('Startup', 'Error', `無法取得畫布目錄：${canvas.name}`);
        continue;
      }

      const podLoadResult = await podStore.loadFromDisk(canvas.id, canvasDir);
      if (!podLoadResult.success) {
        logger.error('Startup', 'Error', `載入畫布 Pod 失敗：${canvas.name}：${podLoadResult.error}`);
        continue;
      }

      const pods = podStore.getAll(canvas.id);
      const messageLoadPromises = pods.map((pod) =>
        messageStore.loadMessagesFromDisk(canvasDir, pod.id)
      );
      await Promise.all(messageLoadPromises);

      await noteStore.loadFromDisk(canvas.id, canvasDataDir);
      await skillNoteStore.loadFromDisk(canvas.id, canvasDataDir);
      await commandNoteStore.loadFromDisk(canvas.id, canvasDataDir);
      await subAgentNoteStore.loadFromDisk(canvas.id, canvasDataDir);
      await repositoryNoteStore.loadFromDisk(canvas.id, canvasDataDir);
      await mcpServerNoteStore.loadFromDisk(canvas.id, canvasDataDir);
      await connectionStore.loadFromDisk(canvas.id, canvasDataDir);

      logger.log('Startup', 'Complete', `已載入畫布：${canvas.name}`);
    }

    scheduleService.start();

    // 背景恢復 Slack 連線，不阻塞 WS server 啟動，以確保廣播時已有 client 可接收
    this.restoreSlackConnections().catch((error) => {
      logger.error('Slack', 'Error', '[StartupService] Slack 連線恢復時發生非預期錯誤', error);
    });

    logger.log('Startup', 'Complete', '伺服器初始化完成');
    return ok(undefined);
  }
  private async restoreSlackConnections(): Promise<void> {
    await slackAppStore.loadFromDisk(config.appDataRoot);

    const apps = slackAppStore.list();
    if (apps.length === 0) {
      return;
    }

    logger.log('Slack', 'Load', `[StartupService] 開始恢復 ${apps.length} 個 Slack App 連線`);

    const results = await Promise.allSettled(
      apps.map((app) => slackConnectionManager.connect(app))
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const reason = (results[i] as PromiseRejectedResult).reason;
        logger.error('Slack', 'Error', `[StartupService] Slack App「${apps[i].name}」連線恢復失敗`, reason);
      }
    }

    slackConnectionManager.startHealthCheck();
    logger.log('Slack', 'Complete', '[StartupService] Slack App 連線恢復完成');
  }
}

export const startupService = new StartupService();
