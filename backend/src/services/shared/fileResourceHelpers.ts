import fs from 'fs/promises';
import path from 'path';
import { isPathWithinDirectory } from '../../utils/pathValidator.js';

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

export async function copyResourceFile(srcPath: string, destBasePath: string, subDir: string, fileName: string): Promise<void> {
    const safeFileName = path.basename(fileName);
    const destPath = path.join(destBasePath, '.claude', subDir, safeFileName);
    if (!isPathWithinDirectory(destPath, destBasePath)) {
        throw new Error('目標路徑不在允許的範圍內');
    }
    await fs.mkdir(path.dirname(destPath), {recursive: true});
    await fs.copyFile(srcPath, destPath);
}
