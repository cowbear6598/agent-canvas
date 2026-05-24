import fs from "fs/promises";
import path from "path";
import { config } from "../../config/index.js";
import { runStore } from "../runStore.js";
import { logger } from "../../utils/logger.js";
import { parseRunRepoDirectoryName } from "./runRepoDirectoryName.js";

/**
 * 掃描 runRepositoriesRoot 內符合 `{repositoryId}-agnet-canvas-{anything}` 命名的資料夾，
 * 若其 runId 部分不在目前 active run 清單中，則記錄 warn 日誌。
 *
 * 不執行任何刪除動作，僅做日誌紀錄。
 */
export async function scanAndLogOrphanRunRepoDirectories(): Promise<void> {
  const rootDir = config.runRepositoriesRoot;

  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
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
    const parsedName = parseRunRepoDirectoryName(entry);
    if (!parsedName) {
      continue;
    }

    if (!activeRunIds.has(parsedName.runId)) {
      const dirPath = path.join(rootDir, entry);
      logger.warn("Run", "Orphan", `偵測到孤兒 run 隔離目錄：${dirPath}`);
    }
  }
}
