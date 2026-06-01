import { memoryStateService } from "./memoryStateService.js";
import { logger } from "../utils/logger.js";

const INTERVAL_MS = 24 * 60 * 60 * 1000;

class MemoryCleanupService {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    void this.runOnce();

    this.timer = setInterval(() => {
      void this.runOnce();
    }, INTERVAL_MS);

    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    const result = memoryStateService.pruneExpiredMaintenanceRecords(now);
    if (result.deletedJobs === 0 && result.deletedObservations === 0) {
      return;
    }

    logger.log(
      "Cleanup",
      "Complete",
      `Memory 維護資料清理完成（jobs=${result.deletedJobs}, observations=${result.deletedObservations}）`,
    );
  }
}

export const memoryCleanupService = new MemoryCleanupService();
