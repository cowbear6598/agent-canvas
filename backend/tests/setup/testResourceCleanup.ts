import { rm } from "node:fs/promises";
import { closeDb, resetDb } from "../../src/database/index.js";
import type { TestWebSocketClient } from "./socketClient.js";
import { disconnectSocket } from "./socketClient.js";
import type { TestServerInstance } from "./testServer.js";

type CleanupCallback = () => void | Promise<void>;

export class TestCleanupRegistry {
  private callbacks: CleanupCallback[] = [];

  add(callback: CleanupCallback): void {
    this.callbacks.push(callback);
  }

  addTempDirectory(path: string): void {
    this.add(() => rm(path, { recursive: true, force: true }));
  }

  addTimer(timer: ReturnType<typeof setTimeout>): void {
    this.add(() => {
      clearTimeout(timer);
      clearInterval(timer);
    });
  }

  addSocket(socket: TestWebSocketClient): void {
    this.add(async () => {
      if (socket.connected) {
        await disconnectSocket(socket);
      }
    });
  }

  addServer(server: TestServerInstance): void {
    this.add(async () => {
      const { closeTestServer } = await import("./testServer.js");
      await closeTestServer(server);
    });
  }

  addDatabaseRows(): void {
    this.add(() => resetDb());
  }

  addDatabaseConnection(): void {
    this.add(() => closeDb());
  }

  async cleanup(): Promise<void> {
    const callbacks = this.callbacks.splice(0).reverse();
    const errors: unknown[] = [];

    for (const callback of callbacks) {
      try {
        await callback();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "Test resource cleanup failed");
    }
  }
}

export function createTestCleanupRegistry(): TestCleanupRegistry {
  return new TestCleanupRegistry();
}

export async function stopBackgroundTestTimers(): Promise<void> {
  const [
    { scheduleService },
    { backupScheduleService },
    { tmpCleanupService },
    { unlockRateLimiter },
    { replyContextStore },
  ] = await Promise.all([
    import("../../src/services/scheduleService.js"),
    import("../../src/services/backupScheduleService.js"),
    import("../../src/services/tmpCleanupService.js"),
    import("../../src/services/auth/unlockRateLimiter.js"),
    import("../../src/services/integration/replyContextStore.js"),
  ]);

  scheduleService.stop();
  backupScheduleService.stop();
  backupScheduleService.reset();
  tmpCleanupService.stop();
  unlockRateLimiter.dispose();
  replyContextStore.dispose();
}
