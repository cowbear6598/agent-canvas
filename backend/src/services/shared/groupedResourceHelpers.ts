import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { fileExists, directoryExists } from './fileResourceHelpers.js';
import { sanitizePathSegment, isPathWithinDirectory } from '../../utils/pathValidator.js';
import { logger } from '../../utils/logger.js';

type ResourceEntry = { id: string; name: string; groupId: string | null };

async function collectRootFiles(basePath: string): Promise<ResourceEntry[]> {
    const entries = await fs.readdir(basePath, { withFileTypes: true });
    return entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => ({ id: entry.name.slice(0, -3), name: entry.name.slice(0, -3), groupId: null }));
}

async function collectGroupFiles(basePath: string, groupName: string): Promise<ResourceEntry[]> {
    const sanitized = sanitizePathSegment(groupName);
    const groupPath = path.join(basePath, sanitized);
    const files = await fs.readdir(groupPath);
    return files
        .filter(file => file.endsWith('.md'))
        .map(file => ({ id: file.slice(0, -3), name: file.slice(0, -3), groupId: sanitized }));
}

export async function listGroupedMarkdownResources(
    basePath: string
): Promise<ResourceEntry[]> {
    const resources: ResourceEntry[] = [];

    if (!await directoryExists(basePath)) {
        return resources;
    }

    const rootEntries = await fs.readdir(basePath, { withFileTypes: true });

    const rootFiles = await collectRootFiles(basePath);
    resources.push(...rootFiles);

    const groupDirs = rootEntries.filter(entry => entry.isDirectory());
    for (const entry of groupDirs) {
        await collectGroupFiles(basePath, entry.name)
            .then(groupFiles => resources.push(...groupFiles))
            .catch(error => logger.error('Workspace', 'Error', `[GroupedResource] 讀取群組目錄失敗: ${entry.name}`, error));
    }

    return resources;
}

async function findInRootDirectory(basePath: string, resourceId: string): Promise<string | null> {
    const rootPath = path.join(basePath, `${resourceId}.md`);
    if (await fileExists(rootPath)) {
        return rootPath;
    }
    return null;
}

async function findInGroupDirectories(basePath: string, resourceId: string): Promise<string | null> {
    if (!await directoryExists(basePath)) {
        return null;
    }

    const entries: Dirent[] = await fs.readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const groupPath = path.join(basePath, entry.name, `${resourceId}.md`);
        if (await fileExists(groupPath)) {
            return groupPath;
        }
    }

    return null;
}

export async function findGroupedResourceFilePath(
    basePath: string,
    resourceId: string,
    validator: (id: string) => boolean
): Promise<string | null> {
    if (!validator(resourceId)) {
        return null;
    }

    const rootResult = await findInRootDirectory(basePath, resourceId);
    if (rootResult) {
        return rootResult;
    }

    return findInGroupDirectories(basePath, resourceId);
}

export async function setGroupedResourceGroupId(
    basePath: string,
    resourceId: string,
    groupId: string | null,
    findFilePath: () => Promise<string | null>
): Promise<void> {
    const oldPath = await findFilePath();
    if (!oldPath) throw new Error(`找不到資源: ${resourceId}`);

    const newPath = groupId === null
        ? path.join(basePath, `${resourceId}.md`)
        : path.join(basePath, sanitizePathSegment(groupId), `${resourceId}.md`);

    if (!isPathWithinDirectory(newPath, basePath)) {
        throw new Error(`路徑穿越攻擊偵測：${newPath} 不在 ${basePath} 內`);
    }

    if (groupId !== null) {
        await fs.mkdir(path.dirname(newPath), { recursive: true });
    }

    if (oldPath !== newPath) {
        await fs.rename(oldPath, newPath);
    }
}
