import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
    closeTestServer,
    createSocketClient,
    createTestServer,
    disconnectSocket,
    emitAndWaitResponse,
    type TestServerInstance,
    type TestWebSocketClient,
    testConfig,
} from '../setup';
import {
    createPod,
    createCommand,
    createRepository,
    createSkillFile,
    createSubAgent,
    getCanvasId,
} from '../helpers';
import {
    WebSocketRequestEvents,
    WebSocketResponseEvents,
    type PodBindRepositoryPayload,
    type PodUnbindRepositoryPayload,
    type PodBindCommandPayload,
    type PodDeletePayload,
} from '../../src/schemas/index.js';
import {
    type PodRepositoryBoundPayload,
    type PodRepositoryUnboundPayload,
    type PodCommandBoundPayload,
    type PodDeletedPayload,
} from '../../src/types';

describe('Repository Sync Manifest 整合測試', () => {
    let server: TestServerInstance;
    let client: TestWebSocketClient;

    beforeAll(async () => {
        server = await createTestServer();
        client = await createSocketClient(server.baseUrl, server.canvasId);
    });

    afterAll(async () => {
        if (client?.connected) await disconnectSocket(client);
        if (server) await closeTestServer(server);
    });

    async function bindRepositoryToPod(podId: string, repositoryId: string) {
        const canvasId = await getCanvasId(client);
        return emitAndWaitResponse<PodBindRepositoryPayload, PodRepositoryBoundPayload>(
            client,
            WebSocketRequestEvents.POD_BIND_REPOSITORY,
            WebSocketResponseEvents.POD_REPOSITORY_BOUND,
            { requestId: uuidv4(), canvasId, podId, repositoryId }
        );
    }

    async function unbindRepositoryFromPod(podId: string) {
        const canvasId = await getCanvasId(client);
        return emitAndWaitResponse<PodUnbindRepositoryPayload, PodRepositoryUnboundPayload>(
            client,
            WebSocketRequestEvents.POD_UNBIND_REPOSITORY,
            WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
            { requestId: uuidv4(), canvasId, podId }
        );
    }

    async function bindCommandToPod(podId: string, commandId: string) {
        const canvasId = await getCanvasId(client);
        return emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
            client,
            WebSocketRequestEvents.POD_BIND_COMMAND,
            WebSocketResponseEvents.POD_COMMAND_BOUND,
            { requestId: uuidv4(), canvasId, podId, commandId }
        );
    }

    async function bindSkillToPod(podId: string, skillId: string) {
        const canvasId = await getCanvasId(client);
        return emitAndWaitResponse(
            client,
            WebSocketRequestEvents.POD_BIND_SKILL,
            WebSocketResponseEvents.POD_SKILL_BOUND,
            { requestId: uuidv4(), canvasId, podId, skillId }
        );
    }

    async function unbindCommandFromPod(podId: string) {
        const canvasId = await getCanvasId(client);
        return emitAndWaitResponse(
            client,
            WebSocketRequestEvents.POD_UNBIND_COMMAND,
            WebSocketResponseEvents.POD_COMMAND_UNBOUND,
            { requestId: uuidv4(), canvasId, podId }
        );
    }

    async function deletePod(podId: string) {
        const canvasId = await getCanvasId(client);
        return emitAndWaitResponse<PodDeletePayload, PodDeletedPayload>(
            client,
            WebSocketRequestEvents.POD_DELETE,
            WebSocketResponseEvents.POD_DELETED,
            { requestId: uuidv4(), canvasId, podId }
        );
    }

    function getRepoPath(repositoryId: string): string {
        return path.join(testConfig.repositoriesRoot, repositoryId);
    }

    function getManifestPath(repositoryId: string, podId: string): string {
        return path.join(getRepoPath(repositoryId), '.claude', `.pod-manifest-${podId}.json`);
    }

    async function fileExists(filePath: string): Promise<boolean> {
        return fs.access(filePath).then(() => true).catch(() => false);
    }

    async function readManifestFiles(repositoryId: string, podId: string): Promise<string[]> {
        const manifestPath = getManifestPath(repositoryId, podId);
        const content = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(content);
        return manifest.managedFiles;
    }

    describe('場景一：Pod 有資源綁定 repo', () => {
        it('資源被複製且 manifest 正確記錄', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-s1-${uuidv4()}`);
            const command = await createCommand(client, `cmd-${uuidv4()}`, '# Command');

            await bindCommandToPod(pod.id, command.id);
            await bindRepositoryToPod(pod.id, repo.id);

            const repoPath = getRepoPath(repo.id);
            const commandPath = path.join(repoPath, '.claude', 'commands', `${command.id}.md`);

            expect(await fileExists(commandPath)).toBe(true);
            expect(await fileExists(getManifestPath(repo.id, pod.id))).toBe(true);

            const managedFiles = await readManifestFiles(repo.id, pod.id);
            expect(managedFiles).toContain(`.claude/commands/${command.id}.md`);
        });
    });

    describe('場景二：Pod 沒有資源綁定 repo', () => {
        it('repo 原有 .claude/ 內容不被清空', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-s2-${uuidv4()}`);

            // 在 repo 先手動建立一個原有檔案
            const repoPath = getRepoPath(repo.id);
            const userOwnDir = path.join(repoPath, '.claude', 'commands');
            await fs.mkdir(userOwnDir, { recursive: true });
            await fs.writeFile(path.join(userOwnDir, 'user-own.md'), '# User Own Command');

            // Pod 沒有資源，綁定 repo
            await bindRepositoryToPod(pod.id, repo.id);

            // 原有檔案應該仍然存在
            const userOwnPath = path.join(userOwnDir, 'user-own.md');
            expect(await fileExists(userOwnPath)).toBe(true);
        });
    });

    describe('場景三：Pod 新增資源後 sync', () => {
        it('新檔案加入 manifest 且舊檔案不受影響', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-s3-${uuidv4()}`);
            const cmd1 = await createCommand(client, `cmd-${uuidv4()}`, '# Command 1');

            await bindCommandToPod(pod.id, cmd1.id);
            await bindRepositoryToPod(pod.id, repo.id);

            const managedFilesBefore = await readManifestFiles(repo.id, pod.id);
            expect(managedFilesBefore).toContain(`.claude/commands/${cmd1.id}.md`);

            // 解綁 command，再綁定新 command（模擬換新資源後的 sync）
            // 先透過解綁 repo 再重綁 repo 的方式觸發帶新 command 的 sync
            await unbindCommandFromPod(pod.id);

            // 綁定新的 command
            const cmd2 = await createCommand(client, `cmd-${uuidv4()}`, '# Command 2');
            await bindCommandToPod(pod.id, cmd2.id);

            // 解綁再綁回 repo，觸發新 sync
            await unbindRepositoryFromPod(pod.id);
            await bindRepositoryToPod(pod.id, repo.id);

            const managedFilesAfter = await readManifestFiles(repo.id, pod.id);
            expect(managedFilesAfter).toContain(`.claude/commands/${cmd2.id}.md`);

            const repoPath = getRepoPath(repo.id);
            const cmd2Path = path.join(repoPath, '.claude', 'commands', `${cmd2.id}.md`);
            expect(await fileExists(cmd2Path)).toBe(true);
        });
    });

    describe('場景四：Pod 解綁資源後 sync', () => {
        it('被解綁的 command 檔案從 repo 刪除且 manifest 更新', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-s4-${uuidv4()}`);
            const command = await createCommand(client, `cmd-${uuidv4()}`, '# Command');

            await bindCommandToPod(pod.id, command.id);
            await bindRepositoryToPod(pod.id, repo.id);

            const repoPath = getRepoPath(repo.id);
            const commandPath = path.join(repoPath, '.claude', 'commands', `${command.id}.md`);

            expect(await fileExists(commandPath)).toBe(true);

            // 解綁 command，sync 時需要解綁 repo 才能觸發（command 解綁本身不觸發 repo sync）
            await unbindCommandFromPod(pod.id);
            await unbindRepositoryFromPod(pod.id);
            await bindRepositoryToPod(pod.id, repo.id);

            // command 檔案應已從 repo 刪除
            expect(await fileExists(commandPath)).toBe(false);

            const managedFiles = await readManifestFiles(repo.id, pod.id);
            expect(managedFiles).not.toContain(`.claude/commands/${command.id}.md`);
        });
    });

    describe('場景五：Pod 解綁 repo', () => {
        it('只刪除該 Pod manifest 中的檔案，manifest 本身也刪除', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-s5-${uuidv4()}`);
            const command = await createCommand(client, `cmd-${uuidv4()}`, '# Command');

            // 手動建立 repo 原有的檔案
            const repoPath = getRepoPath(repo.id);
            const userOwnDir = path.join(repoPath, '.claude', 'commands');
            await fs.mkdir(userOwnDir, { recursive: true });
            await fs.writeFile(path.join(userOwnDir, 'user-own.md'), '# User Own');

            await bindCommandToPod(pod.id, command.id);
            await bindRepositoryToPod(pod.id, repo.id);

            const commandPath = path.join(repoPath, '.claude', 'commands', `${command.id}.md`);
            expect(await fileExists(commandPath)).toBe(true);

            // 解綁 repo
            await unbindRepositoryFromPod(pod.id);

            // Pod 管理的 command 應被刪除
            expect(await fileExists(commandPath)).toBe(false);

            // manifest 應被刪除
            expect(await fileExists(getManifestPath(repo.id, pod.id))).toBe(false);

            // 原有的 user-own.md 應保留
            const userOwnPath = path.join(userOwnDir, 'user-own.md');
            expect(await fileExists(userOwnPath)).toBe(true);
        });
    });

    describe('場景六：Pod 被刪除', () => {
        it('Pod 管理的資源被清除，manifest 被刪除，repo 原有檔案保留', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-s6-${uuidv4()}`);
            const command = await createCommand(client, `cmd-${uuidv4()}`, '# Command');

            // 手動建立 repo 原有的檔案
            const repoPath = getRepoPath(repo.id);
            const userOwnDir = path.join(repoPath, '.claude', 'commands');
            await fs.mkdir(userOwnDir, { recursive: true });
            await fs.writeFile(path.join(userOwnDir, 'user-own.md'), '# User Own');

            await bindCommandToPod(pod.id, command.id);
            await bindRepositoryToPod(pod.id, repo.id);

            const commandPath = path.join(repoPath, '.claude', 'commands', `${command.id}.md`);
            expect(await fileExists(commandPath)).toBe(true);

            // 刪除 Pod
            await deletePod(pod.id);

            // Pod 管理的 command 應被刪除
            expect(await fileExists(commandPath)).toBe(false);

            // manifest 應被刪除
            expect(await fileExists(getManifestPath(repo.id, pod.id))).toBe(false);

            // 原有的 user-own.md 應保留
            const userOwnPath = path.join(userOwnDir, 'user-own.md');
            expect(await fileExists(userOwnPath)).toBe(true);
        });
    });

    describe('場景七：多 Pod 共享 repo', () => {
        it('各自 manifest 獨立，解綁一個不影響另一個', async () => {
            const podA = await createPod(client);
            const podB = await createPod(client);
            const repo = await createRepository(client, `manifest-s7-${uuidv4()}`);
            const cmdA = await createCommand(client, `cmd-${uuidv4()}`, '# Command A');
            const cmdB = await createCommand(client, `cmd-${uuidv4()}`, '# Command B');

            await bindCommandToPod(podA.id, cmdA.id);
            await bindCommandToPod(podB.id, cmdB.id);

            await bindRepositoryToPod(podA.id, repo.id);
            await bindRepositoryToPod(podB.id, repo.id);

            const repoPath = getRepoPath(repo.id);
            const cmdAPath = path.join(repoPath, '.claude', 'commands', `${cmdA.id}.md`);
            const cmdBPath = path.join(repoPath, '.claude', 'commands', `${cmdB.id}.md`);

            // 兩個 command 都應存在
            expect(await fileExists(cmdAPath)).toBe(true);
            expect(await fileExists(cmdBPath)).toBe(true);

            // 各自的 manifest 應獨立存在
            expect(await fileExists(getManifestPath(repo.id, podA.id))).toBe(true);
            expect(await fileExists(getManifestPath(repo.id, podB.id))).toBe(true);

            const manifestA = await readManifestFiles(repo.id, podA.id);
            const manifestB = await readManifestFiles(repo.id, podB.id);

            expect(manifestA).toContain(`.claude/commands/${cmdA.id}.md`);
            expect(manifestA).not.toContain(`.claude/commands/${cmdB.id}.md`);
            expect(manifestB).toContain(`.claude/commands/${cmdB.id}.md`);
            expect(manifestB).not.toContain(`.claude/commands/${cmdA.id}.md`);

            // 解綁 podA
            await unbindRepositoryFromPod(podA.id);

            // podA 的 command 應被刪除，manifest 應被刪除
            expect(await fileExists(cmdAPath)).toBe(false);
            expect(await fileExists(getManifestPath(repo.id, podA.id))).toBe(false);

            // podB 的 command 應仍然存在
            expect(await fileExists(cmdBPath)).toBe(true);
            expect(await fileExists(getManifestPath(repo.id, podB.id))).toBe(true);
        });
    });

    describe('場景八：同名衝突', () => {
        it('Pod 資源覆蓋 repo 原有同名檔案，解綁後該檔案被刪除', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-s8-${uuidv4()}`);

            // 建立 command
            const command = await createCommand(client, `cmd-${uuidv4()}`, '# Command Content');

            // 在 repo 手動建立同名的原有檔案
            const repoPath = getRepoPath(repo.id);
            const commandsDir = path.join(repoPath, '.claude', 'commands');
            await fs.mkdir(commandsDir, { recursive: true });
            const sameNamePath = path.join(commandsDir, `${command.id}.md`);
            await fs.writeFile(sameNamePath, '# Original Content');

            const originalContent = await fs.readFile(sameNamePath, 'utf-8');
            expect(originalContent).toBe('# Original Content');

            // Pod 綁定同名的 command 到 repo，應覆蓋原有檔案
            await bindCommandToPod(pod.id, command.id);
            await bindRepositoryToPod(pod.id, repo.id);

            expect(await fileExists(sameNamePath)).toBe(true);
            const newContent = await fs.readFile(sameNamePath, 'utf-8');
            expect(newContent).toBe('# Command Content');

            // manifest 應記錄該路徑
            const managedFiles = await readManifestFiles(repo.id, pod.id);
            expect(managedFiles).toContain(`.claude/commands/${command.id}.md`);

            // Pod 解綁後，該檔案應被刪除
            await unbindRepositoryFromPod(pod.id);
            expect(await fileExists(sameNamePath)).toBe(false);
        });
    });

    describe('場景九：Pod 從 repo A 切換到 repo B', () => {
        it('repo A 的資源和 manifest 被清除，repo B 有 Pod 的資源和 manifest', async () => {
            const pod = await createPod(client);
            const command = await createCommand(client, `cmd-${uuidv4()}`, '# Command');

            await bindCommandToPod(pod.id, command.id);

            const repoA = await createRepository(client, `manifest-s9-a-${uuidv4()}`);
            await bindRepositoryToPod(pod.id, repoA.id);

            const repoAPath = getRepoPath(repoA.id);
            const commandPathInA = path.join(repoAPath, '.claude', 'commands', `${command.id}.md`);

            expect(await fileExists(commandPathInA)).toBe(true);
            expect(await fileExists(getManifestPath(repoA.id, pod.id))).toBe(true);

            const repoB = await createRepository(client, `manifest-s9-b-${uuidv4()}`);
            await bindRepositoryToPod(pod.id, repoB.id);

            expect(await fileExists(commandPathInA)).toBe(false);
            expect(await fileExists(getManifestPath(repoA.id, pod.id))).toBe(false);

            const repoBPath = getRepoPath(repoB.id);
            const commandPathInB = path.join(repoBPath, '.claude', 'commands', `${command.id}.md`);
            expect(await fileExists(commandPathInB)).toBe(true);
            expect(await fileExists(getManifestPath(repoB.id, pod.id))).toBe(true);

            const managedFiles = await readManifestFiles(repoB.id, pod.id);
            expect(managedFiles).toContain(`.claude/commands/${command.id}.md`);
        });
    });

    describe('場景十：孤兒 manifest 清理', () => {
        it('孤兒 manifest 對應的檔案和 manifest 本身都被清除', async () => {
            const repo = await createRepository(client, `manifest-s10-${uuidv4()}`);
            const repoPath = getRepoPath(repo.id);
            const claudeDir = path.join(repoPath, '.claude');
            await fs.mkdir(claudeDir, { recursive: true });

            // 使用合法的 UUID 格式作為假的 podId，才能通過 validatePodId 檢查
            const fakePodId = uuidv4();
            const orphanManifestPath = path.join(claudeDir, `.pod-manifest-${fakePodId}.json`);

            // 在 repo 的 .claude/ 目錄下手動建立孤兒 manifest，並建立對應的假檔案
            const fakeCommandRelPath = `.claude/commands/fake-cmd-${uuidv4()}.md`;
            const fakeCommandAbsPath = path.join(repoPath, fakeCommandRelPath);
            await fs.mkdir(path.dirname(fakeCommandAbsPath), { recursive: true });
            await fs.writeFile(fakeCommandAbsPath, '# Fake Command');

            const orphanManifest = { managedFiles: [fakeCommandRelPath] };
            await fs.writeFile(orphanManifestPath, JSON.stringify(orphanManifest, null, 2), 'utf-8');

            expect(await fileExists(orphanManifestPath)).toBe(true);
            expect(await fileExists(fakeCommandAbsPath)).toBe(true);

            const pod = await createPod(client);
            await bindRepositoryToPod(pod.id, repo.id);

            expect(await fileExists(fakeCommandAbsPath)).toBe(false);
            expect(await fileExists(orphanManifestPath)).toBe(false);
        });
    });

    describe('場景：多種資源類型同時 sync', () => {
        it('command、skill、subAgent 都被正確複製且記錄在 manifest 中', async () => {
            const pod = await createPod(client);
            const repo = await createRepository(client, `manifest-multi-${uuidv4()}`);
            const skillId = await createSkillFile(`skill-${uuidv4()}`, '# Test Skill');
            const subAgent = await createSubAgent(client, `agent-${uuidv4()}`, '# Agent Content');
            const command = await createCommand(client, `cmd-${uuidv4()}`, '# Command Content');

            const canvasId = await getCanvasId(client);

            await emitAndWaitResponse(client, WebSocketRequestEvents.POD_BIND_SKILL, WebSocketResponseEvents.POD_SKILL_BOUND, {
                requestId: uuidv4(), canvasId, podId: pod.id, skillId
            });
            await emitAndWaitResponse(client, WebSocketRequestEvents.POD_BIND_SUBAGENT, WebSocketResponseEvents.POD_SUBAGENT_BOUND, {
                requestId: uuidv4(), canvasId, podId: pod.id, subAgentId: subAgent.id
            });
            await bindCommandToPod(pod.id, command.id);
            await bindRepositoryToPod(pod.id, repo.id);

            const repoPath = getRepoPath(repo.id);

            expect(await fileExists(path.join(repoPath, '.claude', 'commands', `${command.id}.md`))).toBe(true);
            expect(await fileExists(path.join(repoPath, '.claude', 'skills', skillId, 'SKILL.md'))).toBe(true);
            expect(await fileExists(path.join(repoPath, '.claude', 'agents', `${subAgent.id}.md`))).toBe(true);

            const managedFiles = await readManifestFiles(repo.id, pod.id);
            expect(managedFiles).toContain(`.claude/commands/${command.id}.md`);
            expect(managedFiles).toContain(`.claude/skills/${skillId}/SKILL.md`);
            expect(managedFiles).toContain(`.claude/agents/${subAgent.id}.md`);
        });
    });
});
