/**
 * Claude 與 Codex provider 共用的唯一 cwd 解析來源。
 *
 * 此 helper 集中管理 Pod 工作目錄的解析邏輯，確保兩種 provider
 * 在路徑解析與安全驗證上的行為完全一致。
 */

import path from "path";
import type { Pod } from "../../types/pod.js";
import { config } from "../../config/index.js";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import { logger } from "../../utils/logger.js";

/**
 * 解析 Pod 的工作目錄。
 *
 * - 有 repositoryId → 使用 repositoriesRoot / repositoryId（驗證路徑在 repositoriesRoot 內）
 * - 否則 → 使用 pod.workspacePath（驗證在 canvasRoot 內）
 */
export function resolvePodCwd(pod: Pod): string {
  if (pod.repositoryId) {
    const resolvedCwd = path.resolve(
      path.join(config.repositoriesRoot, pod.repositoryId),
    );
    if (
      !isPathWithinDirectory(resolvedCwd, path.resolve(config.repositoriesRoot))
    ) {
      // sanitize repositoryId：截前 64 字元 + 移除控制字元，避免 log injection
      const truncatedRepoId = pod.repositoryId.slice(0, 64);
      // eslint-disable-next-line no-control-regex
      const safeRepoId = truncatedRepoId.replace(/[\x00-\x1f\x7f]/g, "");
      logger.error(
        "Pod",
        "Error",
        `resolvePodCwd：repositoryId 路徑穿越，podId=${pod.id}，repositoryId=${safeRepoId}`,
      );
      throw new Error("非法的工作目錄路徑");
    }
    return resolvedCwd;
  }

  const resolvedCwd = path.resolve(pod.workspacePath);
  if (!isPathWithinDirectory(resolvedCwd, path.resolve(config.canvasRoot))) {
    logger.error(
      "Pod",
      "Error",
      `resolvePodCwd：workspacePath 超出允許範圍，podId=${pod.id}`,
      pod.workspacePath,
    );
    throw new Error("工作目錄不在允許範圍內");
  }
  return resolvedCwd;
}
