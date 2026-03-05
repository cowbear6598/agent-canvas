import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import { isPathWithinDirectory } from '../utils/pathValidator.js';
import { directoryExists } from './shared/fileResourceHelpers.js';
import { getDb } from '../database/index.js';
import { getStatements } from '../database/statements.js';

interface RepositoryMetadataRow {
    id: string;
    name: string;
    path: string;
    parent_repo_id: string | null;
    branch_name: string | null;
    current_branch: string | null;
}

interface RepositoryMetadata {
    parentRepoId?: string;
    branchName?: string;
    currentBranch?: string;
}

class RepositoryService {
    private get stmts(): ReturnType<typeof getStatements>['repositoryMetadata'] {
        return getStatements(getDb()).repositoryMetadata;
    }

    async initialize(): Promise<void> {
        return Promise.resolve();
    }

    async list(): Promise<Array<{ id: string; name: string; parentRepoId?: string; branchName?: string; currentBranch?: string }>> {
        await fs.mkdir(config.repositoriesRoot, { recursive: true });

        const entries = await fs.readdir(config.repositoriesRoot, { withFileTypes: true });
        const repositories: Array<{ id: string; name: string; parentRepoId?: string; branchName?: string; currentBranch?: string }> = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const row = this.stmts.selectById.get(entry.name) as RepositoryMetadataRow | null;
            repositories.push({
                id: entry.name,
                name: entry.name,
                ...(row?.parent_repo_id && { parentRepoId: row.parent_repo_id }),
                ...(row?.branch_name && { branchName: row.branch_name }),
                ...(row?.current_branch && { currentBranch: row.current_branch }),
            });
        }

        return repositories;
    }

    async create(name: string, options?: { parentRepoId?: string; branchName?: string }): Promise<{ id: string; name: string }> {
        const repositoryPath = path.join(config.repositoriesRoot, name);

        if (!isPathWithinDirectory(repositoryPath, config.repositoriesRoot)) {
            throw new Error('無效的 Repository 路徑');
        }

        await fs.mkdir(repositoryPath, { recursive: true });

        if (options?.parentRepoId || options?.branchName) {
            this.stmts.upsert.run({
                $id: name,
                $name: name,
                $path: repositoryPath,
                $parentRepoId: options.parentRepoId ?? null,
                $branchName: options.branchName ?? null,
                $currentBranch: null,
            });
        }

        return { id: name, name };
    }

    getMetadata(repositoryId: string): RepositoryMetadata | undefined {
        const row = this.stmts.selectById.get(repositoryId) as RepositoryMetadataRow | null;

        if (!row) return undefined;

        return {
            ...(row.parent_repo_id && { parentRepoId: row.parent_repo_id }),
            ...(row.branch_name && { branchName: row.branch_name }),
            ...(row.current_branch && { currentBranch: row.current_branch }),
        };
    }

    async registerMetadata(repositoryId: string, metadata: RepositoryMetadata): Promise<void> {
        const repositoryPath = this.getRepositoryPath(repositoryId);
        this.stmts.upsert.run({
            $id: repositoryId,
            $name: repositoryId,
            $path: repositoryPath,
            $parentRepoId: metadata.parentRepoId ?? null,
            $branchName: metadata.branchName ?? null,
            $currentBranch: metadata.currentBranch ?? null,
        });
        return Promise.resolve();
    }

    async exists(repositoryId: string): Promise<boolean> {
        const repositoryPath = this.getRepositoryPath(repositoryId);
        return directoryExists(repositoryPath);
    }

    getRepositoryPath(repositoryId: string): string {
        const repositoryPath = path.join(config.repositoriesRoot, repositoryId);

        if (!isPathWithinDirectory(repositoryPath, config.repositoriesRoot)) {
            throw new Error('無效的 Repository 路徑');
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
    }
}

export const repositoryService = new RepositoryService();
