import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { directoryExists, copyResourceFile, readFileOrNull } from '../../src/services/shared/fileResourceHelpers.js';

describe('fileResourceHelpers', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-resource-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe('directoryExists', () => {
        it('目錄存在時應回傳 true', async () => {
            const result = await directoryExists(tmpDir);
            expect(result).toBe(true);
        });

        it('路徑不存在時應回傳 false', async () => {
            const result = await directoryExists(path.join(tmpDir, 'non-existent'));
            expect(result).toBe(false);
        });

        it('路徑為檔案時應回傳 false', async () => {
            const filePath = path.join(tmpDir, 'file.txt');
            await fs.writeFile(filePath, 'content');

            const result = await directoryExists(filePath);
            expect(result).toBe(false);
        });
    });

    describe('copyResourceFile', () => {
        it('來源檔案存在時應成功複製到目標路徑', async () => {
            const srcPath = path.join(tmpDir, 'source.md');
            await fs.writeFile(srcPath, '# 內容');

            const destBase = path.join(tmpDir, 'dest');
            await copyResourceFile(srcPath, destBase, 'commands', 'source.md');

            const destPath = path.join(destBase, '.claude', 'commands', 'source.md');
            const content = await fs.readFile(destPath, 'utf-8');
            expect(content).toBe('# 內容');
        });

        it('來源檔案不存在時應拋出錯誤', async () => {
            const srcPath = path.join(tmpDir, 'missing.md');
            const destBase = path.join(tmpDir, 'dest');

            await expect(copyResourceFile(srcPath, destBase, 'commands', 'missing.md')).rejects.toThrow();
        });

        it('fileName 含路徑穿越時應透過 basename 截取純檔名，安全複製到允許路徑內', async () => {
            const srcPath = path.join(tmpDir, 'source.md');
            await fs.writeFile(srcPath, '# content');
            const destBase = path.join(tmpDir, 'dest');

            // path.basename 會將 '../../../etc/passwd' 截成 'passwd'，確保不發生路徑穿越
            await copyResourceFile(srcPath, destBase, 'commands', '../../../etc/passwd');

            const safeDestPath = path.join(destBase, '.claude', 'commands', 'passwd');
            const content = await fs.readFile(safeDestPath, 'utf-8');
            expect(content).toBe('# content');
        });

        it('subDir 含路徑穿越時應拋出目標路徑不在允許範圍內錯誤', async () => {
            const srcPath = path.join(tmpDir, 'source.md');
            await fs.writeFile(srcPath, '# content');
            const destBase = path.join(tmpDir, 'dest');

            await expect(
                copyResourceFile(srcPath, destBase, '../../outside', 'source.md')
            ).rejects.toThrow('目標路徑不在允許的範圍內');
        });

        it('目標目錄不存在時應自動建立目錄後複製', async () => {
            const srcPath = path.join(tmpDir, 'source.md');
            await fs.writeFile(srcPath, '# 自動建立');

            const destBase = path.join(tmpDir, 'new-base');
            await copyResourceFile(srcPath, destBase, 'sub/nested', 'source.md');

            const destPath = path.join(destBase, '.claude', 'sub/nested', 'source.md');
            const content = await fs.readFile(destPath, 'utf-8');
            expect(content).toBe('# 自動建立');
        });
    });

    describe('readFileOrNull', () => {
        it('檔案存在時應回傳檔案內容', async () => {
            const filePath = path.join(tmpDir, 'test.txt');
            await fs.writeFile(filePath, 'hello world', 'utf-8');

            const result = await readFileOrNull(filePath);
            expect(result).toBe('hello world');
        });

        it('檔案不存在時應回傳 null', async () => {
            const result = await readFileOrNull(path.join(tmpDir, 'missing.txt'));
            expect(result).toBeNull();
        });
    });
});
