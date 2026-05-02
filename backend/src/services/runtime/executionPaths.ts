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
  sandboxHomePath: string;
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

function resolveRunWorkspacePath(
  pod: Pod,
  runContext: RunContext,
): string {
  const instance = runStore.getPodInstance(runContext.runId, pod.id);

  if (instance?.workspacePath) {
    const resolvedWorkspace = path.resolve(instance.workspacePath);
    const allowedRoots = [
      config.runWorkspacesRoot,
      config.repositoriesRoot,
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

  if (instance?.worktreePath) {
    return resolveWithinRoot(instance.worktreePath, config.repositoriesRoot);
  }

  return resolvePodCwd(pod);
}

export function getPodSandboxHomePath(podId: string): string {
  return path.resolve(path.join(config.claudeSandboxRoot, "pods", podId, "home"));
}

export function getRunSandboxHomePath(runId: string, podId: string): string {
  return path.resolve(
    path.join(config.claudeSandboxRoot, "runs", runId, "pods", podId, "home"),
  );
}

export function getRunWorkspacePath(runId: string, podId: string): string {
  return path.resolve(path.join(config.runWorkspacesRoot, runId, podId));
}

export function resolveExecutionPaths(
  pod: Pod,
  runContext?: RunContext,
): ExecutionPaths {
  if (!runContext) {
    return {
      workspacePath: resolvePodCwd(pod),
      sandboxHomePath: resolveWithinRoot(
        getPodSandboxHomePath(pod.id),
        config.claudeSandboxRoot,
      ),
    };
  }

  const instance = runStore.getPodInstance(runContext.runId, pod.id);
  const sandboxHomePath = instance?.sandboxHomePath
    ? resolveWithinRoot(instance.sandboxHomePath, config.claudeSandboxRoot)
    : resolveWithinRoot(
        getRunSandboxHomePath(runContext.runId, pod.id),
        config.claudeSandboxRoot,
      );

  return {
    workspacePath: resolveRunWorkspacePath(pod, runContext),
    sandboxHomePath,
  };
}
