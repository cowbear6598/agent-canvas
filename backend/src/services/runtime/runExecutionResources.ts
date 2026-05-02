import { promises as fs } from "fs";
import path from "path";

import { config } from "../../config/index.js";
import type { Pod } from "../../types/pod.js";
import { logger } from "../../utils/logger.js";
import { getResultErrorString } from "../../types/result.js";
import { ensureClaudeSandboxHomeSeeded } from "../claude/claudeSandboxLauncher.js";
import { gitService } from "../workspace/gitService.js";
import {
  getPodSandboxHomePath,
  getRunSandboxHomePath,
  getRunWorkspacePath,
} from "./executionPaths.js";

export interface ProvisionedRunExecutionResources {
  workspacePath: string;
  sandboxHomePath: string;
  worktreePath: string | null;
}

interface SharedWorkspaceResult {
  workspacePath: string;
  worktreePath: string | null;
}

function getSharedRepoSnapshotPath(
  runId: string,
  repositoryId: string,
): string {
  return path.resolve(
    path.join(config.runWorkspacesRoot, runId, `repository-${repositoryId}`),
  );
}

async function ensureEmptyDirectory(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyWorkspaceSnapshot(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await ensureEmptyDirectory(targetPath);
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    dereference: false,
  });
}

async function ensureNonRepoSourceWorkspace(sourcePath: string): Promise<void> {
  await fs.mkdir(sourcePath, { recursive: true });
}

async function provisionRunSandboxHome(
  runId: string,
  podId: string,
): Promise<string> {
  const runSandboxHomePath = getRunSandboxHomePath(runId, podId);
  await ensureEmptyDirectory(runSandboxHomePath);

  return runSandboxHomePath;
}

async function provisionRepositoryWorkspace(
  pod: Pod,
  runId: string,
  worktreeCache: Map<string, SharedWorkspaceResult>,
): Promise<SharedWorkspaceResult> {
  if (!pod.repositoryId) {
    throw new Error("repositoryId 不存在，無法配置 repo run workspace");
  }

  const cacheKey = pod.repositoryId;
  const cached = worktreeCache.get(cacheKey);
  if (cached) return cached;

  const sourceRepoPath = path.resolve(
    path.join(config.repositoriesRoot, pod.repositoryId),
  );

  if (!(await pathExists(sourceRepoPath))) {
    logger.error(
      "Run",
      "Error",
      `找不到 repository 路徑（repositoryId=${pod.repositoryId}, path=${sourceRepoPath}）`,
    );
    throw new Error("找不到 repository 路徑");
  }

  const isGitResult = await gitService.isGitRepository(sourceRepoPath);
  if (isGitResult.success && isGitResult.data) {
    const hasCommitsResult = await gitService.hasCommits(sourceRepoPath);
    if (hasCommitsResult.success && hasCommitsResult.data) {
      const syncResult = await gitService.syncToRemoteLatest(sourceRepoPath);
      if (!syncResult.success) {
        throw new Error(
          `同步 remote 最新版本失敗：${getResultErrorString(syncResult.error)}`,
        );
      }

      const worktreePath = path.join(
        config.repositoriesRoot,
        `${pod.repositoryId}-run-${runId}`,
      );
      const createResult = await gitService.createDetachedWorktree(
        sourceRepoPath,
        worktreePath,
      );

      if (createResult.success) {
        const provisioned = {
          workspacePath: worktreePath,
          worktreePath,
        };
        worktreeCache.set(cacheKey, provisioned);
        return provisioned;
      }
    }
  }

  const snapshotPath = getSharedRepoSnapshotPath(runId, pod.repositoryId);
  await copyWorkspaceSnapshot(sourceRepoPath, snapshotPath);

  const provisioned = {
    workspacePath: snapshotPath,
    worktreePath: null,
  };
  worktreeCache.set(cacheKey, provisioned);
  return provisioned;
}

async function provisionNonRepoWorkspace(
  pod: Pod,
  runId: string,
): Promise<SharedWorkspaceResult> {
  const sourceWorkspacePath = path.resolve(pod.workspacePath);
  await ensureNonRepoSourceWorkspace(sourceWorkspacePath);

  const runWorkspacePath = getRunWorkspacePath(runId, pod.id);
  await copyWorkspaceSnapshot(sourceWorkspacePath, runWorkspacePath);

  return {
    workspacePath: runWorkspacePath,
    worktreePath: null,
  };
}

export async function provisionRunExecutionResources(params: {
  pod: Pod;
  runId: string;
  worktreeCache: Map<string, SharedWorkspaceResult>;
}): Promise<ProvisionedRunExecutionResources> {
  const { pod, runId, worktreeCache } = params;

  const workspaceResult = pod.repositoryId
    ? await provisionRepositoryWorkspace(pod, runId, worktreeCache)
    : await provisionNonRepoWorkspace(pod, runId);

  // pod-level seed 必須在建立 run-level sandbox home 之前完成
  const podSandboxHomePath = getPodSandboxHomePath(pod.id);
  ensureClaudeSandboxHomeSeeded(podSandboxHomePath);

  const sandboxHomePath = await provisionRunSandboxHome(runId, pod.id);

  logger.log(
    "Run",
    "Create",
    `配置 run 資源完成（runId=${runId}, podId=${pod.id}, workspace=${workspaceResult.workspacePath}, sandboxHome=${sandboxHomePath})`,
  );

  return {
    workspacePath: workspaceResult.workspacePath,
    sandboxHomePath,
    worktreePath: workspaceResult.worktreePath,
  };
}
