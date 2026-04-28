import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pod } from "../../src/types/index.js";

// --- mock 函式 ---
const mockEmitError = vi.fn();
const mockEmitNotFound = vi.fn();
const mockEmitToConnection = vi.fn();
const mockEmitToCanvas = vi.fn();
const mockEmitToAll = vi.fn();

const mockValidatePod = vi.fn();
const mockAssertCapability = vi.fn();
const mockHandleResultError = vi.fn();
const mockHandleResourceDelete = vi.fn();
const mockEmitPodUpdated = vi.fn();

const mockRepositoryServiceExists = vi.fn();
const mockRepositoryServiceCreate = vi.fn();
const mockRepositoryServiceDelete = vi.fn();
const mockRepositoryServiceGetMetadata = vi.fn();
const mockRepositoryServiceGetRepositoryPath = vi.fn();

const mockPodStoreSetRepositoryId = vi.fn();
const mockPodStoreFindByRepositoryId = vi.fn();

const mockRepositorySyncServiceSync = vi.fn();
const mockPodManifestServiceDeleteManagedFiles = vi.fn();
const mockCommandServiceDeleteCommandFromPath = vi.fn();
const mockGitServiceRemoveWorktree = vi.fn();
const mockGitServiceDeleteBranch = vi.fn();
const mockRepositoryNoteStoreDeleteByForeignKey = vi.fn();

// --- vi.mock ---

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: (...args: unknown[]) => mockEmitError(...args),
  emitNotFound: (...args: unknown[]) => mockEmitNotFound(...args),
  emitSuccess: vi.fn(),
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: (...args: unknown[]) => mockEmitToConnection(...args),
    emitToCanvas: (...args: unknown[]) => mockEmitToCanvas(...args),
    emitToAll: (...args: unknown[]) => mockEmitToAll(...args),
  },
}));

vi.mock("../../src/utils/handlerHelpers.js", () => ({
  withCanvasId:
    (
      _event: unknown,
      handler: (
        connectionId: string,
        canvasId: string,
        payload: unknown,
        requestId: string,
      ) => Promise<void>,
    ) =>
    (connectionId: string, payload: unknown, requestId: string) =>
      handler(connectionId, "canvas-1", payload, requestId),
  validatePod: (...args: unknown[]) => mockValidatePod(...args),
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
  handleResultError: (...args: unknown[]) => mockHandleResultError(...args),
  handleResourceDelete: (...args: unknown[]) =>
    mockHandleResourceDelete(...args),
  emitPodUpdated: (...args: unknown[]) => mockEmitPodUpdated(...args),
  getPodDisplayName: vi.fn(() => "測試 Pod"),
}));

vi.mock("../../src/services/repositoryService.js", () => ({
  repositoryService: {
    exists: (...args: unknown[]) => mockRepositoryServiceExists(...args),
    create: (...args: unknown[]) => mockRepositoryServiceCreate(...args),
    delete: (...args: unknown[]) => mockRepositoryServiceDelete(...args),
    getMetadata: (...args: unknown[]) =>
      mockRepositoryServiceGetMetadata(...args),
    getRepositoryPath: (...args: unknown[]) =>
      mockRepositoryServiceGetRepositoryPath(...args),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    setRepositoryId: (...args: unknown[]) =>
      mockPodStoreSetRepositoryId(...args),
    findByRepositoryId: (...args: unknown[]) =>
      mockPodStoreFindByRepositoryId(...args),
  },
}));

vi.mock("../../src/services/repositorySyncService.js", () => ({
  repositorySyncService: {
    syncRepositoryResources: (...args: unknown[]) =>
      mockRepositorySyncServiceSync(...args),
  },
}));

vi.mock("../../src/services/podManifestService.js", () => ({
  podManifestService: {
    deleteManagedFiles: (...args: unknown[]) =>
      mockPodManifestServiceDeleteManagedFiles(...args),
  },
}));

vi.mock("../../src/services/commandService.js", () => ({
  commandService: {
    deleteCommandFromPath: (...args: unknown[]) =>
      mockCommandServiceDeleteCommandFromPath(...args),
  },
}));

vi.mock("../../src/services/workspace/gitService.js", () => ({
  gitService: {
    removeWorktree: (...args: unknown[]) =>
      mockGitServiceRemoveWorktree(...args),
    deleteBranch: (...args: unknown[]) => mockGitServiceDeleteBranch(...args),
  },
}));

vi.mock("../../src/services/noteStores.js", () => ({
  repositoryNoteStore: {
    deleteByForeignKey: (...args: unknown[]) =>
      mockRepositoryNoteStoreDeleteByForeignKey(...args),
  },
}));

vi.mock("../../src/utils/validators.js", () => ({
  validateRepositoryExists: vi.fn(),
}));

vi.mock("../../src/utils/i18nError.js", () => ({
  createI18nError: (key: string, params?: Record<string, unknown>) =>
    params ? { key, params } : { key },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    REPOSITORY_LIST_RESULT: "repository:list:result",
    REPOSITORY_CREATED: "repository:created",
    REPOSITORY_DELETED: "repository:deleted",
    POD_REPOSITORY_BOUND: "pod:repository:bound",
    POD_REPOSITORY_UNBOUND: "pod:repository:unbound",
    REPOSITORY_NOTE_CREATED: "repository:note:created",
    REPOSITORY_NOTE_LIST_RESULT: "repository:note:list:result",
    REPOSITORY_NOTE_UPDATED: "repository:note:updated",
    REPOSITORY_NOTE_DELETED: "repository:note:deleted",
  },
}));

vi.mock("../../src/handlers/factories/createNoteHandlers.js", () => ({
  createNoteHandlers: vi.fn(() => ({})),
}));

vi.mock("../../src/handlers/factories/createResourceHandlers.js", () => ({
  createListHandler: vi.fn(() => vi.fn()),
}));

// 動態 import（必須在所有 vi.mock 之後）
const {
  handleRepositoryCreate,
  handlePodBindRepository,
  handlePodUnbindRepository,
  handleRepositoryDelete,
} = await import("../../src/handlers/repositoryHandlers.js");

// 取得 validateRepositoryExists 的 mock 參考
const { validateRepositoryExists: mockValidateRepositoryExists } =
  await import("../../src/utils/validators.js");

const CONNECTION_ID = "conn-1";
const CANVAS_ID = "canvas-1";
const POD_ID = "pod-uuid-1";
const REPOSITORY_ID = "repo-uuid-1";
const REQUEST_ID = "req-1";

/** 建立基礎 Pod 物件 */
function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: POD_ID,
    name: "測試 Pod",
    status: "idle",
    x: 0,
    y: 0,
    rotation: 0,
    workspacePath: "/tmp/workspace",
    sessionId: null,
    repositoryId: null,
    commandId: null,
    multiInstance: false,
    skillIds: [],
    mcpServerNames: [],
    pluginIds: [],
    provider: "claude",
    providerConfig: { model: "sonnet" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 預設：assertCapability 通過
  mockAssertCapability.mockReturnValue(true);
  // 預設：handleResultError 回傳 false（無錯誤）
  mockHandleResultError.mockReturnValue(false);
  // 預設：validateRepositoryExists 回傳成功
  (mockValidateRepositoryExists as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    data: "/path/to/repo",
  });
  // 預設：repositoryService 操作成功
  mockRepositoryServiceExists.mockResolvedValue(true);
  mockRepositoryServiceCreate.mockResolvedValue({
    id: REPOSITORY_ID,
    name: "my-repo",
  });
  mockRepositoryServiceDelete.mockResolvedValue(undefined);
  mockRepositoryServiceGetMetadata.mockReturnValue(null);
  mockRepositoryServiceGetRepositoryPath.mockReturnValue("/path/to/repo");
  // 預設：sync 操作成功
  mockRepositorySyncServiceSync.mockResolvedValue(undefined);
  mockPodManifestServiceDeleteManagedFiles.mockResolvedValue(undefined);
  mockCommandServiceDeleteCommandFromPath.mockResolvedValue(undefined);
});

// ================================================================
// handleRepositoryCreate
// ================================================================
describe("handleRepositoryCreate", () => {
  describe("happy path：成功建立 repository", () => {
    it("名稱不重複時應呼叫 repositoryService.create 並透過 socketService.emitToConnection 廣播 REPOSITORY_CREATED", async () => {
      mockRepositoryServiceExists.mockResolvedValue(false);
      const mockRepo = { id: REPOSITORY_ID, name: "new-repo" };
      mockRepositoryServiceCreate.mockResolvedValue(mockRepo);

      await handleRepositoryCreate(
        CONNECTION_ID,
        { name: "new-repo" },
        REQUEST_ID,
      );

      expect(mockRepositoryServiceCreate).toHaveBeenCalledWith("new-repo");
      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "repository:created",
        expect.objectContaining({
          success: true,
          repository: mockRepo,
          requestId: REQUEST_ID,
        }),
      );
    });
  });

  describe("名稱重複 → 回傳 ALREADY_EXISTS error code", () => {
    it("repositoryService.exists 回傳 true 時應呼叫 emitError 帶 ALREADY_EXISTS，不呼叫 create", async () => {
      mockRepositoryServiceExists.mockResolvedValue(true);

      await handleRepositoryCreate(
        CONNECTION_ID,
        { name: "dup-repo" },
        REQUEST_ID,
      );

      expect(mockRepositoryServiceCreate).not.toHaveBeenCalled();
      expect(mockEmitError).toHaveBeenCalledWith(
        CONNECTION_ID,
        "repository:created",
        expect.objectContaining({ key: "errors.repoExists" }),
        null,
        REQUEST_ID,
        undefined,
        "ALREADY_EXISTS",
      );
    });
  });
});

// ================================================================
// handlePodBindRepository
// ================================================================
describe("handlePodBindRepository", () => {
  describe("happy path：成功綁定", () => {
    it("Pod 存在且有 repository capability、repository 存在時應呼叫 setRepositoryId 與 syncRepositoryResources，並 emitPodUpdated", async () => {
      const pod = makePod({ repositoryId: null });
      mockValidatePod.mockReturnValue(pod);

      await handlePodBindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID, repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        REPOSITORY_ID,
      );
      expect(mockRepositorySyncServiceSync).toHaveBeenCalledWith(REPOSITORY_ID);
      expect(mockEmitPodUpdated).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        REQUEST_ID,
        "pod:repository:bound",
      );
    });
  });

  describe("Pod 不存在 → 回傳 POD_NOT_FOUND", () => {
    it("validatePod 回傳 undefined 時應提前 return，不呼叫 setRepositoryId", async () => {
      mockValidatePod.mockReturnValue(undefined);

      await handlePodBindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID, repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).not.toHaveBeenCalled();
      expect(mockEmitPodUpdated).not.toHaveBeenCalled();
    });
  });

  describe("Pod 不具備 repository capability → 回傳 CAPABILITY_NOT_SUPPORTED", () => {
    it("assertCapability 回傳 false 時應提前 return，不呼叫 setRepositoryId", async () => {
      const pod = makePod();
      mockValidatePod.mockReturnValue(pod);
      mockAssertCapability.mockReturnValue(false);

      await handlePodBindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID, repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).not.toHaveBeenCalled();
      expect(mockEmitPodUpdated).not.toHaveBeenCalled();
    });
  });

  describe("Repository 不存在 → 回傳 NOT_FOUND", () => {
    it("validateRepositoryExists 失敗時應提前 return，不呼叫 setRepositoryId", async () => {
      const pod = makePod();
      mockValidatePod.mockReturnValue(pod);
      // handleResultError 回傳 true 表示有錯誤
      mockHandleResultError.mockReturnValue(true);

      await handlePodBindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID, repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).not.toHaveBeenCalled();
      expect(mockEmitPodUpdated).not.toHaveBeenCalled();
    });
  });

  describe("重複綁定相同 repositoryId → 早期 return（不重複同步）", () => {
    it("pod.repositoryId 與 repositoryId 相同時應直接 emitPodUpdated，不呼叫 setRepositoryId 或 syncRepositoryResources", async () => {
      const pod = makePod({ repositoryId: REPOSITORY_ID });
      mockValidatePod.mockReturnValue(pod);

      await handlePodBindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID, repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).not.toHaveBeenCalled();
      expect(mockRepositorySyncServiceSync).not.toHaveBeenCalled();
      expect(mockEmitPodUpdated).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        REQUEST_ID,
        "pod:repository:bound",
      );
    });
  });
});

// ================================================================
// handlePodUnbindRepository
// ================================================================
describe("handlePodUnbindRepository", () => {
  describe("happy path：成功解除綁定", () => {
    it("Pod 存在時應呼叫 setRepositoryId(null) 並 emitPodUpdated", async () => {
      const pod = makePod({ repositoryId: REPOSITORY_ID });
      mockValidatePod.mockReturnValue(pod);

      await handlePodUnbindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        null,
      );
      expect(mockEmitPodUpdated).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        REQUEST_ID,
        "pod:repository:unbound",
      );
    });

    it("原本有 repositoryId 時應呼叫 podManifestService.deleteManagedFiles 與 syncRepositoryResources", async () => {
      const pod = makePod({ repositoryId: REPOSITORY_ID });
      mockValidatePod.mockReturnValue(pod);

      await handlePodUnbindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID },
        REQUEST_ID,
      );

      expect(mockPodManifestServiceDeleteManagedFiles).toHaveBeenCalledWith(
        REPOSITORY_ID,
        POD_ID,
      );
      expect(mockRepositorySyncServiceSync).toHaveBeenCalledWith(REPOSITORY_ID);
    });
  });

  describe("Pod 不存在 → 回傳對應 error", () => {
    it("validatePod 回傳 undefined 時應提前 return，不呼叫 setRepositoryId", async () => {
      mockValidatePod.mockReturnValue(undefined);

      await handlePodUnbindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).not.toHaveBeenCalled();
      expect(mockEmitPodUpdated).not.toHaveBeenCalled();
    });
  });

  describe("已是 unbound 狀態（repositoryId 為 null）", () => {
    it("pod.repositoryId 為 null 時仍應呼叫 setRepositoryId(null) 與 emitPodUpdated，但不執行 cleanup", async () => {
      const pod = makePod({ repositoryId: null });
      mockValidatePod.mockReturnValue(pod);

      await handlePodUnbindRepository(
        CONNECTION_ID,
        { canvasId: CANVAS_ID, podId: POD_ID },
        REQUEST_ID,
      );

      expect(mockPodStoreSetRepositoryId).toHaveBeenCalledWith(
        CANVAS_ID,
        POD_ID,
        null,
      );
      // 因 oldRepositoryId 為 null，cleanup 不執行
      expect(mockPodManifestServiceDeleteManagedFiles).not.toHaveBeenCalled();
      expect(mockRepositorySyncServiceSync).not.toHaveBeenCalled();
      expect(mockEmitPodUpdated).toHaveBeenCalled();
    });
  });
});

// ================================================================
// handleRepositoryDelete
// ================================================================
describe("handleRepositoryDelete", () => {
  describe("happy path：成功刪除", () => {
    it("應呼叫 handleResourceDelete 並帶正確的 resourceId 與 responseEvent", async () => {
      mockRepositoryServiceGetMetadata.mockReturnValue(null);

      await handleRepositoryDelete(
        CONNECTION_ID,
        { repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      expect(mockHandleResourceDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: CONNECTION_ID,
          requestId: REQUEST_ID,
          resourceId: REPOSITORY_ID,
          responseEvent: "repository:deleted",
        }),
      );
    });
  });

  describe("worktree 型 repository：驗證會呼叫 cleanupWorktreeResources（gitService）", () => {
    it("metadata 含 parentRepoId 時，deleteResource 執行期間應呼叫 gitService.removeWorktree", async () => {
      const PARENT_REPO_ID = "parent-repo-uuid";
      const BRANCH_NAME = "feature-branch";

      // 設定 metadata 代表 worktree 型 repository
      mockRepositoryServiceGetMetadata.mockReturnValue({
        parentRepoId: PARENT_REPO_ID,
        branchName: BRANCH_NAME,
      });

      // 父 repo 存在
      mockRepositoryServiceExists.mockResolvedValue(true);
      mockRepositoryServiceGetRepositoryPath.mockReturnValue("/path/to/repo");
      mockGitServiceRemoveWorktree.mockResolvedValue({ success: true });
      mockGitServiceDeleteBranch.mockResolvedValue({ success: true });

      // 讓 handleResourceDelete 直接執行 deleteResource 回調
      mockHandleResourceDelete.mockImplementation(
        async (config: { deleteResource: () => Promise<void> }) => {
          await config.deleteResource();
        },
      );

      await handleRepositoryDelete(
        CONNECTION_ID,
        { repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      // 應呼叫 gitService.removeWorktree 清理 worktree
      expect(mockGitServiceRemoveWorktree).toHaveBeenCalled();
    });

    it("父 repository 不存在時跳過 worktree 清理", async () => {
      const PARENT_REPO_ID = "non-existent-parent";

      mockRepositoryServiceGetMetadata.mockReturnValue({
        parentRepoId: PARENT_REPO_ID,
        branchName: "feature",
      });

      // 父 repo 不存在
      mockRepositoryServiceExists.mockResolvedValue(false);

      mockHandleResourceDelete.mockImplementation(
        async (config: { deleteResource: () => Promise<void> }) => {
          await config.deleteResource();
        },
      );

      await handleRepositoryDelete(
        CONNECTION_ID,
        { repositoryId: REPOSITORY_ID },
        REQUEST_ID,
      );

      // 父 repo 不存在時不應呼叫 removeWorktree
      expect(mockGitServiceRemoveWorktree).not.toHaveBeenCalled();
    });
  });
});
