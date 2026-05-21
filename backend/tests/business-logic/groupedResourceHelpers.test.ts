import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
    listGroupedMarkdownResources,
    findGroupedResourceFilePath,
    setGroupedResourceGroupId,
} from '../../src/services/shared/groupedResourceHelpers.js';

describe('groupedResourceHelpers', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grouped-resource-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe('listGroupedMarkdownResources', () => {
        it('目錄不存在時應回傳空陣列', async () => {
            const result = await listGroupedMarkdownResources('/不存在的路徑/完全不存在');
            expect(result).toEqual([]);
        });

        it('根目錄有 .md 檔案時應正確列出（groupId 為 null）', async () => {
            await fs.writeFile(path.join(tmpDir, 'alpha.md'), '內容');
            await fs.writeFile(path.join(tmpDir, 'beta.md'), '內容');

            const result = await listGroupedMarkdownResources(tmpDir);

            expect(result).toHaveLength(2);
            expect(result).toContainEqual({ id: 'alpha', name: 'alpha', groupId: null });
            expect(result).toContainEqual({ id: 'beta', name: 'beta', groupId: null });
        });

        it('群組子目錄中的 .md 檔案應正確列出（帶 groupId）', async () => {
            const groupDir = path.join(tmpDir, 'my-group');
            await fs.mkdir(groupDir);
            await fs.writeFile(path.join(groupDir, 'child.md'), '內容');

            const result = await listGroupedMarkdownResources(tmpDir);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ id: 'child', name: 'child', groupId: 'my-group' });
        });
    });

    describe('findGroupedResourceFilePath', () => {
        it('驗證器回傳 false 時應回傳 null', async () => {
            await fs.writeFile(path.join(tmpDir, 'resource.md'), '內容');

            const result = await findGroupedResourceFilePath(tmpDir, 'resource', () => false);

            expect(result).toBeNull();
        });

        it('在根目錄找到檔案時回傳正確路徑', async () => {
            await fs.writeFile(path.join(tmpDir, 'resource.md'), '內容');

            const result = await findGroupedResourceFilePath(tmpDir, 'resource', () => true);

            expect(result).toBe(path.join(tmpDir, 'resource.md'));
        });

        it('在群組子目錄找到檔案時回傳正確路徑', async () => {
            const groupDir = path.join(tmpDir, 'group-a');
            await fs.mkdir(groupDir);
            await fs.writeFile(path.join(groupDir, 'resource.md'), '內容');

            const result = await findGroupedResourceFilePath(tmpDir, 'resource', () => true);

            expect(result).toBe(path.join(groupDir, 'resource.md'));
        });
    });

    describe('setGroupedResourceGroupId', () => {
        it('資源不存在時應拋出錯誤', async () => {
            const findFilePath = async (): Promise<string | null> => null;

            await expect(
                setGroupedResourceGroupId(tmpDir, 'not-found', null, findFilePath)
            ).rejects.toThrow('找不到資源: not-found');
        });
    });
});
