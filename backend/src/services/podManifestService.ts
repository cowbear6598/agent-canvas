import fs from "node:fs/promises";
import path from "node:path";
import { isPathWithinDirectory } from "../utils/pathValidator.js";
import { logger } from "../utils/logger.js";
import { repositoryService } from "./repositoryService.js";
import { getStmts } from "../database/stmtsHelper.js";
import { safeJsonParse } from "../utils/safeJsonParse.js";

interface PodManifestRow {
  pod_id: string;
  repository_id: string;
  files_json: string;
}

const CLAUDE_DIR = ".claude";

class PodManifestService {
  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  readManifest(repositoryId: string, podId: string): string[] {
    const row = this.stmts.podManifest.selectByPodIdAndRepoId.get({
      $podId: podId,
      $repoId: repositoryId,
    }) as PodManifestRow | null;

    if (!row) {
      return [];
    }

    const parsed = safeJsonParse<string[]>(row.files_json);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  }

  writeManifest(
    repositoryId: string,
    podId: string,
    managedFiles: string[],
  ): void {
    this.stmts.podManifest.upsert.run({
      $podId: podId,
      $repositoryId: repositoryId,
      $filesJson: JSON.stringify(managedFiles),
    });
  }

  private async deleteSingleManagedFile(
    absPath: string,
    repositoryPath: string,
    claudeDir: string,
    dirsToCheck: Set<string>,
  ): Promise<void> {
    if (!isPathWithinDirectory(absPath, repositoryPath)) {
      logger.warn("Pod", "Delete", `偵測到不安全的路徑，跳過刪除: ${absPath}`);
      return;
    }

    await fs.rm(absPath, { force: true });

    let dir = path.dirname(absPath);
    while (dir !== claudeDir && isPathWithinDirectory(dir, claudeDir)) {
      dirsToCheck.add(dir);
      dir = path.dirname(dir);
    }
  }

  private async cleanEmptyDirectories(dirsToCheck: Set<string>): Promise<void> {
    const sortedDirs = [...dirsToCheck].sort((a, b) => b.length - a.length);
    for (const dir of sortedDirs) {
      await fs
        .readdir(dir)
        .then((entries) => {
          if (entries.length === 0) {
            return fs.rmdir(dir);
          }
        })
        .catch(() => {});
    }
  }

  async deleteManagedFiles(repositoryId: string, podId: string): Promise<void> {
    const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
    const managedFiles = this.readManifest(repositoryId, podId);
    const claudeDir = path.join(repositoryPath, CLAUDE_DIR);
    const dirsToCheck = new Set<string>();

    for (const relPath of managedFiles) {
      const absPath = path.join(repositoryPath, relPath);
      await this.deleteSingleManagedFile(
        absPath,
        repositoryPath,
        claudeDir,
        dirsToCheck,
      );
    }

    await this.cleanEmptyDirectories(dirsToCheck);
    this.deleteManifestRecord(repositoryId, podId);
  }

  deleteManifestRecord(repositoryId: string, podId: string): void {
    this.stmts.podManifest.deleteByPodIdAndRepoId.run({
      $podId: podId,
      $repoId: repositoryId,
    });
  }

  collectCommandFiles(commandId: string): string[] {
    return [`${CLAUDE_DIR}/commands/${commandId}.md`];
  }

  collectSubAgentFiles(subAgentId: string): string[] {
    return [`${CLAUDE_DIR}/agents/${subAgentId}.md`];
  }
}

export const podManifestService = new PodManifestService();
