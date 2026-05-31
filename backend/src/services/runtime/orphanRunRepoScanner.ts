import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";
import { config } from "../../config/index.js";
import { runStore } from "../runStore.js";
import { logger } from "../../utils/logger.js";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import { parseRunRepoDirectoryName } from "./runRepoDirectoryName.js";

/**
 * 掃描 runRepositoriesRoot 內符合 `{repositoryId}-agnet-canvas-{anything}` 命名的資料夾，
 * 若其 runId 部分不在目前 active run 清單中，則記錄 warn 日誌並刪除孤兒目錄。
 */
export async function scanAndCleanupOrphanRunRepoDirectories(): Promise<void> {
  const rootDir = config.runRepositoriesRoot;
  const resolvedRootDir = path.resolve(rootDir);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }

  const activeRunIds = new Set(runStore.getRunningRuns().map((run) => run.id));

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const parsedName = parseRunRepoDirectoryName(entry.name);
    if (!parsedName) {
      continue;
    }

    if (!activeRunIds.has(parsedName.runId)) {
      const dirPath = path.join(rootDir, entry.name);
      const resolvedDirPath = path.resolve(dirPath);

      if (!isPathWithinDirectory(resolvedDirPath, resolvedRootDir)) {
        logger.warn(
          "Run",
          "Warn",
          `清理孤兒 run 隔離目錄失敗：路徑越界（path=${resolvedDirPath}）`,
        );
        continue;
      }

      logger.warn("Run", "Orphan", `偵測到孤兒 run 隔離目錄：${dirPath}`);
      try {
        await fs.rm(resolvedDirPath, { recursive: true, force: true });
      } catch (error) {
        logger.warn(
          "Run",
          "Warn",
          `清理孤兒 run 隔離目錄失敗（已忽略），path=${resolvedDirPath}: ${String(error)}`,
        );
      }
    }
  }
}
