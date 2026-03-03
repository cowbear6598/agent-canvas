import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { isPathWithinDirectory } from '../../utils/pathValidator.js';
import { safeJsonParse } from '../../utils/safeJsonParse.js';

export async function readFileOrNull(filePath: string): Promise<string | null> {
    if (!await fileExists(filePath)) {
        return null;
    }
    return await fs.readFile(filePath, 'utf-8');
}

export async function fileExists(filePath: string): Promise<boolean> {
    return Bun.file(filePath).exists();
}

export async function directoryExists(dirPath: string): Promise<boolean> {
    const stat = await fs.stat(dirPath).catch(() => null);
    return stat?.isDirectory() ?? false;
}

export async function ensureDirectoryAndWriteFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content, 'utf-8');
}

export async function readJsonFileOrDefault<T>(filePath: string): Promise<T[] | null> {
    const exists = await fileExists(filePath);
    if (!exists) {
        return null;
    }

    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = safeJsonParse<T[]>(data);

    if (parsed === null) {
        logger.error('Startup', 'Error', `[FileResource] 無效的 JSON 檔案 ${filePath}`);
        return null;
    }

    return parsed;
}

export async function copyResourceFile(srcPath: string, destBasePath: string, subDir: string, fileName: string): Promise<void> {
    const safeFileName = path.basename(fileName);
    const destPath = path.join(destBasePath, '.claude', subDir, safeFileName);
    if (!isPathWithinDirectory(destPath, destBasePath)) {
        throw new Error('目標路徑不在允許的範圍內');
    }
    await fs.mkdir(path.dirname(destPath), {recursive: true});
    await fs.copyFile(srcPath, destPath);
}

export async function deleteResourceDirFromPath(basePath: string, subDir: string): Promise<void> {
    if (!isPathWithinDirectory(basePath, config.canvasRoot) && !isPathWithinDirectory(basePath, config.repositoriesRoot)) {
        throw new Error('無效的路徑');
    }

    if (subDir.includes('/') || subDir.includes('\\') || subDir.includes('..')) {
        throw new Error('無效的子目錄名稱');
    }

    const dir = path.join(basePath, '.claude', subDir);
    await fs.rm(dir, {recursive: true, force: true});
}

export async function findValidatedSrcPath(
    service: { findFilePath: (id: string) => Promise<string | null> },
    id: string,
    validateFn: (id: string) => boolean,
    resourceName: string
): Promise<string> {
    if (!validateFn(id)) throw new Error(`無效的 ${resourceName} 格式`);
    const srcPath = await service.findFilePath(id);
    if (!srcPath) throw new Error(`找不到 ${resourceName}: ${id}`);
    return srcPath;
}

export function parseFrontmatterDescription(content: string): string {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
        return '（無說明）';
    }

    const frontmatterContent = match[1];
    const descriptionMatch = frontmatterContent.match(/^description:\s*(.+)$/m);

    return descriptionMatch ? descriptionMatch[1].trim() : '（無說明）';
}
