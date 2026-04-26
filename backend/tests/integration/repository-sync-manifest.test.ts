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
import { createPod, createRepository, getCanvasId } from "../helpers";
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
});
