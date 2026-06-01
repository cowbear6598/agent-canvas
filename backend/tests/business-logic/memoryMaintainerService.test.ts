import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";

const executeStructuredDisposableTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/disposableChatService.js", () => ({
  executeStructuredDisposableTask: executeStructuredDisposableTaskMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { initTestDb, getDb, closeDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { config } from "../../src/config/index.js";
import { runStore } from "../../src/services/runStore.js";
import { podStore } from "../../src/services/podStore.js";
import { memoryStateService } from "../../src/services/memoryStateService.js";
import { memoryMaintainerService } from "../../src/services/memoryMaintainerService.js";
import type { RunContext } from "../../src/types/run.js";

const CANVAS_ID = "memory-canvas";

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "memory-canvas", 0);
}

function insertPod(params: { id: string; repositoryId?: string | null }): void {
  getDb()
    .prepare(
      `INSERT INTO pods (
        id, canvas_id, name, x, y, rotation, workspace_path, session_id,
        repository_id, schedule_json, provider, provider_config_json
      ) VALUES (?, ?, ?, 0, 0, 0, ?, NULL, ?, NULL, ?, ?)`,
    )
    .run(
      params.id,
      CANVAS_ID,
      `Pod ${params.id}`,
      path.join(config.canvasRoot, CANVAS_ID, params.id),
      params.repositoryId ?? null,
      "claude",
      JSON.stringify({ model: "sonnet" }),
    );
}

function makeRunContext(runId: string, sourcePodId: string): RunContext {
  return {
    runId,
    canvasId: CANVAS_ID,
    sourcePodId,
  };
}

function appendTranscript(params: {
  runId: string;
  podId: string;
  withRepoToolTrace?: boolean;
}): void {
  runStore.addRunMessage(params.runId, params.podId, "user", "請整理這次工作");
  runStore.addRunMessage(
    params.runId,
    params.podId,
    "assistant",
    "我已完成任務並更新了必要內容",
    params.withRepoToolTrace
      ? [
          {
            id: "sub-1",
            content: "讀取並更新 repo 檔案",
            toolUse: [
              {
                toolUseId: "tool-read-1",
                toolName: "Read",
                input: { filePath: "README.md" },
                output: "README content",
                status: "completed",
              },
            ],
          },
        ]
      : undefined,
  );
}

describe("memoryMaintainerService", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    podStore.__clearCacheForTesting();
    insertCanvas();
    vi.clearAllMocks();
  });

  it("有 repo 檔案讀寫證據時，應建立 pod 與 repo memory job 並寫入正式 summary", async () => {
    const podId = "pod-with-repo-memory";
    const repositoryId = "repo-memory";
    insertPod({ id: podId, repositoryId });
    memoryStateService.setPodMemoryEnabled(podId, true);
    memoryStateService.setRepoMemoryEnabled(repositoryId, true);

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(
      instance.id,
      "本輪完成 repository 清理與測試調整",
    );
    appendTranscript({
      runId: run.id,
      podId,
      withRepoToolTrace: true,
    });

    executeStructuredDisposableTaskMock.mockImplementation(async (input) => {
      const prompt = String(input.userMessage ?? "");
      const isPodScope = prompt.includes('"scopeType": "pod"');
      const isRepositoryScope = prompt.includes('"scopeType": "repository"');
      const isCandidate = String(input.systemPrompt ?? "").includes(
        "Memory Maintainer",
      );

      if (isCandidate && isPodScope) {
        return {
          success: true,
          data: {
            observations: [
              {
                title: "Pod 慣例",
                summary: "這顆 Pod 會先補測試再改功能",
                accepted: true,
                reason: "屬於穩定工作偏好",
              },
            ],
          },
          resolvedModel: "sonnet",
          rawContent: "{}",
        };
      }

      if (!isCandidate && isPodScope) {
        return {
          success: true,
          data: {
            summary: "Pod 記憶：先補測試，再調整功能。",
            reason: "已合併既有觀察",
          },
          resolvedModel: "sonnet",
          rawContent: "{}",
        };
      }

      if (isCandidate && isRepositoryScope) {
        return {
          success: true,
          data: {
            observations: [
              {
                title: "Repo 慣例",
                summary: "這個 repo 修改前要先讀 README",
                accepted: true,
                reason: "屬於可長期重用的 repository 背景",
              },
            ],
          },
          resolvedModel: "sonnet",
          rawContent: "{}",
        };
      }

      return {
        success: true,
        data: {
          summary: "Repo 記憶：修改前先讀 README，維持測試先行。",
          reason: "已合併 accepted observations",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      };
    });

    await memoryMaintainerService.scheduleForCompletedPod(
      makeRunContext(run.id, podId),
      podId,
    );

    expect(memoryStateService.getPodState(podId)?.summary).toBe(
      "Pod 記憶：先補測試，再調整功能。",
    );
    expect(memoryStateService.getRepoState(repositoryId)?.summary).toBe(
      "Repo 記憶：修改前先讀 README，維持測試先行。",
    );
    expect(memoryStateService.listJobsByScope("pod", podId)).toEqual([
      expect.objectContaining({
        status: "completed",
        attemptCount: 1,
      }),
    ]);
    expect(memoryStateService.listJobsByScope("repository", repositoryId)).toEqual([
      expect.objectContaining({
        status: "completed",
        attemptCount: 1,
      }),
    ]);
    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(4);
  });

  it("沒有 repo 檔案讀寫證據時，不應建立 repo memory job", async () => {
    const podId = "pod-without-repo-activity";
    const repositoryId = "repo-no-activity";
    insertPod({ id: podId, repositoryId });
    memoryStateService.setPodMemoryEnabled(podId, true);

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "只做了一般回覆");
    appendTranscript({
      runId: run.id,
      podId,
      withRepoToolTrace: false,
    });

    executeStructuredDisposableTaskMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          observations: [
            {
              title: "Pod 記憶",
              summary: "這顆 Pod 會回報完成狀態",
              accepted: true,
              reason: "屬於可重用的互動習慣",
            },
          ],
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary: "Pod 記憶：回覆時會明確交代完成狀態。",
          reason: "完成合併",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleForCompletedPod(
      makeRunContext(run.id, podId),
      podId,
    );

    expect(memoryStateService.listJobsByScope("pod", podId)).toHaveLength(1);
    expect(
      memoryStateService.listJobsByScope("repository", repositoryId),
    ).toHaveLength(0);
    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(2);
  });

  it("pod memory 停用但 repo memory 啟用時，仍應可維護 repo memory", async () => {
    const podId = "pod-repo-only-memory";
    const repositoryId = "repo-only-memory";
    insertPod({ id: podId, repositoryId });
    memoryStateService.setPodMemoryEnabled(podId, false);
    memoryStateService.setRepoMemoryEnabled(repositoryId, true);

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(
      instance.id,
      "本輪更新了 repository 內的設定檔",
    );
    appendTranscript({
      runId: run.id,
      podId,
      withRepoToolTrace: true,
    });

    executeStructuredDisposableTaskMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          observations: [
            {
              title: "Repo 記憶",
              summary: "這個 repo 更新設定檔前會先讀 README",
              accepted: true,
              reason: "屬於穩定的 repository 操作慣例",
            },
          ],
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary: "Repo 記憶：更新設定檔前先讀 README。",
          reason: "已完成合併",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleForCompletedPod(
      makeRunContext(run.id, podId),
      podId,
    );

    expect(memoryStateService.getPodState(podId)?.summary).toBeNull();
    expect(memoryStateService.getRepoState(repositoryId)).toMatchObject({
      memoryEnabled: true,
      summary: "Repo 記憶：更新設定檔前先讀 README。",
    });
    expect(memoryStateService.listJobsByScope("pod", podId)).toHaveLength(0);
    expect(memoryStateService.listJobsByScope("repository", repositoryId)).toEqual([
      expect.objectContaining({
        status: "completed",
        attemptCount: 1,
      }),
    ]);
    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(2);
  });

  it("連續失敗三次後應放棄本輪維護資料，但保留既有正式 summary", async () => {
    const podId = "pod-retry-failure";
    insertPod({ id: podId });
    memoryStateService.setPodMemoryEnabled(podId, true);
    memoryStateService.writePodSummary(podId, "既有正式記憶");

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "這輪 evidence 會失敗");
    appendTranscript({
      runId: run.id,
      podId,
      withRepoToolTrace: false,
    });

    executeStructuredDisposableTaskMock.mockResolvedValue({
      success: false,
      error: "模型暫時無法產生結構化結果",
      resolvedModel: "sonnet",
      rawContent: "",
    });

    await memoryMaintainerService.scheduleForCompletedPod(
      makeRunContext(run.id, podId),
      podId,
    );

    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(3);
    expect(memoryStateService.getPodState(podId)?.summary).toBe("既有正式記憶");
    expect(memoryStateService.listJobsByScope("pod", podId)).toHaveLength(0);
    expect(
      memoryStateService.listObservationsByScope("pod", podId),
    ).toHaveLength(0);
  });
});
