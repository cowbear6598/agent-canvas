import { logger } from "../../utils/logger.js";
import { workspaceService } from "../workspace/index.js";

class DeferredPodWorkspaceCleanupService {
  private readonly runIdsByWorkspacePath = new Map<string, Set<string>>();

  private readonly workspacePathsByRunId = new Map<string, Set<string>>();

  defer(workspacePath: string, runIds: readonly string[]): boolean {
    if (runIds.length === 0) return false;

    const workspaceRunIds =
      this.runIdsByWorkspacePath.get(workspacePath) ?? new Set<string>();
    for (const runId of runIds) {
      workspaceRunIds.add(runId);
      const workspacePaths =
        this.workspacePathsByRunId.get(runId) ?? new Set<string>();
      workspacePaths.add(workspacePath);
      this.workspacePathsByRunId.set(runId, workspacePaths);
    }
    this.runIdsByWorkspacePath.set(workspacePath, workspaceRunIds);
    return true;
  }

  async releaseRun(runId: string): Promise<void> {
    const workspacePaths = this.workspacePathsByRunId.get(runId);
    if (!workspacePaths) return;

    this.workspacePathsByRunId.delete(runId);
    for (const workspacePath of workspacePaths) {
      const workspaceRunIds = this.runIdsByWorkspacePath.get(workspacePath);
      if (!workspaceRunIds) continue;

      workspaceRunIds.delete(runId);
      if (workspaceRunIds.size > 0) continue;

      this.runIdsByWorkspacePath.delete(workspacePath);
      const result = await workspaceService.deleteWorkspace(workspacePath);
      if (!result.success) {
        logger.warn(
          "Run",
          "Warn",
          `延遲刪除 Pod 工作目錄失敗（path=${workspacePath}）：${String(result.error)}`,
        );
      }
    }
  }

  clear(): void {
    this.runIdsByWorkspacePath.clear();
    this.workspacePathsByRunId.clear();
  }
}

export const deferredPodWorkspaceCleanupService =
  new DeferredPodWorkspaceCleanupService();
