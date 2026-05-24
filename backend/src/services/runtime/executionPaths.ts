import path from "path";

import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import { config } from "../../config/index.js";
import { InvalidWorkspaceError } from "../../utils/errorHelpers.js";
import { logger } from "../../utils/logger.js";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import { runStore } from "../runStore.js";
import { resolvePodCwd } from "../shared/podPathResolver.js";

export interface ExecutionPaths {
  workspacePath: string;
}

function resolveWithinRoot(candidatePath: string, rootPath: string): string {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);

  if (!isPathWithinDirectory(resolvedCandidate, resolvedRoot)) {
    logger.error(
      "Chat",
      "Check",
      `[executionPaths] 路徑驗證失敗：path="${resolvedCandidate}" 不在 root="${resolvedRoot}" 內`,
    );
    throw new InvalidWorkspaceError("執行路徑驗證失敗");
  }

  return resolvedCandidate;
}

function resolveRunWorkspacePath(pod: Pod, runContext: RunContext): string {
  const instance = runStore.getPodInstance(runContext.runId, pod.id);

  if (instance?.workspacePath) {
    const resolvedWorkspace = path.resolve(instance.workspacePath);
    const allowedRoots = [
      config.repositoriesRoot,
      config.runRepositoriesRoot,
      config.canvasRoot,
    ].map((root) => path.resolve(root));

    if (
      !allowedRoots.some((root) =>
        isPathWithinDirectory(resolvedWorkspace, root),
      )
    ) {
      logger.error(
        "Chat",
        "Check",
        `[executionPaths] run workspace 驗證失敗：workspacePath="${resolvedWorkspace}"（podId=${pod.id}, runId=${runContext.runId}）`,
      );
      throw new InvalidWorkspaceError("執行工作目錄驗證失敗");
    }

    return resolvedWorkspace;
  }

  if (instance?.runRepoPath) {
    return resolveWithinRoot(instance.runRepoPath, config.runRepositoriesRoot);
  }

  return resolvePodCwd(pod);
}

export function resolveExecutionPaths(
  pod: Pod,
  runContext?: RunContext,
): ExecutionPaths {
  if (!runContext) {
    return {
      workspacePath: resolvePodCwd(pod),
    };
  }

  return {
    workspacePath: resolveRunWorkspacePath(pod, runContext),
  };
}
