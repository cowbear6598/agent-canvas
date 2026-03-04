import {skillService} from '../../src/services/skillService';
import fs from 'fs/promises';
import path from 'path';
import {config} from '../../src/config';
import {zipSync} from 'fflate';

const TEST_SKILLS_DIR = path.join(config.skillsPath, '__it_skill_security__');

beforeAll(async () => {
    await fs.mkdir(TEST_SKILLS_DIR, {recursive: true});
});

afterAll(async () => {
    await fs.rm(TEST_SKILLS_DIR, {recursive: true, force: true});
});

/**
 * 建立測試用的 ZIP 檔案
 */
function createTestZip(files: Record<string, string | Uint8Array>): string {
    const entries: Record<string, Uint8Array> = {};

    for (const [fileName, content] of Object.entries(files)) {
        if (typeof content === 'string') {
            entries[fileName] = new TextEncoder().encode(content);
        } else {
            entries[fileName] = content;
        }
    }

    const zipData = zipSync(entries);
    return Buffer.from(zipData).toString('base64');
}

describe('技能服務安全性測試', () => {
    describe('Zip Bomb 防護', () => {
        it('應該拒絕超過 100 個檔案的 ZIP', async () => {
            const files: Record<string, string> = {
                'SKILL.md': '# Test Skill\n\nTest content',
            };

            for (let i = 0; i < 101; i++) {
                files[`file${i}.txt`] = 'content';
            }

            const base64Data = createTestZip(files);

            await expect(
                skillService.import('it-skill.zip', base64Data, base64Data.length)
            ).rejects.toThrow('ZIP 檔案內容過多，最多允許 100 個檔案');
        });

        it('應該拒絕單檔超過 1MB 的 ZIP', async () => {
            const largeContent = new Uint8Array(1.5 * 1024 * 1024); // 1.5MB
            largeContent.fill(65); // 填充 'A'

            const files = {
                'SKILL.md': '# Test Skill\n\nTest content',
                'large.txt': largeContent,
            };

            const base64Data = createTestZip(files);

            await expect(
                skillService.import('it-skill.zip', base64Data, base64Data.length)
            ).rejects.toThrow('ZIP 內包含超過 1MB 的單一檔案');
        });

        it('應該拒絕解壓後總大小超過 10MB 的 ZIP', async () => {
            const files: Record<string, Uint8Array> = {
                'SKILL.md': new TextEncoder().encode('# Test Skill\n\nTest content'),
            };

            for (let i = 0; i < 15; i++) {
                const content = new Uint8Array(800 * 1024); // 800KB per file
                content.fill(65 + i);
                files[`file${i}.txt`] = content;
            }

            const base64Data = createTestZip(files);

            await expect(
                skillService.import('it-skill.zip', base64Data, base64Data.length)
            ).rejects.toThrow('解壓縮後檔案總大小超過 10MB 限制');
        });

        it('應該接受符合大小限制的 ZIP', async () => {
            const files = {
                'SKILL.md': '# Test Skill\n\nTest content',
                'file1.txt': 'content 1',
                'file2.txt': 'content 2',
            };

            const base64Data = createTestZip(files);
            const fileName = 'valid-it-skill.zip';

            const result = await skillService.import(fileName, base64Data, base64Data.length);

            expect(result.skill.id).toBe('valid-it-skill');

            // 清理
            await skillService.delete('valid-it-skill');
        });
    });

    describe('路徑遍歷防護', () => {
        it('應該拒絕不安全的檔名（路徑遍歷）', async () => {
            const files = {
                'SKILL.md': '# Test Skill',
            };

            const base64Data = createTestZip(files);

            await expect(
                skillService.import('../unsafe-skill.zip', base64Data, base64Data.length)
            ).rejects.toThrow('檔名格式不正確');
        });

        it('應該拒絕包含特殊字元的檔名', async () => {
            const files = {
                'SKILL.md': '# Test Skill',
            };

            const base64Data = createTestZip(files);

            await expect(
                skillService.import('skill@#$.zip', base64Data, base64Data.length)
            ).rejects.toThrow('檔名格式不正確');
        });

        it('應該接受合法的檔名', async () => {
            const files = {
                'SKILL.md': '# Valid Skill\n\nTest content',
            };

            const base64Data = createTestZip(files);
            const fileName = 'valid-skill-name_123.zip';

            const result = await skillService.import(fileName, base64Data, base64Data.length);

            expect(result.skill.id).toBe('valid-skill-name_123');

            // 清理
            await skillService.delete('valid-skill-name_123');
        });
    });

    describe('檔案格式驗證', () => {
        it('應該拒絕非 ZIP 檔案', async () => {
            const notZipData = Buffer.from('This is not a zip file').toString('base64');

            await expect(
                skillService.import('it.zip', notZipData, notZipData.length)
            ).rejects.toThrow('解壓縮失敗，請確認 ZIP 檔案完整性');
        });

        it('應該拒絕超過 5MB 的壓縮檔', async () => {
            const largeData = Buffer.alloc(6 * 1024 * 1024).toString('base64');

            await expect(
                skillService.import('large.zip', largeData, 6 * 1024 * 1024)
            ).rejects.toThrow('檔案大小超過 5MB 限制');
        });
    });

    describe('ZIP 結構驗證', () => {
        it('應該拒絕缺少 SKILL.md 的 ZIP', async () => {
            const files = {
                'readme.txt': 'No SKILL.md here',
            };

            const base64Data = createTestZip(files);

            await expect(
                skillService.import('no-skill-md.zip', base64Data, base64Data.length)
            ).rejects.toThrow('ZIP 檔案內找不到 SKILL.md');
        });

        it('應該拒絕 SKILL.md 在子目錄的 ZIP', async () => {
            const files = {
                'subdir/SKILL.md': '# Nested Skill',
            };

            const base64Data = createTestZip(files);

            await expect(
                skillService.import('nested-skill.zip', base64Data, base64Data.length)
            ).rejects.toThrow('SKILL.md 必須位於根目錄');
        });
    });
});
