import { v4 as uuidv4 } from "uuid";
import path from "path";
import { $ } from "bun";
import type { TestWebSocketClient } from "../setup";
import {
  closeTestServer,
  createSocketClient,
  createTestServer,
  disconnectSocket,
  emitAndWaitResponse,
  waitForEvent,
  type TestServerInstance,
} from "../setup";
import {
  createRepository,
  getCanvasId,
  initGitRepo,
  initGitRepoWithRemote,
  cleanupRepo,
} from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type RepositoryGetLocalBranchesPayload,
  type RepositoryWorktreeCreatePayload,
  type RepositoryPullLatestPayload,
  type RepositoryCheckoutBranchPayload,
} from "../../src/schemas";
import {
  type RepositoryLocalBranchesResultPayload,
  type RepositoryWorktreeCreatedPayload,
  type RepositoryPullLatestResultPayload,
  type RepositoryPullLatestProgressPayload,
  type RepositoryBranchCheckedOutPayload,
  type BroadcastRepositoryBranchChangedPayload,
} from "../../src/types";

function waitForEventWithTimeout<T>(
  socket: TestWebSocketClient,
  eventName: string,
  ms: number = 500,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve(null);
    }, ms);

    const handler = (data: T) => {
      clearTimeout(timer);
      socket.off(eventName, handler);
      resolve(data);
    };

    socket.on(eventName, handler);
  });
}

describe("Repository Git 操作", () => {
  describe("取得本地分支", () => {
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

    async function initGitRepoForWebSocket(repoId: string): Promise<string> {
      const { config } = await import("../../src/config/index.js");
      const repoPath = path.join(config.repositoriesRoot, repoId);

      await $`git init ${repoPath}`.quiet();
      await $`git -C ${repoPath} config user.email "test@example.com"`.quiet();
      await $`git -C ${repoPath} config user.name "Test User"`.quiet();
      await $`echo "test" > ${repoPath}/README.md`.quiet();
      await $`git -C ${repoPath} add .`.quiet();
      await $`git -C ${repoPath} commit -m "Initial commit"`.quiet();

      return repoPath;
    }

    it("無 worktree 時取得分支", async () => {
      const repo = await createRepository(client, `branches-no-wt-${uuidv4()}`);
      await initGitRepoForWebSocket(repo.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryGetLocalBranchesPayload,
        RepositoryLocalBranchesResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
        WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(true);
      expect(response.branches).toBeDefined();
      expect(response.currentBranch).toBeDefined();
      expect(response.worktreeBranches).toBeDefined();
      expect(Array.isArray(response.branches)).toBe(true);
      expect(Array.isArray(response.worktreeBranches)).toBe(true);
    });

    it("有 worktree 時取得分支", async () => {
      const repo = await createRepository(
        client,
        `branches-with-wt-${uuidv4()}`,
      );
      await initGitRepoForWebSocket(repo.id);

      const worktreeName = "feature-branch";
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

      const response = await emitAndWaitResponse<
        RepositoryGetLocalBranchesPayload,
        RepositoryLocalBranchesResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
        WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(true);
      expect(response.branches).toContain(worktreeName);
      expect(response.worktreeBranches).toContain(worktreeName);
    });

    it("多個 worktree", async () => {
      const repo = await createRepository(
        client,
        `branches-multi-wt-${uuidv4()}`,
      );
      await initGitRepoForWebSocket(repo.id);

      const worktreeName1 = "feature-1";
      const worktreeName2 = "feature-2";
      const canvasId = await getCanvasId(client);

      await emitAndWaitResponse<
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
          worktreeName: worktreeName1,
        },
      );

      await emitAndWaitResponse<
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
          worktreeName: worktreeName2,
        },
      );

      const response = await emitAndWaitResponse<
        RepositoryGetLocalBranchesPayload,
        RepositoryLocalBranchesResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
        WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(true);
      expect(response.branches).toContain(worktreeName1);
      expect(response.branches).toContain(worktreeName2);
      expect(response.worktreeBranches).toContain(worktreeName1);
      expect(response.worktreeBranches).toContain(worktreeName2);
      expect(response.worktreeBranches!.length).toBe(2);
    });

    it("不存在的 repository 失敗", async () => {
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryGetLocalBranchesPayload,
        RepositoryLocalBranchesResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
        WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: "fake-repo-id" },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("非 git repository 失敗", async () => {
      const repo = await createRepository(
        client,
        `branches-non-git-${uuidv4()}`,
      );

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryGetLocalBranchesPayload,
        RepositoryLocalBranchesResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
        WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Pull 至最新版本", () => {
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

    it("不存在的 repository 回傳失敗", async () => {
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryPullLatestPayload,
        RepositoryPullLatestResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: "fake-repo-id" },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("非 git repository 回傳失敗", async () => {
      const repo = await createRepository(client, `pull-non-git-${uuidv4()}`);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryPullLatestPayload,
        RepositoryPullLatestResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("Pull 成功時收到進度事件", async () => {
      const { config } = await import("../../src/config/index.js");
      const repo = await createRepository(client, `pull-progress-${uuidv4()}`);
      const repoPath = path.join(config.repositoriesRoot, repo.id);
      const remoteRepoPath = path.join(
        config.repositoriesRoot,
        `${repo.id}-remote`,
      );

      await initGitRepoWithRemote(repoPath, remoteRepoPath);

      const canvasId = await getCanvasId(client);
      const progressEvents: RepositoryPullLatestProgressPayload[] = [];

      const progressHandler = (data: RepositoryPullLatestProgressPayload) => {
        progressEvents.push(data);
      };
      client.on(
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS,
        progressHandler,
      );

      const response = await emitAndWaitResponse<
        RepositoryPullLatestPayload,
        RepositoryPullLatestResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
        15000,
      );

      client.off(
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS,
        progressHandler,
      );

      expect(response.success).toBe(true);
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[0].progress).toBe(0);
      expect(progressEvents[0].message).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
      expect(progressEvents[progressEvents.length - 1].progress).toBe(100);

      await cleanupRepo(remoteRepoPath);
    });

    it("有 git 但無 remote 時 Pull 回傳失敗", async () => {
      const { config } = await import("../../src/config/index.js");
      const repo = await createRepository(client, `pull-no-remote-${uuidv4()}`);
      const repoPath = path.join(config.repositoriesRoot, repo.id);

      await initGitRepo(repoPath);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryPullLatestPayload,
        RepositoryPullLatestResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: repo.id },
        10000,
      );

      expect(response.success).toBe(false);
    });

    it("Worktree repository 無法 Pull", async () => {
      const { config } = await import("../../src/config/index.js");
      const repo = await createRepository(client, `pull-wt-${uuidv4()}`);
      const repoPath = path.join(config.repositoriesRoot, repo.id);
      await initGitRepo(repoPath);

      const canvasId = await getCanvasId(client);

      const worktreeResponse = await emitAndWaitResponse<
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
          worktreeName: "pull-wt-branch",
        },
      );

      expect(worktreeResponse.success).toBe(true);
      const worktreeRepoId = worktreeResponse.repository!.id;

      const response = await emitAndWaitResponse<
        RepositoryPullLatestPayload,
        RepositoryPullLatestResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
        WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
        { requestId: uuidv4(), canvasId, repositoryId: worktreeRepoId },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("切換分支 (handleRepositoryCheckoutBranch)", () => {
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

    async function getRepoPath(repoId: string): Promise<string> {
      const { config } = await import("../../src/config/index.js");
      return path.join(config.repositoriesRoot, repoId);
    }

    it("切換到已存在的本地分支成功，action 為 switched", async () => {
      const repo = await createRepository(client, `checkout-local-${uuidv4()}`);
      const repoPath = await getRepoPath(repo.id);

      await initGitRepo(repoPath);
      await $`git -C ${repoPath} branch feature-a`.quiet();

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryCheckoutBranchPayload,
        RepositoryBranchCheckedOutPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
        WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: repo.id,
          branchName: "feature-a",
          force: false,
        },
        10000,
      );

      expect(response.success).toBe(true);
      expect(response.action).toBe("switched");
      expect(response.branchName).toBe("feature-a");
    });

    it("切換到不存在的本地分支時建立新分支，action 為 created", async () => {
      const repo = await createRepository(
        client,
        `checkout-create-${uuidv4()}`,
      );
      const repoPath = await getRepoPath(repo.id);

      await initGitRepo(repoPath);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryCheckoutBranchPayload,
        RepositoryBranchCheckedOutPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
        WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: repo.id,
          branchName: "new-branch",
          force: false,
        },
        10000,
      );

      expect(response.success).toBe(true);
      expect(response.action).toBe("created");
      expect(response.branchName).toBe("new-branch");
    });

    it("不存在的 repository 回傳失敗", async () => {
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryCheckoutBranchPayload,
        RepositoryBranchCheckedOutPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
        WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: "fake-repo-id",
          branchName: "main",
          force: false,
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("非 git repository 回傳失敗", async () => {
      const repo = await createRepository(
        client,
        `checkout-non-git-${uuidv4()}`,
      );

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        RepositoryCheckoutBranchPayload,
        RepositoryBranchCheckedOutPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
        WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: repo.id,
          branchName: "main",
          force: false,
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("Worktree repository 無法切換分支", async () => {
      const repo = await createRepository(client, `checkout-wt-${uuidv4()}`);
      const repoPath = await getRepoPath(repo.id);
      await initGitRepo(repoPath);

      const canvasId = await getCanvasId(client);

      const worktreeResponse = await emitAndWaitResponse<
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
          worktreeName: "wt-branch",
        },
      );

      expect(worktreeResponse.success).toBe(true);
      const worktreeRepoId = worktreeResponse.repository!.id;

      const response = await emitAndWaitResponse<
        RepositoryCheckoutBranchPayload,
        RepositoryBranchCheckedOutPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
        WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
        {
          requestId: uuidv4(),
          canvasId,
          repositoryId: worktreeRepoId,
          branchName: "main",
          force: false,
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("clientA 收到 REPOSITORY_BRANCH_CHECKED_OUT，clientB 收到 REPOSITORY_BRANCH_CHANGED，clientA 不收到廣播", async () => {
      let clientA: TestWebSocketClient | null = null;
      let clientB: TestWebSocketClient | null = null;

      try {
        clientA = await createSocketClient(server.baseUrl, server.canvasId);
        clientB = await createSocketClient(server.baseUrl, server.canvasId);

        const repo = await createRepository(
          clientA,
          `checkout-broadcast-${uuidv4()}`,
        );
        const repoPath = await getRepoPath(repo.id);
        await initGitRepo(repoPath);

        const canvasId = await getCanvasId(clientA);

        const broadcastPromise =
          waitForEvent<BroadcastRepositoryBranchChangedPayload>(
            clientB,
            WebSocketResponseEvents.REPOSITORY_BRANCH_CHANGED,
            10000,
          );
        const clientABroadcastPromise =
          waitForEventWithTimeout<BroadcastRepositoryBranchChangedPayload>(
            clientA,
            WebSocketResponseEvents.REPOSITORY_BRANCH_CHANGED,
            300,
          );

        const checkoutResponse = await emitAndWaitResponse<
          RepositoryCheckoutBranchPayload,
          RepositoryBranchCheckedOutPayload
        >(
          clientA,
          WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
          WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
          {
            requestId: uuidv4(),
            canvasId,
            repositoryId: repo.id,
            branchName: "broadcast-branch",
            force: false,
          },
          10000,
        );

        expect(checkoutResponse.success).toBe(true);
        expect(checkoutResponse.repositoryId).toBe(repo.id);
        expect(checkoutResponse.branchName).toBe("broadcast-branch");

        const broadcastPayload = await broadcastPromise;
        expect(broadcastPayload.repositoryId).toBe(repo.id);
        expect(broadcastPayload.branchName).toBe("broadcast-branch");
        expect(
          (broadcastPayload as Record<string, unknown>).requestId,
        ).toBeUndefined();

        const clientABroadcast = await clientABroadcastPromise;
        expect(clientABroadcast).toBeNull();
      } finally {
        if (clientA?.connected) await disconnectSocket(clientA);
        if (clientB?.connected) await disconnectSocket(clientB);
      }
    });
  });
});
