import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import {
  closeTestServer,
  createSocketClient,
  createTestServer,
  disconnectSocket,
  emitAndWaitResponse,
  type TestServerInstance,
  type TestWebSocketClient,
  testConfig,
} from "../setup";
import {
  createPod,
  createRepository,
  createSubAgent,
  getCanvasId,
} from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodBindRepositoryPayload,
  type PodUnbindRepositoryPayload,
  type PodDeletePayload,
} from "../../src/schemas/index.js";
import {
  type PodRepositoryBoundPayload,
  type PodRepositoryUnboundPayload,
  type PodDeletedPayload,
} from "../../src/types";
import { podManifestService } from "../../src/services/podManifestService.js";

describe("Repository Sync Manifest 整合測試", () => {
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
    return emitAndWaitResponse<
      PodBindRepositoryPayload,
      PodRepositoryBoundPayload
    >(
      client,
      WebSocketRequestEvents.POD_BIND_REPOSITORY,
      WebSocketResponseEvents.POD_REPOSITORY_BOUND,
      { requestId: uuidv4(), canvasId, podId, repositoryId },
    );
  }

  async function unbindRepositoryFromPod(podId: string) {
    const canvasId = await getCanvasId(client);
    return emitAndWaitResponse<
      PodUnbindRepositoryPayload,
      PodRepositoryUnboundPayload
    >(
      client,
      WebSocketRequestEvents.POD_UNBIND_REPOSITORY,
      WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
      { requestId: uuidv4(), canvasId, podId },
    );
  }

  async function bindSubAgentToPod(podId: string, subAgentId: string) {
    const canvasId = await getCanvasId(client);
    return emitAndWaitResponse(
      client,
      WebSocketRequestEvents.POD_BIND_SUBAGENT,
      WebSocketResponseEvents.POD_SUBAGENT_BOUND,
      { requestId: uuidv4(), canvasId, podId, subAgentId },
    );
  }

  async function deletePod(podId: string) {
    const canvasId = await getCanvasId(client);
    return emitAndWaitResponse<PodDeletePayload, PodDeletedPayload>(
      client,
      WebSocketRequestEvents.POD_DELETE,
      WebSocketResponseEvents.POD_DELETED,
      { requestId: uuidv4(), canvasId, podId },
    );
  }

  function getRepoPath(repositoryId: string): string {
    return path.join(testConfig.repositoriesRoot, repositoryId);
  }

  async function fileExists(filePath: string): Promise<boolean> {
    return fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
  }

  function hasManifestRecord(repositoryId: string, podId: string): boolean {
    return podManifestService.readManifest(repositoryId, podId).length > 0;
  }

  function readManifestFiles(repositoryId: string, podId: string): string[] {
    return podManifestService.readManifest(repositoryId, podId);
  }

  describe("場景一：Pod 有資源綁定 repo", () => {
    it("資源被複製且 manifest 正確記錄", async () => {
      const pod = await createPod(client);
      const repo = await createRepository(client, `manifest-s1-${uuidv4()}`);
      const subAgent = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent Content",
      );

      await bindSubAgentToPod(pod.id, subAgent.id);
      await bindRepositoryToPod(pod.id, repo.id);

      const repoPath = getRepoPath(repo.id);
      const agentPath = path.join(
        repoPath,
        ".claude",
        "agents",
        `${subAgent.id}.md`,
      );

      expect(await fileExists(agentPath)).toBe(true);
      expect(hasManifestRecord(repo.id, pod.id)).toBe(true);

      const managedFiles = readManifestFiles(repo.id, pod.id);
      expect(managedFiles).toContain(`.claude/agents/${subAgent.id}.md`);
    });
  });

  describe("場景二：Pod 沒有資源綁定 repo", () => {
    it("repo 原有 .claude/ 內容不被清空", async () => {
      const pod = await createPod(client);
      const repo = await createRepository(client, `manifest-s2-${uuidv4()}`);

      // 在 repo 先手動建立一個原有檔案
      const repoPath = getRepoPath(repo.id);
      const userOwnDir = path.join(repoPath, ".claude", "commands");
      await fs.mkdir(userOwnDir, { recursive: true });
      await fs.writeFile(
        path.join(userOwnDir, "user-own.md"),
        "# User Own Command",
      );

      // Pod 沒有資源，綁定 repo
      await bindRepositoryToPod(pod.id, repo.id);

      // 原有檔案應該仍然存在
      const userOwnPath = path.join(userOwnDir, "user-own.md");
      expect(await fileExists(userOwnPath)).toBe(true);
    });
  });

  describe("場景三：Pod 新增資源後 sync", () => {
    it("新檔案加入 manifest 且舊檔案不受影響", async () => {
      const pod = await createPod(client);
      const repo = await createRepository(client, `manifest-s3-${uuidv4()}`);
      const subAgent1 = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent 1",
      );

      await bindSubAgentToPod(pod.id, subAgent1.id);
      await bindRepositoryToPod(pod.id, repo.id);

      const managedFilesBefore = readManifestFiles(repo.id, pod.id);
      expect(managedFilesBefore).toContain(`.claude/agents/${subAgent1.id}.md`);

      // 解綁再綁回 repo，模擬換新 subAgent 後的 sync
      await unbindRepositoryFromPod(pod.id);

      // 綁定新的 subAgent
      const subAgent2 = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent 2",
      );
      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse(
        client,
        WebSocketRequestEvents.POD_BIND_SUBAGENT,
        WebSocketResponseEvents.POD_SUBAGENT_BOUND,
        {
          requestId: uuidv4(),
          canvasId,
          podId: pod.id,
          subAgentId: subAgent2.id,
        },
      );

      // 綁回 repo，觸發新 sync
      await bindRepositoryToPod(pod.id, repo.id);

      const managedFilesAfter = readManifestFiles(repo.id, pod.id);
      expect(managedFilesAfter).toContain(`.claude/agents/${subAgent2.id}.md`);

      const repoPath = getRepoPath(repo.id);
      const agent2Path = path.join(
        repoPath,
        ".claude",
        "agents",
        `${subAgent2.id}.md`,
      );
      expect(await fileExists(agent2Path)).toBe(true);
    });
  });

  describe("場景四：Pod 解綁 repo 後資源從 repo 清除且 manifest 更新", () => {
    it("解綁 repo 後 Pod 管理的 subAgent 檔案從 repo 刪除且 manifest 清除", async () => {
      const pod = await createPod(client);
      const repo = await createRepository(client, `manifest-s4-${uuidv4()}`);
      const subAgent = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent Content",
      );

      await bindSubAgentToPod(pod.id, subAgent.id);
      await bindRepositoryToPod(pod.id, repo.id);

      const repoPath = getRepoPath(repo.id);
      const agentPath = path.join(
        repoPath,
        ".claude",
        "agents",
        `${subAgent.id}.md`,
      );

      // 綁定後 subAgent 應存在於 repo
      expect(await fileExists(agentPath)).toBe(true);
      expect(hasManifestRecord(repo.id, pod.id)).toBe(true);

      // 解綁 repo
      await unbindRepositoryFromPod(pod.id);

      // subAgent 檔案應已從 repo 刪除，manifest 應清除
      expect(await fileExists(agentPath)).toBe(false);
      expect(hasManifestRecord(repo.id, pod.id)).toBe(false);
    });
  });

  describe("場景五：Pod 解綁 repo", () => {
    it("只刪除該 Pod manifest 中的檔案，manifest 本身也刪除", async () => {
      const pod = await createPod(client);
      const repo = await createRepository(client, `manifest-s5-${uuidv4()}`);
      const subAgent = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent Content",
      );

      // 手動建立 repo 原有的檔案
      const repoPath = getRepoPath(repo.id);
      const userOwnDir = path.join(repoPath, ".claude", "agents");
      await fs.mkdir(userOwnDir, { recursive: true });
      await fs.writeFile(
        path.join(userOwnDir, "user-own-agent.md"),
        "# User Own Agent",
      );

      await bindSubAgentToPod(pod.id, subAgent.id);
      await bindRepositoryToPod(pod.id, repo.id);

      const agentPath = path.join(
        repoPath,
        ".claude",
        "agents",
        `${subAgent.id}.md`,
      );
      expect(await fileExists(agentPath)).toBe(true);

      // 解綁 repo
      await unbindRepositoryFromPod(pod.id);

      // Pod 管理的 subAgent 應被刪除
      expect(await fileExists(agentPath)).toBe(false);

      // manifest 記錄應被刪除
      expect(hasManifestRecord(repo.id, pod.id)).toBe(false);

      // 原有的 user-own-agent.md 應保留
      const userOwnPath = path.join(userOwnDir, "user-own-agent.md");
      expect(await fileExists(userOwnPath)).toBe(true);
    });
  });

  describe("場景六：Pod 被刪除", () => {
    it("Pod 管理的資源被清除，manifest 被刪除，repo 原有檔案保留", async () => {
      const pod = await createPod(client);
      const repo = await createRepository(client, `manifest-s6-${uuidv4()}`);
      const subAgent = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent Content",
      );

      // 手動建立 repo 原有的檔案
      const repoPath = getRepoPath(repo.id);
      const userOwnDir = path.join(repoPath, ".claude", "agents");
      await fs.mkdir(userOwnDir, { recursive: true });
      await fs.writeFile(
        path.join(userOwnDir, "user-own-agent.md"),
        "# User Own Agent",
      );

      await bindSubAgentToPod(pod.id, subAgent.id);
      await bindRepositoryToPod(pod.id, repo.id);

      const agentPath = path.join(
        repoPath,
        ".claude",
        "agents",
        `${subAgent.id}.md`,
      );
      expect(await fileExists(agentPath)).toBe(true);

      // 刪除 Pod
      await deletePod(pod.id);

      // Pod 管理的 subAgent 應被刪除
      expect(await fileExists(agentPath)).toBe(false);

      // manifest 記錄應被刪除
      expect(hasManifestRecord(repo.id, pod.id)).toBe(false);

      // 原有的 user-own-agent.md 應保留
      const userOwnPath = path.join(userOwnDir, "user-own-agent.md");
      expect(await fileExists(userOwnPath)).toBe(true);
    });
  });

  describe("場景七：多 Pod 共享 repo", () => {
    it("各自 manifest 獨立，解綁一個不影響另一個", async () => {
      const podA = await createPod(client);
      const podB = await createPod(client);
      const repo = await createRepository(client, `manifest-s7-${uuidv4()}`);
      const subAgentA = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent A",
      );
      const subAgentB = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent B",
      );

      await bindSubAgentToPod(podA.id, subAgentA.id);
      await bindSubAgentToPod(podB.id, subAgentB.id);

      await bindRepositoryToPod(podA.id, repo.id);
      await bindRepositoryToPod(podB.id, repo.id);

      const repoPath = getRepoPath(repo.id);
      const agentAPath = path.join(
        repoPath,
        ".claude",
        "agents",
        `${subAgentA.id}.md`,
      );
      const agentBPath = path.join(
        repoPath,
        ".claude",
        "agents",
        `${subAgentB.id}.md`,
      );

      // 兩個 subAgent 都應存在
      expect(await fileExists(agentAPath)).toBe(true);
      expect(await fileExists(agentBPath)).toBe(true);

      // 各自的 manifest 應獨立存在
      expect(hasManifestRecord(repo.id, podA.id)).toBe(true);
      expect(hasManifestRecord(repo.id, podB.id)).toBe(true);

      const manifestA = readManifestFiles(repo.id, podA.id);
      const manifestB = readManifestFiles(repo.id, podB.id);

      expect(manifestA).toContain(`.claude/agents/${subAgentA.id}.md`);
      expect(manifestA).not.toContain(`.claude/agents/${subAgentB.id}.md`);
      expect(manifestB).toContain(`.claude/agents/${subAgentB.id}.md`);
      expect(manifestB).not.toContain(`.claude/agents/${subAgentA.id}.md`);

      // 解綁 podA
      await unbindRepositoryFromPod(podA.id);

      // podA 的 subAgent 應被刪除，manifest 應被刪除
      expect(await fileExists(agentAPath)).toBe(false);
      expect(hasManifestRecord(repo.id, podA.id)).toBe(false);

      // podB 的 subAgent 應仍然存在
      expect(await fileExists(agentBPath)).toBe(true);
      expect(hasManifestRecord(repo.id, podB.id)).toBe(true);
    });
  });

  describe("場景九：Pod 從 repo A 切換到 repo B", () => {
    it("repo A 的資源和 manifest 被清除，repo B 有 Pod 的資源和 manifest", async () => {
      const pod = await createPod(client);
      const subAgent = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent Content",
      );

      await bindSubAgentToPod(pod.id, subAgent.id);

      const repoA = await createRepository(client, `manifest-s9-a-${uuidv4()}`);
      await bindRepositoryToPod(pod.id, repoA.id);

      const repoAPath = getRepoPath(repoA.id);
      const agentPathInA = path.join(
        repoAPath,
        ".claude",
        "agents",
        `${subAgent.id}.md`,
      );

      expect(await fileExists(agentPathInA)).toBe(true);
      expect(hasManifestRecord(repoA.id, pod.id)).toBe(true);

      const repoB = await createRepository(client, `manifest-s9-b-${uuidv4()}`);
      await bindRepositoryToPod(pod.id, repoB.id);

      expect(await fileExists(agentPathInA)).toBe(false);
      expect(hasManifestRecord(repoA.id, pod.id)).toBe(false);

      const repoBPath = getRepoPath(repoB.id);
      const agentPathInB = path.join(
        repoBPath,
        ".claude",
        "agents",
        `${subAgent.id}.md`,
      );
      expect(await fileExists(agentPathInB)).toBe(true);
      expect(hasManifestRecord(repoB.id, pod.id)).toBe(true);

      const managedFiles = readManifestFiles(repoB.id, pod.id);
      expect(managedFiles).toContain(`.claude/agents/${subAgent.id}.md`);
    });
  });

  describe("場景十：孤兒 manifest 清理", () => {
    it("孤兒 manifest 對應的檔案和 DB 記錄都被清除", async () => {
      const repo = await createRepository(client, `manifest-s10-${uuidv4()}`);
      const repoPath = getRepoPath(repo.id);

      // 使用合法的 UUID 格式作為假的 podId，才能通過 validatePodId 檢查
      const fakePodId = uuidv4();

      // 在 repo 建立假的 command 檔案
      const fakeCommandRelPath = `.claude/commands/fake-cmd-${uuidv4()}.md`;
      const fakeCommandAbsPath = path.join(repoPath, fakeCommandRelPath);
      await fs.mkdir(path.dirname(fakeCommandAbsPath), { recursive: true });
      await fs.writeFile(fakeCommandAbsPath, "# Fake Command");

      // 在 DB 插入孤兒 manifest 記錄（模擬已刪除的 Pod 遺留的記錄）
      podManifestService.writeManifest(repo.id, fakePodId, [
        fakeCommandRelPath,
      ]);

      expect(hasManifestRecord(repo.id, fakePodId)).toBe(true);
      expect(await fileExists(fakeCommandAbsPath)).toBe(true);

      // 綁定一個新 Pod，觸發 sync 時會清理孤兒
      const pod = await createPod(client);
      await bindRepositoryToPod(pod.id, repo.id);

      expect(await fileExists(fakeCommandAbsPath)).toBe(false);
      expect(hasManifestRecord(repo.id, fakePodId)).toBe(false);
    });
  });

  describe("場景：多種資源類型同時 sync", () => {
    it("subAgent 被正確複製且記錄在 manifest 中（command 不再同步至 repo）", async () => {
      const pod = await createPod(client);
      const repo = await createRepository(client, `manifest-multi-${uuidv4()}`);
      const subAgent = await createSubAgent(
        client,
        `agent-${uuidv4()}`,
        "# Agent Content",
      );

      const canvasId = await getCanvasId(client);

      await emitAndWaitResponse(
        client,
        WebSocketRequestEvents.POD_BIND_SUBAGENT,
        WebSocketResponseEvents.POD_SUBAGENT_BOUND,
        {
          requestId: uuidv4(),
          canvasId,
          podId: pod.id,
          subAgentId: subAgent.id,
        },
      );
      await bindRepositoryToPod(pod.id, repo.id);

      const repoPath = getRepoPath(repo.id);

      expect(
        await fileExists(
          path.join(repoPath, ".claude", "agents", `${subAgent.id}.md`),
        ),
      ).toBe(true);

      const managedFiles = readManifestFiles(repo.id, pod.id);
      expect(managedFiles).toContain(`.claude/agents/${subAgent.id}.md`);
    });
  });
});
