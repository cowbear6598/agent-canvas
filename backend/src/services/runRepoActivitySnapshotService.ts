import { gitService } from "./workspace/gitService.js";
import { getResultErrorString } from "../types/result.js";
import { logger } from "../utils/logger.js";

export interface RunRepoActivitySnapshot {
  runId: string;
  podId: string;
  hasActivity: boolean;
  capturedAt: string;
  statusEntries: string[];
  snapshotPath: string;
}

function buildSnapshotKey(runId: string, podId: string): string {
  return `${runId}:${podId}`;
}

class RunRepoActivitySnapshotService {
  private readonly snapshots = new Map<string, RunRepoActivitySnapshot>();

  private readonly capturePromises = new Map<string, Promise<void>>();

  captureSnapshot(
    runId: string,
    podId: string,
    workspacePath: string,
  ): Promise<void> {
    const key = buildSnapshotKey(runId, podId);
    const existingPromise = this.capturePromises.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const capturePromise = this.captureSnapshotInternal(
      runId,
      podId,
      workspacePath,
    ).finally(() => {
      if (this.capturePromises.get(key) === capturePromise) {
        this.capturePromises.delete(key);
      }
    });

    this.capturePromises.set(key, capturePromise);
    return capturePromise;
  }

  async awaitCapture(runId: string, podId: string): Promise<void> {
    await (
      this.capturePromises.get(buildSnapshotKey(runId, podId)) ??
      Promise.resolve()
    );
  }

  consumeSnapshot(runId: string, podId: string): RunRepoActivitySnapshot | null {
    const key = buildSnapshotKey(runId, podId);
    const snapshot = this.snapshots.get(key) ?? null;
    if (snapshot) {
      this.snapshots.delete(key);
    }
    return snapshot;
  }

  clearRun(runId: string): void {
    for (const key of this.snapshots.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.snapshots.delete(key);
      }
    }

    for (const key of this.capturePromises.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.capturePromises.delete(key);
      }
    }
  }

  clearAll(): void {
    this.snapshots.clear();
    this.capturePromises.clear();
  }

  private async captureSnapshotInternal(
    runId: string,
    podId: string,
    workspacePath: string,
  ): Promise<void> {
    const statusResult = await gitService.getStatusSnapshot(workspacePath);
    if (!statusResult.success) {
      logger.warn(
        "Memory",
        "Warn",
        `檢查 Repo Memory git status 失敗（path=${workspacePath}）：${getResultErrorString(statusResult.error)}`,
      );
      return;
    }

    const { isGitRepository, entries } = statusResult.data;
    this.snapshots.set(buildSnapshotKey(runId, podId), {
      runId,
      podId,
      hasActivity: isGitRepository && entries.length > 0,
      capturedAt: new Date().toISOString(),
      statusEntries: entries,
      snapshotPath: workspacePath,
    });
  }
}

export const runRepoActivitySnapshotService =
  new RunRepoActivitySnapshotService();
