import fs from 'node:fs/promises';
import path from 'node:path';
import {isPathWithinDirectory} from '../utils/pathValidator.js';
import {logger} from '../utils/logger.js';
import {fileExists} from './shared/fileResourceHelpers.js';
import {safeJsonParse} from '../utils/safeJsonParse.js';

interface PodManifest {
    managedFiles: string[];
}

const CLAUDE_DIR = '.claude';

class PodManifestService {
    getManifestPath(repositoryPath: string, podId: string): string {
        return path.join(repositoryPath, CLAUDE_DIR, `.pod-manifest-${podId}.json`);
    }

    async readManifest(repositoryPath: string, podId: string): Promise<string[]> {
        const manifestPath = this.getManifestPath(repositoryPath, podId);

        if (!await fileExists(manifestPath)) {
            return [];
        }

        const content = await fs.readFile(manifestPath, 'utf-8');
        const manifest = safeJsonParse<PodManifest>(content);

        if (!manifest) {
            logger.warn('Pod', 'Warn', `manifest 解析失敗，路徑: ${manifestPath}`);
            return [];
        }

        return manifest.managedFiles ?? [];
    }

    async writeManifest(repositoryPath: string, podId: string, managedFiles: string[]): Promise<void> {
        const claudeDir = path.join(repositoryPath, CLAUDE_DIR);
        await fs.mkdir(claudeDir, {recursive: true});

        const manifestPath = this.getManifestPath(repositoryPath, podId);
        const manifest: PodManifest = {managedFiles};
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }

    private async deleteSingleManagedFile(
        absPath: string,
        repositoryPath: string,
        claudeDir: string,
        dirsToCheck: Set<string>,
    ): Promise<void> {
        if (!isPathWithinDirectory(absPath, repositoryPath)) {
            logger.warn('Pod', 'Delete', `偵測到不安全的路徑，跳過刪除: ${absPath}`);
            return;
        }

        await fs.rm(absPath, {force: true});

        let dir = path.dirname(absPath);
        while (dir !== claudeDir && isPathWithinDirectory(dir, claudeDir)) {
            dirsToCheck.add(dir);
            dir = path.dirname(dir);
        }
    }

    private async cleanEmptyDirectories(dirsToCheck: Set<string>): Promise<void> {
        const sortedDirs = [...dirsToCheck].sort((a, b) => b.length - a.length);
        for (const dir of sortedDirs) {
            try {
                const entries = await fs.readdir(dir);
                if (entries.length === 0) {
                    await fs.rmdir(dir);
                }
            } catch {
                // 目錄刪除失敗不影響主流程
            }
        }
    }

    async deleteManagedFiles(repositoryPath: string, podId: string): Promise<void> {
        const managedFiles = await this.readManifest(repositoryPath, podId);
        const claudeDir = path.join(repositoryPath, CLAUDE_DIR);
        const dirsToCheck = new Set<string>();

        for (const relPath of managedFiles) {
            const absPath = path.join(repositoryPath, relPath);
            await this.deleteSingleManagedFile(absPath, repositoryPath, claudeDir, dirsToCheck);
        }

        await this.cleanEmptyDirectories(dirsToCheck);
        await this.deleteManifestFile(repositoryPath, podId);
    }

    async deleteManifestFile(repositoryPath: string, podId: string): Promise<void> {
        const manifestPath = this.getManifestPath(repositoryPath, podId);
        await fs.rm(manifestPath, {force: true});
    }

    collectCommandFiles(commandId: string): string[] {
        return [`${CLAUDE_DIR}/commands/${commandId}.md`];
    }

    async collectSkillFiles(skillId: string, skillSourcePath: string): Promise<string[]> {
        const files: string[] = [];
        await this.collectFilesRecursive(skillSourcePath, skillSourcePath, skillId, files);
        return files;
    }

    private async collectFilesRecursive(
        basePath: string,
        currentPath: string,
        skillId: string,
        files: string[]
    ): Promise<void> {
        const entries = await fs.readdir(currentPath, {withFileTypes: true});

        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                await this.collectFilesRecursive(basePath, entryPath, skillId, files);
            } else {
                const relativeToSkillBase = path.relative(basePath, entryPath);
                files.push(`${CLAUDE_DIR}/skills/${skillId}/${relativeToSkillBase}`);
            }
        }
    }

    collectSubAgentFiles(subAgentId: string): string[] {
        return [`${CLAUDE_DIR}/agents/${subAgentId}.md`];
    }
}

export const podManifestService = new PodManifestService();
