import type { RunContext } from "../../types/run.js";
import type { RunPodInstance } from "../runStore.js";
import type { Pod } from "../../types/index.js";

export interface RunSnapshotEntry {
  podId: string;
  snapshotPath: string;
}

export function buildCompletedRunSnapshotEntries(
  canvasId: string,
  instances: RunPodInstance[],
  getPodById: (canvasId: string, podId: string) => Pod | undefined,
): RunSnapshotEntry[] {
  const seenRepositoryIds = new Set<string>();

  return instances.flatMap((instance) => {
    const pod = getPodById(canvasId, instance.podId);
    const repositoryId = pod?.repositoryId ?? null;
    const snapshotPath = instance.runRepoPath ?? instance.workspacePath ?? null;
    if (!repositoryId || !snapshotPath || seenRepositoryIds.has(repositoryId)) {
      return [];
    }

    seenRepositoryIds.add(repositoryId);
    return [{ podId: instance.podId, snapshotPath }] as const;
  });
}

export async function completeRunLifecycle(params: {
  runId: string;
  maintenanceContext: RunContext;
  snapshotEntries: RunSnapshotEntry[];
  captureSnapshot: (
    runId: string,
    podId: string,
    snapshotPath: string,
  ) => Promise<void>;
  scheduleRepositoriesForCompletedRun: (
    runContext: RunContext,
  ) => Promise<void>;
  cleanupRunResources: (runId: string) => Promise<void>;
}): Promise<void> {
  try {
    await Promise.all(
      params.snapshotEntries.map((entry) =>
        params.captureSnapshot(params.runId, entry.podId, entry.snapshotPath),
      ),
    );
    await params.scheduleRepositoriesForCompletedRun(params.maintenanceContext);
  } finally {
    await params.cleanupRunResources(params.runId);
  }
}
