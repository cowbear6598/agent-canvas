import path from "path";
import { promises as fs } from "fs";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import { removeGoalRuntimeRun } from "../goalRuntime.js";
import { cleanupOpencodeRunServers } from "../provider/opencodeProvider.js";
import { runStore } from "../runStore.js";
import { deferredPodWorkspaceCleanupService } from "../runtime/deferredPodWorkspaceCleanupService.js";

export class RunResourceLifecycleService {
  private async removeRunDirectory(
    dirPath: string,
    label: string,
  ): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        "Run",
        "Warn",
        `移除 ${label} 失敗（已忽略），path=${dirPath}: ${String(error)}`,
      );
    }
  }

  private async removeRunRepoDirectory(dirPath: string): Promise<void> {
    if (
      !isPathWithinDirectory(
        path.resolve(dirPath),
        path.resolve(config.runRepositoriesRoot),
      )
    ) {
      logger.warn(
        "Run",
        "Warn",
        `清理 run repo 失敗：路徑越界（path=${dirPath}）`,
      );
      return;
    }
    await this.removeRunDirectory(dirPath, "run repo");
  }

  async cleanupRunResources(runId: string): Promise<void> {
    cleanupOpencodeRunServers(runId);
    removeGoalRuntimeRun(runId);

    const entries = runStore.getExecutionPathsByRunId(runId);
    const uniqueRunRepos = new Set<string>();
    for (const entry of entries) {
      if (entry.runRepoPath) {
        uniqueRunRepos.add(entry.runRepoPath);
      }
    }

    try {
      await Promise.all(
        [...uniqueRunRepos].map((runRepoPath) =>
          this.removeRunRepoDirectory(runRepoPath),
        ),
      );
      runStore.clearExecutionPathsByRunId(runId);
    } finally {
      await deferredPodWorkspaceCleanupService.releaseRun(runId);
    }
  }
}
