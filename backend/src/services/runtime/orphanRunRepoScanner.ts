import fs from "fs/promises";
import path from "path";
import { config } from "../../config/index.js";
import { runStore } from "../runStore.js";
import { logger } from "../../utils/logger.js";

/**
 * 掃描 repositoriesRoot 內符合 `{repositoryId}-run-{anything}` 命名的資料夾，
 * 若其 runId 部分不在目前 active run 清單中，則記錄 warn 日誌。
 *
 * 不執行任何刪除動作，僅做日誌紀錄。
 */
export async function scanAndLogOrphanRunRepoDirectories(): Promise<void> {
  const rootDir = config.repositoriesRoot;

  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch {
    // 目錄不存在或無法讀取時靜默略過（首次啟動尚未建立目錄屬正常情況）
    return;
  }

  // 命名格式：{repositoryId}-run-{runId}
  // repositoryId 本身不含 "-run-"，因此從最後一個 "-run-" 切割
  const RUN_SEPARATOR = "-run-";

  const activeRunIds = new Set(runStore.getRunningRuns().map((run) => run.id));

  for (const entry of entries) {
    const sepIndex = entry.lastIndexOf(RUN_SEPARATOR);
    if (sepIndex === -1) {
      // 命名不符合 {repositoryId}-run-{anything} 格式，略過
      continue;
    }

    const runId = entry.slice(sepIndex + RUN_SEPARATOR.length);
    if (!runId) {
      // "-run-" 之後為空，略過
      continue;
    }

    if (!activeRunIds.has(runId)) {
      const dirPath = path.join(rootDir, entry);
      logger.warn("Run", "Orphan", `偵測到孤兒 run 隔離目錄：${dirPath}`);
    }
  }
}
