import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {podManifestService} from '../../src/services/podManifestService.js';
import {initTestDb, resetDb} from '../../src/database/index.js';
import {resetStatements} from '../../src/database/statements.js';

describe('PodManifestService', () => {
    let tmpDir: string;
    const podId = 'test-pod-id';
    const repositoryId = 'test-repo-id';

    beforeAll(() => {
        initTestDb();
    });

    beforeEach(async () => {
        resetDb();
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pod-manifest-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, {recursive: true, force: true});
    });

    afterAll(() => {
        resetStatements();
    });

    describe('readManifest', () => {
        it('資料不存在時回傳空陣列', () => {
            const result = podManifestService.readManifest(repositoryId, podId);
            expect(result).toEqual([]);
        });

        it('資料存在時回傳正確的 managedFiles', () => {
            const managedFiles = ['.claude/commands/test.md', '.claude/agents/agent.md'];
            podManifestService.writeManifest(repositoryId, podId, managedFiles);

            const result = podManifestService.readManifest(repositoryId, podId);
            expect(result).toEqual(managedFiles);
        });
    });

    describe('writeManifest', () => {
        it('正確寫入 managedFiles 到 DB', () => {
            const managedFiles = ['.claude/commands/test.md'];
            podManifestService.writeManifest(repositoryId, podId, managedFiles);

            const result = podManifestService.readManifest(repositoryId, podId);
            expect(result).toEqual(managedFiles);
        });

        it('重複寫入時覆蓋舊資料', () => {
            podManifestService.writeManifest(repositoryId, podId, ['.claude/commands/old.md']);
            podManifestService.writeManifest(repositoryId, podId, ['.claude/commands/new.md']);

            const result = podManifestService.readManifest(repositoryId, podId);
            expect(result).toEqual(['.claude/commands/new.md']);
        });
    });

    describe('deleteManifestRecord', () => {
        it('從 DB 刪除 manifest 記錄', () => {
            podManifestService.writeManifest(repositoryId, podId, ['.claude/commands/test.md']);
            podManifestService.deleteManifestRecord(repositoryId, podId);

            const result = podManifestService.readManifest(repositoryId, podId);
            expect(result).toEqual([]);
        });

        it('記錄不存在時不報錯', () => {
            expect(() => podManifestService.deleteManifestRecord(repositoryId, podId)).not.toThrow();
        });
    });

    describe('collectCommandFiles', () => {
        it('回傳正確的 command 檔案路徑格式', () => {
            const result = podManifestService.collectCommandFiles('my-command');
            expect(result).toEqual(['.claude/commands/my-command.md']);
        });
    });

    describe('collectSubAgentFiles', () => {
        it('回傳正確的 subAgent 檔案路徑格式', () => {
            const result = podManifestService.collectSubAgentFiles('my-agent');
            expect(result).toEqual(['.claude/agents/my-agent.md']);
        });
    });

    describe('collectSkillFiles', () => {
        it('收集 skill 目錄下所有檔案路徑', async () => {
            const skillDir = path.join(tmpDir, 'my-skill-source');
            await fs.mkdir(skillDir, {recursive: true});
            await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'skill content');
            await fs.writeFile(path.join(skillDir, 'helper.ts'), 'helper code');

            const result = await podManifestService.collectSkillFiles('my-skill', skillDir);

            expect(result).toContain('.claude/skills/my-skill/SKILL.md');
            expect(result).toContain('.claude/skills/my-skill/helper.ts');
            expect(result).toHaveLength(2);
        });

        it('遞迴收集子目錄下的檔案', async () => {
            const skillDir = path.join(tmpDir, 'my-skill-source');
            const subDir = path.join(skillDir, 'utils');
            await fs.mkdir(subDir, {recursive: true});
            await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'skill content');
            await fs.writeFile(path.join(subDir, 'util.ts'), 'util code');

            const result = await podManifestService.collectSkillFiles('my-skill', skillDir);

            expect(result).toContain('.claude/skills/my-skill/SKILL.md');
            expect(result).toContain('.claude/skills/my-skill/utils/util.ts');
            expect(result).toHaveLength(2);
        });
    });
});
