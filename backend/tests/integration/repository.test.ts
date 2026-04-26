import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import {
  createPod,
  createRepository,
  createRepositoryNote,
  FAKE_REPO_ID,
  FAKE_UUID,
  getCanvasId,
  describeNoteCRUDTests,
  describePodBindingTests,
} from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodBindRepositoryPayload,
  type PodUnbindRepositoryPayload,
  type RepositoryCreatePayload,
  type RepositoryDeletePayload,
  type RepositoryListPayload,
  type RepositoryNoteCreatePayload,
  type RepositoryCheckGitPayload,
  type RepositoryWorktreeCreatePayload,
} from "../../src/schemas";
import {
  type PodRepositoryBoundPayload,
  type PodRepositoryUnboundPayload,
  type RepositoryCreatedPayload,
  type RepositoryDeletedPayload,
  type RepositoryListResultPayload,
  type RepositoryNoteCreatedPayload,
  type RepositoryCheckGitResultPayload,
  type RepositoryWorktreeCreatedPayload,
} from "../../src/types";

describe("Repository 管理", () => {
  const { getServer, getClient } = setupIntegrationTest();

  describe("Repository 建立", () => {
    it("成功建立", async () => {
      const client = getClient();
      const name = `repo-${uuidv4()}`;
      const repo = await createRepository(client, name);

      expect(repo.id).toBeDefined();
      expect(repo.name).toBe(name);
    });

    it("重複名稱時建立失敗", async () => {
      const client = getClient();
      const name = `dup-repo-${uuidv4()}`;
      await createRepository(client, name);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryCreatePayload,
        RepositoryCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CREATE,
        WebSocketResponseEvents.REPOSITORY_CREATED,
        { requestId: uuidv4(), canvasId, name },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Repository 列表", () => {
    it("成功回傳所有 Repository", async () => {
      const client = getClient();
      const name = `list-repo-${uuidv4()}`;
      await createRepository(client, name);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryListPayload,
        RepositoryListResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_LIST,
        WebSocketResponseEvents.REPOSITORY_LIST_RESULT,
        { requestId: uuidv4(), canvasId },
      );

      expect(response.success).toBe(true);
      const names = response.repositories!.map((r) => r.name);
      expect(names).toContain(name);
    });
  });

  describe("Repository Note 特有測試", () => {
    it("Repository 不存在時建立 Note 失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryNoteCreatePayload,
        RepositoryNoteCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_NOTE_CREATE,
        WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: FAKE_REPO_ID,
          name: "Bad",
          x: 0,
          y: 0,
          boundToPodId: null,
          originalPosition: null,
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Pod 解除綁定 Repository", () => {
    it("成功解除綁定 Repository", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const repo = await createRepository(client, `unbind-repo-${uuidv4()}`);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<
        PodBindRepositoryPayload,
        PodRepositoryBoundPayload
      >(
        client,
        WebSocketRequestEvents.POD_BIND_REPOSITORY,
        WebSocketResponseEvents.POD_REPOSITORY_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, repositoryId: repo.id },
      );

      const response = await emitAndWaitResponse<
        PodUnbindRepositoryPayload,
        PodRepositoryUnboundPayload
      >(
        client,
        WebSocketRequestEvents.POD_UNBIND_REPOSITORY,
        WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id },
      );

      expect(response.success).toBe(true);
      expect(response.pod!.repositoryId).toBeNull();
    });

    it("Pod 不存在時解除綁定失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodUnbindRepositoryPayload,
        PodRepositoryUnboundPayload
      >(
        client,
        WebSocketRequestEvents.POD_UNBIND_REPOSITORY,
        WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Repository 刪除", () => {
    it("成功刪除", async () => {
      const client = getClient();
      const repo = await createRepository(client, `del-repo-${uuidv4()}`);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryDeletePayload,
        RepositoryDeletedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_DELETE,
        WebSocketResponseEvents.REPOSITORY_DELETED,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(true);
    });

    it("不存在的 ID 時刪除失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryDeletePayload,
        RepositoryDeletedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_DELETE,
        WebSocketResponseEvents.REPOSITORY_DELETED,
        { requestId: uuidv4(), canvasId, repositoryId: FAKE_REPO_ID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("使用中時刪除失敗", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const repo = await createRepository(client, `inuse-repo-${uuidv4()}`);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<
        PodBindRepositoryPayload,
        PodRepositoryBoundPayload
      >(
        client,
        WebSocketRequestEvents.POD_BIND_REPOSITORY,
        WebSocketResponseEvents.POD_REPOSITORY_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, repositoryId: repo.id },
      );

      const response = await emitAndWaitResponse<
        RepositoryDeletePayload,
        RepositoryDeletedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_DELETE,
        WebSocketResponseEvents.REPOSITORY_DELETED,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Repository Git 檢查", () => {
    it("檢查非 Git Repository 成功", async () => {
      const client = getClient();
      const repo = await createRepository(client, `check-repo-${uuidv4()}`);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryCheckGitPayload,
        RepositoryCheckGitResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CHECK_GIT,
        WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(true);
      expect(response.isGit).toBe(false);
    });

    it("Repository 不存在時檢查失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryCheckGitPayload,
        RepositoryCheckGitResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CHECK_GIT,
        WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: FAKE_REPO_ID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Repository Worktree 建立", () => {
    it("Repository 不存在時建立失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: FAKE_REPO_ID,
          worktreeName: "feature",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("非 Git Repository 時建立失敗", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `worktree-non-git-${uuidv4()}`,
      );

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: repo.id,
          worktreeName: "feature",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("無 commit 時建立失敗", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `worktree-no-commit-${uuidv4()}`,
      );

      const { config } = await import("../../src/config/index.js");
      const { execSync } = await import("child_process");
      const path = await import("path");
      const repoPath = path.join(config.repositoriesRoot, repo.id);
      execSync(`git init "${repoPath}"`, { encoding: "utf-8" });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: repo.id,
          worktreeName: "feature",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("分支已存在時建立失敗", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `worktree-dup-branch-${uuidv4()}`,
      );

      const { config } = await import("../../src/config/index.js");
      const { execSync } = await import("child_process");
      const path = await import("path");
      const repoPath = path.join(config.repositoriesRoot, repo.id);

      execSync(`git init "${repoPath}"`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" config user.email "test@example.com"`, {
        encoding: "utf-8",
      });
      execSync(`git -C "${repoPath}" config user.name "Test User"`, {
        encoding: "utf-8",
      });
      execSync(`echo "test" > "${repoPath}/README.md"`, {
        encoding: "utf-8",
        shell: "/bin/bash",
      });
      execSync(`git -C "${repoPath}" add .`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" commit -m "Initial commit"`, {
        encoding: "utf-8",
      });
      execSync(`git -C "${repoPath}" branch existing-branch`, {
        encoding: "utf-8",
      });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: repo.id,
          worktreeName: "existing-branch",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("成功建立並包含父 Repository 資訊", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `worktree-parent-${uuidv4()}`,
      );

      const { config } = await import("../../src/config/index.js");
      const { execSync } = await import("child_process");
      const path = await import("path");
      const repoPath = path.join(config.repositoriesRoot, repo.id);

      execSync(`git init "${repoPath}"`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" config user.email "test@example.com"`, {
        encoding: "utf-8",
      });
      execSync(`git -C "${repoPath}" config user.name "Test User"`, {
        encoding: "utf-8",
      });
      execSync(`echo "test" > "${repoPath}/README.md"`, {
        encoding: "utf-8",
        shell: "/bin/bash",
      });
      execSync(`git -C "${repoPath}" add .`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" commit -m "Initial commit"`, {
        encoding: "utf-8",
      });

      const worktreeName = "feature-test";
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id, worktreeName },
      );

      expect(response.success).toBe(true);
      expect(response.repository!.parentRepoId).toBe(repo.id);
      expect(response.repository!.branchName).toBe(worktreeName);
    });
  });

  describe("Repository Metadata 持久化", () => {
    it("建立 Worktree 後 Metadata 持久化成功", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `metadata-persist-${uuidv4()}`,
      );

      const { config } = await import("../../src/config/index.js");
      const { execSync } = await import("child_process");
      const path = await import("path");
      const repoPath = path.join(config.repositoriesRoot, repo.id);

      execSync(`git init "${repoPath}"`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" config user.email "test@example.com"`, {
        encoding: "utf-8",
      });
      execSync(`git -C "${repoPath}" config user.name "Test User"`, {
        encoding: "utf-8",
      });
      execSync(`echo "test" > "${repoPath}/README.md"`, {
        encoding: "utf-8",
        shell: "/bin/bash",
      });
      execSync(`git -C "${repoPath}" add .`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" commit -m "Initial commit"`, {
        encoding: "utf-8",
      });

      const worktreeName = "persist-branch";
      const canvasId = await getCanvasId(client);
      const createResponse = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id, worktreeName },
      );

      expect(createResponse.success).toBe(true);

      const { repositoryService } =
        await import("../../src/services/repositoryService.js");
      const worktreeRepoId = createResponse.repository!.id;
      const metadata = repositoryService.getMetadata(worktreeRepoId);
      expect(metadata).toBeDefined();
      expect(metadata!.parentRepoId).toBe(repo.id);
      expect(metadata!.branchName).toBe(worktreeName);
    });

    it("重啟後 Metadata 載入成功", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `metadata-restart-${uuidv4()}`,
      );

      const { config } = await import("../../src/config/index.js");
      const { execSync } = await import("child_process");
      const path = await import("path");
      const repoPath = path.join(config.repositoriesRoot, repo.id);

      execSync(`git init "${repoPath}"`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" config user.email "test@example.com"`, {
        encoding: "utf-8",
      });
      execSync(`git -C "${repoPath}" config user.name "Test User"`, {
        encoding: "utf-8",
      });
      execSync(`echo "test" > "${repoPath}/README.md"`, {
        encoding: "utf-8",
        shell: "/bin/bash",
      });
      execSync(`git -C "${repoPath}" add .`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" commit -m "Initial commit"`, {
        encoding: "utf-8",
      });

      const worktreeName = "restart-branch";
      const canvasId = await getCanvasId(client);
      const createResponse = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id, worktreeName },
      );

      expect(createResponse.success).toBe(true);
      const worktreeRepoId = createResponse.repository!.id;

      const { repositoryService } =
        await import("../../src/services/repositoryService.js");
      await repositoryService.initialize();

      const metadata = repositoryService.getMetadata(worktreeRepoId);
      expect(metadata).toBeDefined();
      expect(metadata!.parentRepoId).toBe(repo.id);
      expect(metadata!.branchName).toBe(worktreeName);
    });

    it("刪除 Repository 後 Metadata 移除成功", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `metadata-delete-${uuidv4()}`,
      );

      const { config } = await import("../../src/config/index.js");
      const { execSync } = await import("child_process");
      const path = await import("path");
      const repoPath = path.join(config.repositoriesRoot, repo.id);

      execSync(`git init "${repoPath}"`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" config user.email "test@example.com"`, {
        encoding: "utf-8",
      });
      execSync(`git -C "${repoPath}" config user.name "Test User"`, {
        encoding: "utf-8",
      });
      execSync(`echo "test" > "${repoPath}/README.md"`, {
        encoding: "utf-8",
        shell: "/bin/bash",
      });
      execSync(`git -C "${repoPath}" add .`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" commit -m "Initial commit"`, {
        encoding: "utf-8",
      });

      const worktreeName = "delete-branch";
      const canvasId = await getCanvasId(client);
      const createResponse = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id, worktreeName },
      );

      expect(createResponse.success).toBe(true);
      const worktreeRepoId = createResponse.repository!.id;

      const deleteResponse = await emitAndWaitResponse<
        RepositoryDeletePayload,
        RepositoryDeletedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_DELETE,
        WebSocketResponseEvents.REPOSITORY_DELETED,
        { requestId: uuidv4(), canvasId, repositoryId: worktreeRepoId },
      );

      expect(deleteResponse.success).toBe(true);

      const { repositoryService } =
        await import("../../src/services/repositoryService.js");
      const metadata = repositoryService.getMetadata(worktreeRepoId);
      expect(metadata).toBeUndefined();
    });
  });

  describe("Repository Worktree 刪除", () => {
    it("成功刪除並清理 Worktree", async () => {
      const client = getClient();
      const repo = await createRepository(
        client,
        `worktree-cleanup-${uuidv4()}`,
      );

      const { config } = await import("../../src/config/index.js");
      const { execSync } = await import("child_process");
      const path = await import("path");
      const repoPath = path.join(config.repositoriesRoot, repo.id);

      execSync(`git init "${repoPath}"`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" config user.email "test@example.com"`, {
        encoding: "utf-8",
      });
      execSync(`git -C "${repoPath}" config user.name "Test User"`, {
        encoding: "utf-8",
      });
      execSync(`echo "test" > "${repoPath}/README.md"`, {
        encoding: "utf-8",
        shell: "/bin/bash",
      });
      execSync(`git -C "${repoPath}" add .`, { encoding: "utf-8" });
      execSync(`git -C "${repoPath}" commit -m "Initial commit"`, {
        encoding: "utf-8",
      });

      const worktreeName = "cleanup-branch";
      const canvasId = await getCanvasId(client);
      const createResponse = await emitAndWaitResponse<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
        WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id, worktreeName },
      );

      expect(createResponse.success).toBe(true);

      const worktreeRepoId = createResponse.repository!.id;
      const deleteResponse = await emitAndWaitResponse<
        RepositoryDeletePayload,
        RepositoryDeletedPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_DELETE,
        WebSocketResponseEvents.REPOSITORY_DELETED,
        { requestId: uuidv4(), canvasId, repositoryId: worktreeRepoId },
      );

      expect(deleteResponse.success).toBe(true);

      const branches = execSync(`git -C "${repoPath}" branch`, {
        encoding: "utf-8",
      });
      expect(branches).not.toContain(worktreeName);

      const worktreeList = execSync(`git -C "${repoPath}" worktree list`, {
        encoding: "utf-8",
      });
      expect(worktreeList).not.toContain(worktreeRepoId);
    });
  });

  // 使用工廠函數產生 Note CRUD 測試
  describeNoteCRUDTests(
    {
      resourceName: "Repository",
      createParentResource: async (client) => {
        return await createRepository(client, `repo-${uuidv4()}`);
      },
      createNote: createRepositoryNote,
      events: {
        list: {
          request: WebSocketRequestEvents.REPOSITORY_NOTE_LIST,
          response: WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT,
        },
        update: {
          request: WebSocketRequestEvents.REPOSITORY_NOTE_UPDATE,
          response: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
        },
        delete: {
          request: WebSocketRequestEvents.REPOSITORY_NOTE_DELETE,
          response: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
        },
      },
      parentIdFieldName: "repositoryId",
    },
    () => ({ client: getClient(), server: getServer() }),
  );

  // 使用工廠函數產生 Pod Binding 測試
  describePodBindingTests(
    {
      resourceName: "Repository",
      createResource: async (client) => {
        return await createRepository(client, `repo-${uuidv4()}`);
      },
      fakeResourceId: FAKE_REPO_ID,
      bindEvent: {
        request: WebSocketRequestEvents.POD_BIND_REPOSITORY,
        response: WebSocketResponseEvents.POD_REPOSITORY_BOUND,
      },
      buildBindPayload: (canvasId, podId, repositoryId) => ({
        canvasId,
        podId,
        repositoryId,
      }),
      verifyBoundResponse: (response, repositoryId) => {
        expect(response.pod.repositoryId).toBe(repositoryId);
      },
    },
    () => ({ client: getClient(), server: getServer() }),
  );
});
