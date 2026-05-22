import { promises as fs } from "fs";
import path from "path";

import { config } from "../../config/index.js";
import type { Pod } from "../../types/pod.js";
import { logger } from "../../utils/logger.js";
import { getResultErrorString } from "../../types/result.js";
import { gitService } from "../workspace/gitService.js";

export interface ProvisionedRunExecutionResources {
  workspacePath: string;
  runRepoPath: string | null;
}

interface SharedWorkspaceResult {
  workspacePath: string;
  runRepoPath: string | null;
}

function createDirectWorkspaceResult(
  workspacePath: string,
): SharedWorkspaceResult {
  return {
    workspacePath,
    runRepoPath: null,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureNonRepoSourceWorkspace(sourcePath: string): Promise<void> {
  await fs.mkdir(sourcePath, { recursive: true });
}

async function provisionRepositoryWorkspace(
  pod: Pod,
  runId: string,
  runRepoCache: Map<string, SharedWorkspaceResult>,
): Promise<SharedWorkspaceResult> {
  if (!pod.repositoryId) {
    throw new Error("repositoryId 不存在，無法配置 repo run workspace");
  }

  const cacheKey = pod.repositoryId;
  const cached = runRepoCache.get(cacheKey);
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
  if (!isGitResult.success) {
    throw new Error(
      `檢查 repository git 狀態失敗：${getResultErrorString(isGitResult.error)}`,
    );
  }
  if (!isGitResult.data) {
    const provisioned = createDirectWorkspaceResult(sourceRepoPath);
    runRepoCache.set(cacheKey, provisioned);
    return provisioned;
  }

  const hasCommitsResult = await gitService.hasCommits(sourceRepoPath);
  if (!hasCommitsResult.success) {
    throw new Error(
      `檢查 repository commit 狀態失敗：${getResultErrorString(hasCommitsResult.error)}`,
    );
  }
  if (!hasCommitsResult.data) {
    const provisioned = createDirectWorkspaceResult(sourceRepoPath);
    runRepoCache.set(cacheKey, provisioned);
    return provisioned;
  }

  const hasOriginResult = await gitService.hasOriginRemote(sourceRepoPath);
  if (!hasOriginResult.success) {
    throw new Error(
      `檢查 origin remote 失敗：${getResultErrorString(hasOriginResult.error)}`,
    );
  }
  if (!hasOriginResult.data) {
    const provisioned = createDirectWorkspaceResult(sourceRepoPath);
    runRepoCache.set(cacheKey, provisioned);
    return provisioned;
  }

  const syncResult = await gitService.syncToRemoteLatest(sourceRepoPath);
  if (!syncResult.success) {
    throw new Error(
      `同步 remote 最新版本失敗：${getResultErrorString(syncResult.error)}`,
    );
  }

  const runRepoPath = path.join(
    config.repositoriesRoot,
    `${pod.repositoryId}-run-${runId}`,
  );
  const createResult = await gitService.createLocalClone(
    sourceRepoPath,
    runRepoPath,
  );

  if (!createResult.success) {
    throw new Error(getResultErrorString(createResult.error));
  }

  const provisioned = {
    workspacePath: runRepoPath,
    runRepoPath,
  };
  runRepoCache.set(cacheKey, provisioned);
  return provisioned;
}

async function provisionNonRepoWorkspace(
  pod: Pod,
): Promise<SharedWorkspaceResult> {
  const sourceWorkspacePath = path.resolve(pod.workspacePath);
  await ensureNonRepoSourceWorkspace(sourceWorkspacePath);

  return {
    workspacePath: sourceWorkspacePath,
    runRepoPath: null,
  };
}

export async function provisionRunExecutionResources(params: {
  pod: Pod;
  runId: string;
  runRepoCache: Map<string, SharedWorkspaceResult>;
}): Promise<ProvisionedRunExecutionResources> {
  const { pod, runId, runRepoCache } = params;

  const workspaceResult = pod.repositoryId
    ? await provisionRepositoryWorkspace(pod, runId, runRepoCache)
    : await provisionNonRepoWorkspace(pod);

  return {
    workspacePath: workspaceResult.workspacePath,
    runRepoPath: workspaceResult.runRepoPath,
  };
}
