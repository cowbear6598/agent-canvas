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

vi.mock("../../src/config/index.js", () => ({
  config: {
    repositoriesRoot: "/test/repos",
    gitlabUrl: undefined,
    githubToken: undefined,
    gitlabToken: undefined,
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
    sourcePodId: "pod-a",
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
    podId: "pod-a",
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

describe("Run Worktree 共用邏輯", () => {
  const canvasId = "canvas-1";

  beforeEach(() => {
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("同 repo 多 Pod 共用 worktree", () => {
    it("同一 Run 內綁定相同 repositoryId 的兩個 Pod 應共用同一個 worktree，且 createDetachedWorktree 只被呼叫一次", async () => {
      const runId = "run-shared";
      const podAId = "pod-a";
      const podBId = "pod-b";
      const sharedRepoId = "same-repo";
      const mockRun = createMockRun({ id: runId, sourcePodId: podAId });
      const expectedWorktreePath = `/test/repos/${sharedRepoId}-run-${runId}`;

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      // pod-a → pod-b 的連結，使兩個 pod 都被加入 chainPodIds
      vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
        (_, podId) => {
          if (podId === podAId) {
            return [
              {
                id: "conn-1",
                canvasId,
                sourcePodId: podAId,
                targetPodId: podBId,
                triggerMode: "auto",
              } as any,
            ];
          }
          return [];
        },
      );
      // 兩個 Pod 綁定相同 repositoryId
      vi.spyOn(podStore, "getById").mockImplementation(
        (_, podId) =>
          ({
            id: podId,
            name: podId,
            repositoryId: sharedRepoId,
          }) as any,
      );
      vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
        success: true,
        data: true,
      });
      vi.spyOn(gitService, "hasCommits").mockResolvedValue({
        success: true,
        data: true,
      });
      const createDetachedWorktreeSpy = vi
        .spyOn(gitService, "createDetachedWorktree")
        .mockResolvedValue({ success: true, data: undefined });

      const instanceA = createMockInstance({
        id: "i-a",
        runId,
        podId: podAId,
        worktreePath: expectedWorktreePath,
      });
      const instanceB = createMockInstance({
        id: "i-b",
        runId,
        podId: podBId,
        worktreePath: expectedWorktreePath,
      });
      const instanceCreateSpy = vi
        .spyOn(runStore, "createPodInstance")
        .mockReturnValueOnce(instanceA)
        .mockReturnValueOnce(instanceB);
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);
      // 補齊 connectionStore.findByTargetPodId（calculatePathways 需要）
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);

      await runExecutionService.createRun(canvasId, podAId, "測試");

      // createDetachedWorktree 應只被呼叫一次（同 repo 共用）
      expect(createDetachedWorktreeSpy).toHaveBeenCalledTimes(1);

      // 兩次 createPodInstance 傳入的 worktreePath 應相同
      const callA = instanceCreateSpy.mock.calls[0];
      const callB = instanceCreateSpy.mock.calls[1];
      expect(callA?.[4]).toBe(expectedWorktreePath);
      expect(callB?.[4]).toBe(expectedWorktreePath);
    });
  });

  describe("不同 repo 各建各的", () => {
    it("同一 Run 內綁定不同 repositoryId 的兩個 Pod 應各自建立 worktree，路徑不同", async () => {
      const runId = "run-diff-repo";
      const podAId = "pod-a";
      const podBId = "pod-b";
      const repoA = "repo-alpha";
      const repoB = "repo-beta";
      const mockRun = createMockRun({ id: runId, sourcePodId: podAId });
      const worktreePathA = `/test/repos/${repoA}-run-${runId}`;
      const worktreePathB = `/test/repos/${repoB}-run-${runId}`;

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
        (_, podId) => {
          if (podId === podAId) {
            return [
              {
                id: "conn-1",
                canvasId,
                sourcePodId: podAId,
                targetPodId: podBId,
                triggerMode: "auto",
              } as any,
            ];
          }
          return [];
        },
      );
      // 兩個 Pod 綁定不同 repositoryId
      vi.spyOn(podStore, "getById").mockImplementation(
        (_, podId) =>
          ({
            id: podId,
            name: podId,
            repositoryId: podId === podAId ? repoA : repoB,
          }) as any,
      );
      vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
        success: true,
        data: true,
      });
      vi.spyOn(gitService, "hasCommits").mockResolvedValue({
        success: true,
        data: true,
      });
      const createDetachedWorktreeSpy = vi
        .spyOn(gitService, "createDetachedWorktree")
        .mockResolvedValue({ success: true, data: undefined });

      const instanceA = createMockInstance({
        id: "i-a",
        runId,
        podId: podAId,
        worktreePath: worktreePathA,
      });
      const instanceB = createMockInstance({
        id: "i-b",
        runId,
        podId: podBId,
        worktreePath: worktreePathB,
      });
      const instanceCreateSpy = vi
        .spyOn(runStore, "createPodInstance")
        .mockReturnValueOnce(instanceA)
        .mockReturnValueOnce(instanceB);
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);

      await runExecutionService.createRun(canvasId, podAId, "測試");

      // 不同 repo 各自建立，應呼叫兩次
      expect(createDetachedWorktreeSpy).toHaveBeenCalledTimes(2);

      // 兩次 createPodInstance 傳入的 worktreePath 應不同
      const callA = instanceCreateSpy.mock.calls[0];
      const callB = instanceCreateSpy.mock.calls[1];
      expect(callA?.[4]).not.toBeNull();
      expect(callB?.[4]).not.toBeNull();
      expect(callA?.[4]).not.toBe(callB?.[4]);
    });
  });

  describe("無 repo Pod 不受影響", () => {
    it("沒有 repositoryId 的 Pod 直接回傳 null，不呼叫任何 git 操作", async () => {
      const runId = "run-no-repo";
      const podAId = "pod-a";
      const mockRun = createMockRun({ id: runId, sourcePodId: podAId });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      // Pod 沒有 repositoryId
      vi.spyOn(podStore, "getById").mockReturnValue({
        id: podAId,
        name: "Pod A",
        repositoryId: null,
      } as any);
      const isGitSpy = vi.spyOn(gitService, "isGitRepository");
      const hasCommitsSpy = vi.spyOn(gitService, "hasCommits");
      const createWorktreeSpy = vi.spyOn(gitService, "createDetachedWorktree");

      const instanceA = createMockInstance({
        id: "i-a",
        runId,
        podId: podAId,
        worktreePath: null,
      });
      const instanceCreateSpy = vi
        .spyOn(runStore, "createPodInstance")
        .mockReturnValue(instanceA);
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);

      await runExecutionService.createRun(canvasId, podAId, "測試");

      // 無 repositoryId 時不應呼叫任何 git 操作
      expect(isGitSpy).not.toHaveBeenCalled();
      expect(hasCommitsSpy).not.toHaveBeenCalled();
      expect(createWorktreeSpy).not.toHaveBeenCalled();

      // createPodInstance 傳入的 worktreePath 應為 null
      const callA = instanceCreateSpy.mock.calls[0];
      expect(callA?.[4]).toBeNull();
    });
  });

  describe("清理去重", () => {
    it("三筆 entry 但 worktreePath 相同時，removeWorktree 應只被呼叫一次", async () => {
      const runId = "run-dedup";
      const sharedWorktreePath = "/test/repos/shared-repo-run-run-dedup";

      // getWorktreePathsByRunId 回傳三筆，但 worktreePath 相同
      vi.spyOn(runStore, "getWorktreePathsByRunId").mockReturnValue([
        { podId: "pod-a", worktreePath: sharedWorktreePath },
        { podId: "pod-b", worktreePath: sharedWorktreePath },
        { podId: "pod-c", worktreePath: sharedWorktreePath },
      ]);
      vi.spyOn(podStore, "getByIdGlobal").mockImplementation((podId) => ({
        canvasId,
        pod: { id: podId, repositoryId: "shared-repo" } as any,
      }));
      const removeWorktreeSpy = vi
        .spyOn(gitService, "removeWorktree")
        .mockResolvedValue({ success: true, data: undefined });
      vi.spyOn(runStore, "getRun").mockReturnValue(
        createMockRun({ id: runId, canvasId }),
      );
      vi.spyOn(runStore, "deleteRun").mockImplementation(() => {});

      await runExecutionService.deleteRun(runId);

      // 去重後只應呼叫一次 removeWorktree
      expect(removeWorktreeSpy).toHaveBeenCalledTimes(1);
      expect(removeWorktreeSpy).toHaveBeenCalledWith(
        expect.stringContaining("shared-repo"),
        sharedWorktreePath,
      );
    });
  });

  describe("建立失敗 fallback", () => {
    it("createDetachedWorktree 失敗時應回傳 null，且快取記錄 null，後續同 repo Pod 也拿到 null 不重試", async () => {
      const runId = "run-fail";
      const podAId = "pod-a";
      const podBId = "pod-b";
      const sharedRepoId = "fail-repo";
      const mockRun = createMockRun({ id: runId, sourcePodId: podAId });

      vi.spyOn(runStore, "createRun").mockReturnValue(mockRun);
      // pod-a → pod-b 的連結
      vi.spyOn(connectionStore, "findBySourcePodId").mockImplementation(
        (_, podId) => {
          if (podId === podAId) {
            return [
              {
                id: "conn-1",
                canvasId,
                sourcePodId: podAId,
                targetPodId: podBId,
                triggerMode: "auto",
              } as any,
            ];
          }
          return [];
        },
      );
      // 兩個 Pod 綁定相同 repositoryId
      vi.spyOn(podStore, "getById").mockImplementation(
        (_, podId) =>
          ({
            id: podId,
            name: podId,
            repositoryId: sharedRepoId,
          }) as any,
      );
      vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
        success: true,
        data: true,
      });
      vi.spyOn(gitService, "hasCommits").mockResolvedValue({
        success: true,
        data: true,
      });
      // createDetachedWorktree 回傳失敗
      const createDetachedWorktreeSpy = vi
        .spyOn(gitService, "createDetachedWorktree")
        .mockResolvedValue({ success: false, error: "git worktree add 失敗" });

      const instanceA = createMockInstance({
        id: "i-a",
        runId,
        podId: podAId,
        worktreePath: null,
      });
      const instanceB = createMockInstance({
        id: "i-b",
        runId,
        podId: podBId,
        worktreePath: null,
      });
      const instanceCreateSpy = vi
        .spyOn(runStore, "createPodInstance")
        .mockReturnValueOnce(instanceA)
        .mockReturnValueOnce(instanceB);
      vi.spyOn(runStore, "countRunsByCanvasId").mockReturnValue(1);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);

      // 不應 throw，Run 仍正常建立
      const context = await runExecutionService.createRun(
        canvasId,
        podAId,
        "測試",
      );
      expect(context.runId).toBe(runId);

      // createDetachedWorktree 只應被呼叫一次（第一個 Pod 失敗後快取 null，第二個 Pod 直接取快取不重試）
      expect(createDetachedWorktreeSpy).toHaveBeenCalledTimes(1);

      // 兩次 createPodInstance 傳入的 worktreePath 均應為 null
      const callA = instanceCreateSpy.mock.calls[0];
      const callB = instanceCreateSpy.mock.calls[1];
      expect(callA?.[4]).toBeNull();
      expect(callB?.[4]).toBeNull();

      // 應有 warn log 記錄建立失敗
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
