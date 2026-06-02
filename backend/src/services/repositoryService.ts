import { promises as fs } from "fs";
import path from "path";
import { config } from "../config";
import { isPathWithinDirectory } from "../utils/pathValidator.js";
import { directoryExists } from "./shared/fileResourceHelpers.js";
import { getDb } from "../database/index.js";
import { getStatements } from "../database/statements.js";
import type { Repository } from "../types/repository.js";
import { memoryStateService } from "./memoryStateService.js";

interface RepositoryMetadataRow {
  id: string;
  name: string;
  path: string;
  current_branch: string | null;
}

interface RepositoryMetadata {
  name?: string;
  currentBranch?: string;
}

class RepositoryService {
  private get stmts(): ReturnType<typeof getStatements>["repositoryMetadata"] {
    return getStatements(getDb()).repositoryMetadata;
  }

  async initialize(): Promise<void> {
    // no-op：初始化邏輯由 startupService 統一管理
  }

  async list(): Promise<
    Array<
      Pick<
        Repository,
        "id" | "name" | "currentBranch" | "repoMemoryEnabled" | "hasRepoMemory"
      >
    >
  > {
    await fs.mkdir(config.repositoriesRoot, { recursive: true });

    const entries = await fs.readdir(config.repositoriesRoot, {
      withFileTypes: true,
    });
    const repositories: Array<
      Pick<
        Repository,
        "id" | "name" | "currentBranch" | "repoMemoryEnabled" | "hasRepoMemory"
      >
    > = [];
    const repoStateMap = memoryStateService.listRepoStates(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    );

    // 一次查詢取得所有 metadata，建 Map 後 O(1) 查找，避免 N+1 查詢
    const allRows = this.stmts.selectAll.all() as RepositoryMetadataRow[];
    const metadataMap = new Map(allRows.map((row) => [row.id, row]));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const row = metadataMap.get(entry.name) ?? null;
      repositories.push({
        id: entry.name,
        name: entry.name,
        repoMemoryEnabled: repoStateMap.get(entry.name)?.memoryEnabled ?? false,
        hasRepoMemory: repoStateMap.get(entry.name)?.hasSummary ?? false,
        ...(row?.current_branch && { currentBranch: row.current_branch }),
      });
    }

    return repositories;
  }

  async create(
    name: string,
  ): Promise<Pick<Repository, "id" | "name" | "repoMemoryEnabled" | "hasRepoMemory">> {
    // 字元白名單驗證：僅允許字母、數字、底線、連字號、點，且不能以 `..` 開頭
    if (!/^[a-zA-Z0-9_\-.]+$/.test(name)) {
      throw new Error(
        "Repository 名稱僅允許字母、數字、底線（_）、連字號（-）及點（.）",
      );
    }
    if (name.startsWith("..")) {
      throw new Error("Repository 名稱不能以 .. 開頭");
    }

    const repositoryPath = path.join(config.repositoriesRoot, name);

    if (!isPathWithinDirectory(repositoryPath, config.repositoriesRoot)) {
      throw new Error("無效的 Repository 路徑");
    }

    await fs.mkdir(repositoryPath, { recursive: true });

    return { id: name, name, repoMemoryEnabled: false, hasRepoMemory: false };
  }

  getMetadata(repositoryId: string): RepositoryMetadata | undefined {
    const row = this.stmts.selectById.get(
      repositoryId,
    ) as RepositoryMetadataRow | null;

    if (!row) return undefined;

    return {
      ...(row.name && { name: row.name }),
      ...(row.current_branch && { currentBranch: row.current_branch }),
    };
  }

  async registerMetadata(
    repositoryId: string,
    metadata: RepositoryMetadata,
  ): Promise<void> {
    const repositoryPath = this.getRepositoryPath(repositoryId);
    this.stmts.upsert.run({
      $id: repositoryId,
      $name: repositoryId,
      $path: repositoryPath,
      $currentBranch: metadata.currentBranch ?? null,
    });
    return Promise.resolve();
  }

  async exists(repositoryId: string): Promise<boolean> {
    const repositoryPath = this.getRepositoryPath(repositoryId);
    return directoryExists(repositoryPath);
  }

  getRepositoryPath(repositoryId: string): string {
    // 字元白名單驗證：僅允許字母、數字、底線、連字號、點，且不能以 `..` 開頭
    if (!/^[a-zA-Z0-9_\-.]+$/.test(repositoryId)) {
      throw new Error(
        "Repository ID 僅允許字母、數字、底線（_）、連字號（-）及點（.）",
      );
    }
    if (repositoryId.startsWith("..")) {
      throw new Error("Repository ID 不能以 .. 開頭");
    }

    const repositoryPath = path.join(config.repositoriesRoot, repositoryId);

    if (!isPathWithinDirectory(repositoryPath, config.repositoriesRoot)) {
      throw new Error("無效的 Repository 路徑");
    }

    return repositoryPath;
  }

  getParentDirectory(): string {
    return config.repositoriesRoot;
  }

  async delete(repositoryId: string): Promise<void> {
    const repositoryPath = this.getRepositoryPath(repositoryId);

    if (!isPathWithinDirectory(repositoryPath, config.repositoriesRoot)) {
      throw new Error(`無效的 Repository 路徑：${repositoryId}`);
    }

    await fs.rm(repositoryPath, { recursive: true, force: true });

    this.stmts.deleteById.run(repositoryId);
    memoryStateService.clearScopeMaintenanceRecords("repository", repositoryId);
    memoryStateService.deleteRepoState(repositoryId);
  }
}

export const repositoryService = new RepositoryService();
