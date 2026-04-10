// 必須在 import 前 mock
vi.mock("../../src/services/workflow/runQueueService.js", () => ({
  runQueueService: {
    getQueueSize: vi.fn().mockReturnValue(0),
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    processNext: vi.fn().mockResolvedValue(undefined),
    init: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runStore } from "../../src/services/runStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { socketService } from "../../src/services/socketService.js";
import { gitService } from "../../src/services/workspace/gitService.js";
import { logger } from "../../src/utils/logger.js";
import type {
  WorkflowRun,
  RunPodInstance,
} from "../../src/services/runStore.js";

function createMockRun(overrides?: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "pod-source",
    triggerMessage: "測試訊息",
    status: "running",
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function createMockInstance(
  overrides?: Partial<RunPodInstance>,
): RunPodInstance {
  return {
    id: "instance-1",
    runId: "run-1",
    podId: "pod-source",
    status: "pending",
    claudeSessionId: null,
    errorMessage: null,
    triggeredAt: null,
    completedAt: null,
    autoPathwaySettled: "not-applicable",
    directPathwaySettled: "not-applicable",
    worktreePath: null,
    ...overrides,
  };
}

describe("RunExecutionService — Worktree 整合測試", () => {
  const canvasId = "canvas-1";
  const sourcePodId = "pod-source";

  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createRun — worktree 建立", () => {
    it("有 git repo 的 Pod 建立 worktree 並記錄 worktree_path", async () => {
      const mockRun = createMockRun();
      const worktreePath = "/test/repos/my-repo-run-run-1-pod-source";
      const instanceWithWorktree = createMockInstance({ worktreePath });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockReturnValue({
        id: sourcePodId,
        name: "Source Pod",
        repositoryId: "my-repo",
      } as any);
      vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
        success: true,
        data: true,
      });
      vi.spyOn(gitService, "hasCommits").mockResolvedValue({
        success: true,
        data: true,
      });
      // mock syncToRemoteLatest 避免實際執行 git fetch
      vi.spyOn(gitService, "syncToRemoteLatest").mockResolvedValue({
        success: true,
        data: undefined,
      });
      vi.spyOn(gitService, "createDetachedWorktree").mockResolvedValue({
        success: true,
        data: undefined,
      });
      vi.spyOn(runStore, "createPodInstance").mockReturnValue(
        instanceWithWorktree,
      );
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      await runExecutionService.createRun(canvasId, sourcePodId, "測試");

      expect(gitService.isGitRepository).toHaveBeenCalled();
      expect(gitService.hasCommits).toHaveBeenCalled();
      expect(gitService.createDetachedWorktree).toHaveBeenCalled();
      // 確認 createPodInstance 傳入非 null 的 worktreePath
      const createCall = vi.mocked(runStore.createPodInstance).mock.calls[0];
      expect(createCall?.[4]).not.toBeNull();
    });

    it("沒有 repositoryId 的 Pod 不建立 worktree，worktree_path 為 null", async () => {
      const mockRun = createMockRun();
      const instanceNoWorktree = createMockInstance({ worktreePath: null });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockReturnValue({
        id: sourcePodId,
        name: "Source Pod",
        repositoryId: null,
      } as any);
      const isGitSpy = vi.spyOn(gitService, "isGitRepository");
      const createWorktreeSpy = vi.spyOn(gitService, "createDetachedWorktree");
      vi.spyOn(runStore, "createPodInstance").mockReturnValue(
        instanceNoWorktree,
      );
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      await runExecutionService.createRun(canvasId, sourcePodId, "測試");

      expect(isGitSpy).not.toHaveBeenCalled();
      expect(createWorktreeSpy).not.toHaveBeenCalled();
      // 確認 createPodInstance 傳入 null worktreePath
      const createCall = vi.mocked(runStore.createPodInstance).mock.calls[0];
      expect(createCall?.[4]).toBeNull();
    });

    it("非 git 目錄的 repo 不建立 worktree，worktree_path 為 null", async () => {
      const mockRun = createMockRun();
      const instanceNoWorktree = createMockInstance({ worktreePath: null });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockReturnValue({
        id: sourcePodId,
        name: "Source Pod",
        repositoryId: "my-repo",
      } as any);
      vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
        success: true,
        data: false,
      });
      const createWorktreeSpy = vi.spyOn(gitService, "createDetachedWorktree");
      vi.spyOn(runStore, "createPodInstance").mockReturnValue(
        instanceNoWorktree,
      );
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      await runExecutionService.createRun(canvasId, sourcePodId, "測試");

      expect(createWorktreeSpy).not.toHaveBeenCalled();
      const createCall = vi.mocked(runStore.createPodInstance).mock.calls[0];
      expect(createCall?.[4]).toBeNull();
    });

    it("worktree 建立失敗時 fallback 到原始路徑（worktree_path 為 null，不阻斷 Run）", async () => {
      const mockRun = createMockRun();
      const instanceNoWorktree = createMockInstance({ worktreePath: null });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockReturnValue({
        id: sourcePodId,
        name: "Source Pod",
        repositoryId: "my-repo",
      } as any);
      vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
        success: true,
        data: true,
      });
      vi.spyOn(gitService, "hasCommits").mockResolvedValue({
        success: true,
        data: true,
      });
      // mock syncToRemoteLatest 避免實際執行 git fetch
      vi.spyOn(gitService, "syncToRemoteLatest").mockResolvedValue({
        success: true,
        data: undefined,
      });
      vi.spyOn(gitService, "createDetachedWorktree").mockResolvedValue({
        success: false,
        error: "git worktree add 失敗",
      });
      vi.spyOn(runStore, "createPodInstance").mockReturnValue(
        instanceNoWorktree,
      );
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      // 不應該 throw，Run 仍正常建立
      const context = await runExecutionService.createRun(
        canvasId,
        sourcePodId,
        "測試",
      );

      expect(context.runId).toBe(mockRun.id);
      // worktree 建立失敗時 fallback 為 null
      const createCall = vi.mocked(runStore.createPodInstance).mock.calls[0];
      expect(createCall?.[4]).toBeNull();
      // 應有 warn log
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("evaluateRunStatus — Run 完成時清理 worktree", () => {
    it("所有 Instance 完成後 evaluateRunStatus 觸發 cleanupRunWorktrees", async () => {
      const runId = "run-cleanup-1";
      const podId = "pod-cleanup";
      const worktreePath = "/test/repos/repo-run-run-cleanup-1-pod-cleanup";

      // 模擬所有 instance 均為 completed
      const completedInstance = createMockInstance({
        id: "i-1",
        runId,
        podId,
        status: "completed",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
        worktreePath,
      });

      vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([
        completedInstance,
      ]);
      vi.spyOn(connectionStore, "list").mockReturnValue([]);
      vi.spyOn(runStore, "updateRunStatus").mockImplementation(() => {});
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: runId, status: "completed" }),
      );
      vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([
        { podId, worktreePath },
      ]);
      vi.spyOn(podStore, "getByIdGlobal").mockReturnValue({
        canvasId,
        pod: { id: podId, repositoryId: "repo" } as any,
      });
      const removeWorktreeSpy = vi
        .spyOn(gitService, "removeWorktree")
        .mockResolvedValue({ success: true, data: undefined });

      // 觸發 evaluateRunStatus（透過 errorPodInstance 後的 evaluateRun flag）
      // 直接呼叫 updateAndEmitPodInstanceStatus 是 private，所以從 deletedRun 外圍測試
      // 改用直接驗證 cleanupRunWorktrees 被正確呼叫的方式：透過 deleteRun
      // 但我們要測試 evaluateRunStatus，所以用 settlePodTrigger 觸發
      const instance = createMockInstance({
        id: "i-1",
        runId,
        podId,
        status: "running",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      });

      vi.spyOn(runStore, "getPodInstance").mockReturnValue(instance);
      vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(
        () => {},
      );
      vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
      vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});

      const runContext = { runId, canvasId, sourcePodId: podId };
      runExecutionService.settlePodTrigger(runContext, podId, "auto");

      // 等待 cleanupRunWorktrees 的 async 操作完成
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(removeWorktreeSpy).toHaveBeenCalled();
    });
  });

  describe("deleteRun — 防禦性 worktree 清理", () => {
    it("deleteRun 也觸發 worktree 清理", async () => {
      const runId = "run-delete-1";
      const podId = "pod-delete";
      const worktreePath = "/test/repos/repo-run-run-delete-1-pod-delete";

      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: runId, canvasId }),
      );
      vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([
        { podId, worktreePath },
      ]);
      vi.spyOn(podStore, "getByIdGlobal").mockReturnValue({
        canvasId,
        pod: { id: podId, repositoryId: "repo" } as any,
      });
      const removeWorktreeSpy = vi
        .spyOn(gitService, "removeWorktree")
        .mockResolvedValue({ success: true, data: undefined });
      vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});

      await runExecutionService.deleteRun(runId);

      expect(removeWorktreeSpy).toHaveBeenCalledWith(
        expect.stringContaining("repo"),
        worktreePath,
      );
    });

    it("worktree 清理失敗時不阻斷 deleteRun 流程（冪等）", async () => {
      const runId = "run-delete-2";
      const podId = "pod-delete-2";
      const worktreePath = "/test/repos/repo-run-run-delete-2-pod-delete-2";

      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: runId, canvasId }),
      );
      vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([
        { podId, worktreePath },
      ]);
      vi.spyOn(podStore, "getByIdGlobal").mockReturnValue({
        canvasId,
        pod: { id: podId, repositoryId: "repo" } as any,
      });
      vi.spyOn(gitService, "removeWorktree").mockResolvedValue({
        success: false,
        error: "worktree 不存在",
      });
      const deleteRunSpy = vi
        .spyOn(runStore, "deleteRun")
        .mockImplementation(() => {});

      // 不應 throw，應繼續執行到 deleteRun
      await expect(
        runExecutionService.deleteRun(runId),
      ).resolves.toBeUndefined();
      expect(deleteRunSpy).toHaveBeenCalledWith(runId);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
