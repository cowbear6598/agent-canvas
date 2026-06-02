import { getResultErrorString } from "../types/result.js";
import { logger } from "../utils/logger.js";
import { gitService } from "./workspace/gitService.js";

interface RunExecutionPathEntry {
  podId: string;
  runRepoPath: string | null;
  workspacePath: string | null;
}

export interface RunRepoActivitySnapshot {
  runId: string;
  podId: string;
  hasActivity: boolean;
  capturedAt: string;
}

function buildSnapshotKey(runId: string, podId: string): string {
  return `${runId}:${podId}`;
}

function isIgnorablePathError(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("no such file or directory") ||
    normalized.includes("enoent") ||
    normalized.includes("unable to read current working directory")
  );
}

class RunRepoActivitySnapshotService {
  private readonly snapshots = new Map<string, RunRepoActivitySnapshot>();

  private readonly runCapturePromises = new Map<string, Promise<void>>();

  primeRunCapture(
    runId: string,
    entries: RunExecutionPathEntry[],
  ): Promise<void> {
    const existingPromise = this.runCapturePromises.get(runId);
    if (existingPromise) {
      return existingPromise;
    }

    const capturePromise = this.captureRunSnapshots(runId, entries).finally(() => {
      if (this.runCapturePromises.get(runId) === capturePromise) {
        this.runCapturePromises.delete(runId);
      }
    });

    this.runCapturePromises.set(runId, capturePromise);
    return capturePromise;
  }

  async awaitRunCapture(runId: string): Promise<void> {
    await (this.runCapturePromises.get(runId) ?? Promise.resolve());
  }

  async capturePodSnapshot(params: {
    runId: string;
    podId: string;
    runRepoPath: string | null;
    workspacePath: string | null;
  }): Promise<RunRepoActivitySnapshot | null> {
    const hasActivity = await this.detectRepositoryActivity(params);
    if (hasActivity === null) {
      return null;
    }

    const snapshot: RunRepoActivitySnapshot = {
      runId: params.runId,
      podId: params.podId,
      hasActivity,
      capturedAt: new Date().toISOString(),
    };
    this.snapshots.set(buildSnapshotKey(params.runId, params.podId), snapshot);
    return snapshot;
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
    this.runCapturePromises.delete(runId);
  }

  clearAll(): void {
    this.snapshots.clear();
    this.runCapturePromises.clear();
  }

  private async captureRunSnapshots(
    runId: string,
    entries: RunExecutionPathEntry[],
  ): Promise<void> {
    await Promise.all(
      entries.map((entry) =>
        this.capturePodSnapshot({
          runId,
          podId: entry.podId,
          runRepoPath: entry.runRepoPath,
          workspacePath: entry.workspacePath,
        }),
      ),
    );
  }

  private async detectRepositoryActivity(params: {
    runRepoPath: string | null;
    workspacePath: string | null;
  }): Promise<boolean | null> {
    const candidatePaths = [...new Set([
      params.runRepoPath,
      params.workspacePath,
    ])].filter((value): value is string => typeof value === "string" && value.length > 0);

    let checkedGitStatus = false;
    let checkedNonGitPath = false;

    for (const candidatePath of candidatePaths) {
      const isGitResult = await gitService.isGitRepository(candidatePath);
      if (!isGitResult.success) {
        const errorMessage = getResultErrorString(isGitResult.error);
        if (!isIgnorablePathError(errorMessage)) {
          logger.warn(
            "Memory",
            "Warn",
            `檢查 Repo Memory git 狀態失敗（path=${candidatePath}）：${errorMessage}`,
          );
        }
        continue;
      }

      if (!isGitResult.data) {
        checkedNonGitPath = true;
        continue;
      }

      const dirtyResult = await gitService.hasUncommittedChanges(candidatePath);
      if (!dirtyResult.success) {
        const errorMessage = getResultErrorString(dirtyResult.error);
        if (!isIgnorablePathError(errorMessage)) {
          logger.warn(
            "Memory",
            "Warn",
            `檢查 Repo Memory git status 失敗（path=${candidatePath}）：${errorMessage}`,
          );
        }
        continue;
      }

      checkedGitStatus = true;
      if (dirtyResult.data) {
        return true;
      }
    }

    if (checkedGitStatus || checkedNonGitPath) {
      return false;
    }

    return null;
  }
}

export const runRepoActivitySnapshotService =
  new RunRepoActivitySnapshotService();
