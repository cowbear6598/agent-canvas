import fs from 'fs/promises';
import path from 'path';
import {unzipSync} from 'fflate';
import {config} from '../config';
import type {Skill} from '../types';
import {isPathWithinDirectory, validatePodId, validateSkillId} from '../utils/pathValidator.js';
import {fileExists, directoryExists, parseFrontmatterDescription, deleteResourceDirFromPath} from './shared/fileResourceHelpers.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_UNZIPPED_SIZE = 10 * 1024 * 1024;
const MAX_ENTRIES = 100;
const MAX_INDIVIDUAL_FILE_SIZE = 1 * 1024 * 1024;
const MAX_DEPTH = 10;
const MAX_FILES = 1000;
const SKILL_FILE_NAME = 'SKILL.md';

class SkillService {
    async list(): Promise<Skill[]> {
        await fs.mkdir(config.skillsPath, {recursive: true});
        const entries = await fs.readdir(config.skillsPath, {withFileTypes: true});

        const skills: Skill[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const skillId = entry.name;
            const skillFilePath = this.getSkillFilePath(skillId);

            const content = await fs.readFile(skillFilePath, 'utf-8');
            const description = parseFrontmatterDescription(content);

            skills.push({
                id: skillId,
                name: skillId,
                description,
            });
        }

        return skills;
    }

    async exists(skillId: string): Promise<boolean> {
        const filePath = this.getSkillFilePath(skillId);
        return fileExists(filePath);
    }

    async copySkillToPod(skillId: string, podId: string, podWorkspacePath: string): Promise<void> {
        if (!validatePodId(podId)) {
            throw new Error('無效的 Pod ID 格式');
        }
        await this.copySkillToDestination(skillId, podWorkspacePath);
    }

    async copySkillToRepository(skillId: string, repositoryPath: string): Promise<void> {
        await this.copySkillToDestination(skillId, repositoryPath);
    }

    private async copySkillToDestination(skillId: string, destBasePath: string): Promise<void> {
        if (!validateSkillId(skillId)) {
            throw new Error('無效的技能 ID 格式');
        }

        const srcDir = this.getSkillDirectoryPath(skillId);
        const destDir = path.join(destBasePath, '.claude', 'skills', skillId);

        const exists = await directoryExists(srcDir);
        if (!exists) {
            throw new Error(`找不到技能目錄: ${skillId}`);
        }

        await fs.rm(destDir, {recursive: true, force: true});
        await this.copyDirectoryRecursive(srcDir, destDir);
    }

    async deleteSkillsFromPath(basePath: string): Promise<void> {
        await deleteResourceDirFromPath(basePath, 'skills');
    }

    async delete(skillId: string): Promise<void> {
        const dirPath = this.getSkillDirectoryPath(skillId);
        await fs.rm(dirPath, {recursive: true, force: true});
    }

    async import(fileName: string, fileData: string, fileSize: number): Promise<{skill: Skill; isOverwrite: boolean}> {
        if (fileSize > MAX_FILE_SIZE) {
            throw new Error('檔案大小超過 5MB 限制');
        }

        if (!fileName.toLowerCase().endsWith('.zip')) {
            throw new Error('檔案格式錯誤，僅支援 ZIP 檔案');
        }

        // Buffer.from 不會 throw，無效的 base64 字元會被靜默忽略，
        // 因此用正則預先驗證確保輸入合法
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(fileData)) {
            throw new Error('Base64 解碼失敗，請確認 ZIP 檔案格式正確');
        }

        const buffer = Buffer.from(fileData, 'base64');

        // ZIP magic bytes 驗證（PK header = 0x50 0x4B），
        // 可提早攔截明顯非 ZIP 的資料，避免進入 unzipSync 後才 throw
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
            throw new Error('解壓縮失敗，請確認 ZIP 檔案完整性');
        }

        let entries: Record<string, Uint8Array>;
        try {
            entries = unzipSync(new Uint8Array(buffer));
        } catch {
            throw new Error('解壓縮失敗，請確認 ZIP 檔案完整性');
        }

        this.validateZipStructure(entries);

        const skillId = fileName.slice(0, -4);

        if (!validateSkillId(skillId)) {
            throw new Error('檔名格式不正確');
        }

        const isOverwrite = await this.exists(skillId);

        const destDir = this.getSkillDirectoryPath(skillId);

        if (isOverwrite) {
            await fs.rm(destDir, {recursive: true, force: true});
        }

        await this.extractZipToDirectory(entries, destDir);

        const skillFilePath = path.join(destDir, SKILL_FILE_NAME);
        const content = await fs.readFile(skillFilePath, 'utf-8');
        const description = parseFrontmatterDescription(content);

        const skill: Skill = {
            id: skillId,
            name: skillId,
            description,
        };

        return {skill, isOverwrite};
    }

    getSkillDirectoryPath(skillId: string): string {
        if (!validateSkillId(skillId)) {
            throw new Error('無效的技能 ID 格式');
        }

        const safePath = path.join(config.skillsPath, path.basename(skillId));

        if (!isPathWithinDirectory(safePath, config.skillsPath)) {
            throw new Error('無效的技能路徑');
        }

        return safePath;
    }

    private getSkillFilePath(skillId: string): string {
        const skillDir = this.getSkillDirectoryPath(skillId);
        return path.join(skillDir, 'SKILL.md');
    }

    private async copyDirectoryRecursive(
        srcDir: string,
        destDir: string,
        depth: number = 0
    ): Promise<void> {
        if (depth > MAX_DEPTH) {
            throw new Error('超過最大目錄深度');
        }

        await fs.mkdir(destDir, {recursive: true});

        const entries = await fs.readdir(srcDir, {withFileTypes: true});

        if (entries.length > MAX_FILES) {
            throw new Error('超過最大檔案數量');
        }

        for (const entry of entries) {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectoryRecursive(srcPath, destPath, depth + 1);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    private validateZipStructure(entries: Record<string, Uint8Array>): void {
        let hasRootSkillMd = false;
        let hasNestedSkillMd = false;

        for (const entryName of Object.keys(entries)) {
            if (entryName === SKILL_FILE_NAME) {
                hasRootSkillMd = true;
            }
            if (entryName.endsWith(`/${SKILL_FILE_NAME}`) || entryName.endsWith(`\\${SKILL_FILE_NAME}`)) {
                hasNestedSkillMd = true;
            }
        }

        if (!hasRootSkillMd && !hasNestedSkillMd) {
            throw new Error('ZIP 檔案內找不到 SKILL.md');
        }

        if (!hasRootSkillMd && hasNestedSkillMd) {
            throw new Error('SKILL.md 必須位於根目錄');
        }
    }

    private async extractZipToDirectory(entries: Record<string, Uint8Array>, destDir: string): Promise<void> {
        const entryCount = Object.keys(entries).length;
        if (entryCount > MAX_ENTRIES) {
            throw new Error(`ZIP 檔案內容過多，最多允許 ${MAX_ENTRIES} 個檔案`);
        }

        let totalSize = 0;
        for (const data of Object.values(entries)) {
            if (data.length > MAX_INDIVIDUAL_FILE_SIZE) {
                throw new Error('ZIP 內包含超過 1MB 的單一檔案');
            }
            totalSize += data.length;
            if (totalSize > MAX_TOTAL_UNZIPPED_SIZE) {
                throw new Error('解壓縮後檔案總大小超過 10MB 限制');
            }
        }

        await fs.mkdir(destDir, {recursive: true});

        for (const [entryName, data] of Object.entries(entries)) {
            let normalizedPath = path.normalize(entryName.replace(/\\/g, '/'));
            normalizedPath = normalizedPath.replace(/\0/g, '');

            const destPath = path.join(destDir, normalizedPath);

            if (!isPathWithinDirectory(destPath, destDir)) {
                throw new Error('偵測到不安全的檔案路徑');
            }

            if (normalizedPath.endsWith('/')) {
                await fs.mkdir(destPath, {recursive: true});
            } else {
                const parentDir = path.dirname(destPath);
                await fs.mkdir(parentDir, {recursive: true});

                await fs.writeFile(destPath, data);
            }
        }
    }

}

export const skillService = new SkillService();
