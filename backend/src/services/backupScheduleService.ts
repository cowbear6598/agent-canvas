import { WebSocketResponseEvents } from "../schemas/index.js";
import { configStore } from "./configStore.js";
import { backupService } from "./backupService.js";
import { socketService } from "./socketService.js";
import { toOffsettedParts } from "../utils/timezoneUtils.js";
import { logger } from "../utils/logger.js";

const TICK_INTERVAL_MS = 1000;
const BACKUP_TRIGGER_SECOND = 0;

class BackupScheduleService {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private lastTriggeredDate: string | null = null;

  start(): void {
    const { backupEnabled } = configStore.getBackupConfig();
    if (!backupEnabled) {
      return;
    }

    this.tickInterval = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL_MS);

    logger.log("Backup", "Create", "備份排程器已啟動");
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    logger.log("Backup", "Delete", "備份排程器已停止");
  }

  reload(): void {
    this.stop();
    this.start();
  }

  /** 重置觸發狀態，僅供測試使用 */
  reset(): void {
    this.lastTriggeredDate = null;
  }

  private getOffsetDateString(offset: number): string {
    const parts = toOffsettedParts(new Date(), offset);
    return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.date).padStart(2, "0")}`;
  }

  private tick(): void {
    const { backupEnabled, backupTime, backupGitRemoteUrl } =
      configStore.getBackupConfig();

    if (!backupEnabled) {
      return;
    }

    const offset = configStore.getTimezoneOffset();
    const now = new Date();
    const parts = toOffsettedParts(now, offset);

    const [hourStr, minuteStr] = backupTime.split(":");
    const targetHour = parseInt(hourStr, 10);
    const targetMinute = parseInt(minuteStr, 10);

    if (
      parts.hours !== targetHour ||
      parts.minutes !== targetMinute ||
      parts.seconds !== BACKUP_TRIGGER_SECOND
    ) {
      return;
    }

    const today = this.getOffsetDateString(offset);

    if (this.lastTriggeredDate === today) {
      return;
    }

    this.fireBackup(backupGitRemoteUrl).catch((error) => {
      logger.error("Backup", "Error", "備份觸發失敗", error);
    });
  }

  private async fireBackup(remoteUrl: string): Promise<void> {
    const { backupEnabled } = configStore.getBackupConfig();
    const offset = configStore.getTimezoneOffset();
    const today = this.getOffsetDateString(offset);

    this.lastTriggeredDate = today;

    if (!backupEnabled) {
      return;
    }

    const timestamp = new Date().toISOString();

    socketService.emitToAll(WebSocketResponseEvents.BACKUP_STARTED, {
      timestamp,
    });

    logger.log("Backup", "Update", "開始執行自動備份");

    const result = await backupService.executeBackup(remoteUrl);

    if (result.success) {
      socketService.emitToAll(WebSocketResponseEvents.BACKUP_COMPLETED, {
        timestamp: new Date().toISOString(),
      });
      logger.log("Backup", "Complete", "自動備份完成");
    } else {
      socketService.emitToAll(WebSocketResponseEvents.BACKUP_FAILED, {
        error: result.error,
        timestamp: new Date().toISOString(),
      });
      logger.error("Backup", "Error", `自動備份失敗：${result.error}`);
    }
  }
}

export const backupScheduleService = new BackupScheduleService();
