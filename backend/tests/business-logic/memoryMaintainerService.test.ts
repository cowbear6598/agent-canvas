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
import { configStore } from "../../src/services/configStore.js";
import { memoryStateService } from "../../src/services/memoryStateService.js";
import { memoryMaintainerService } from "../../src/services/memoryMaintainerService.js";
import { runRepoActivitySnapshotService } from "../../src/services/runRepoActivitySnapshotService.js";
import type { RunContext } from "../../src/types/run.js";
import { runWorkflowSnapshotStore } from "../../src/services/workflow/runWorkflowSnapshotStore.js";

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
  repoToolName?: string;
  repoToolInput?: Record<string, unknown>;
  repoToolOutput?: string;
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
                toolName: params.repoToolName ?? "Read",
                input: params.repoToolInput ?? { filePath: "README.md" },
                output: params.repoToolOutput ?? "README content",
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
    runRepoActivitySnapshotService.clearAll();
    podStore.__clearCacheForTesting();
    insertCanvas();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(runWorkflowSnapshotStore, "getPod").mockImplementation(
      (_runId, podId) => podStore.getById(CANVAS_ID, podId),
    );
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
    vi.spyOn(runRepoActivitySnapshotService, "consumeSnapshot").mockReturnValue({
      runId: run.id,
      podId,
      hasActivity: true,
      capturedAt: new Date().toISOString(),
      statusEntries: ["?? README.md"],
      snapshotPath: "/tmp/repo",
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
            summary:
              "<working-style>先補測試，再調整功能。</working-style>",
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
          summary:
            "<workflow>修改前先讀 README，維持測試先行。</workflow>",
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
    await memoryMaintainerService.scheduleRepositoriesForCompletedRun(
      makeRunContext(run.id, podId),
    );

    expect(memoryStateService.getPodState(podId)?.summary).toBe(
      "<working-style>\n先補測試，再調整功能。\n</working-style>",
    );
    expect(memoryStateService.getRepoState(repositoryId)?.summary).toBe(
      "<workflow>修改前先讀 README，維持測試先行。</workflow>",
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

    const podMergerCall = executeStructuredDisposableTaskMock.mock.calls.find(
      ([input]) =>
        String(input.logLabel ?? "").includes("Pod Memory") &&
        String(input.logLabel ?? "").includes("正式記憶合併"),
    )?.[0];
    const repoMergerCall = executeStructuredDisposableTaskMock.mock.calls.find(
      ([input]) =>
        String(input.logLabel ?? "").includes("Repo Memory") &&
        String(input.logLabel ?? "").includes("正式記憶合併"),
    )?.[0];

    expect(String(podMergerCall?.systemPrompt ?? "")).toContain(
      "summary 必須使用 XML 區塊格式",
    );
    expect(String(podMergerCall?.systemPrompt ?? "")).toContain(
      "不要寫 repository 共用背景",
    );
    expect(String(repoMergerCall?.systemPrompt ?? "")).toContain(
      "tag 名稱不要限定在固定清單內",
    );
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
    vi.spyOn(runRepoActivitySnapshotService, "consumeSnapshot").mockReturnValue({
      runId: run.id,
      podId,
      hasActivity: false,
      capturedAt: new Date().toISOString(),
      statusEntries: [],
      snapshotPath: "/tmp/repo",
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
          summary:
            "<handoff>回覆時會明確交代完成狀態。</handoff>",
          reason: "完成合併",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleForCompletedPod(
      makeRunContext(run.id, podId),
      podId,
    );
    await memoryMaintainerService.scheduleRepositoriesForCompletedRun(
      makeRunContext(run.id, podId),
    );

    expect(memoryStateService.listJobsByScope("pod", podId)).toHaveLength(1);
    expect(
      memoryStateService.listJobsByScope("repository", repositoryId),
    ).toHaveLength(0);
    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(2);
  });

  it("Memory 維護執行時應使用全域 Memory thinking level", async () => {
    const podId = "pod-memory-thinking-level";
    insertPod({ id: podId });
    memoryStateService.setPodMemoryEnabled(podId, true);
    configStore.update({
      memoryProvider: "claude",
      memoryModel: "sonnet",
      memoryThinkingLevel: "high",
    });

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(
      instance.id,
      "本輪完成 Memory thinking level 接線",
    );
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
              title: "Thinking 設定",
              summary: "Memory 任務會使用全域 thinking level",
              accepted: true,
              reason: "屬於模型執行設定",
            },
          ],
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary:
            "<workflow>Memory 任務使用全域 thinking level。</workflow>",
          reason: "已完成合併",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleForCompletedPod(
      makeRunContext(run.id, podId),
      podId,
    );

    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(2);
    expect(executeStructuredDisposableTaskMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ thinkingLevel: "high" }),
    );
    expect(executeStructuredDisposableTaskMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ thinkingLevel: "high" }),
    );
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
    vi.spyOn(runRepoActivitySnapshotService, "consumeSnapshot").mockReturnValue({
      runId: run.id,
      podId,
      hasActivity: true,
      capturedAt: new Date().toISOString(),
      statusEntries: [" M config.json"],
      snapshotPath: "/tmp/repo",
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
          summary:
            "<workflow>更新設定檔前先讀 README。</workflow>",
          reason: "已完成合併",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleRepositoriesForCompletedRun(
      makeRunContext(run.id, podId),
    );

    expect(memoryStateService.getPodState(podId)?.summary).toBeNull();
    expect(memoryStateService.getRepoState(repositoryId)).toMatchObject({
      memoryEnabled: true,
      summary: "<workflow>更新設定檔前先讀 README。</workflow>",
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

  it("cleanup 前已捕捉的 repo activity 快照，應優先用於 repo memory 判定", async () => {
    const podId = "pod-repo-snapshot-activity";
    const repositoryId = "repo-snapshot-activity";
    insertPod({ id: podId, repositoryId });
    memoryStateService.setPodMemoryEnabled(podId, false);
    memoryStateService.setRepoMemoryEnabled(repositoryId, true);

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(
      instance.id,
      "本輪新增 qqq.md，並補上 repo 的測試用途說明",
    );
    appendTranscript({
      runId: run.id,
      podId,
      withRepoToolTrace: false,
    });

    const consumeSnapshotSpy = vi
      .spyOn(runRepoActivitySnapshotService, "consumeSnapshot")
      .mockReturnValue({
        runId: run.id,
        podId,
        hasActivity: true,
        capturedAt: new Date().toISOString(),
        statusEntries: ["?? qqq.md"],
        snapshotPath: "/tmp/repo",
      });
    executeStructuredDisposableTaskMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          observations: [
            {
              title: "Repo 記憶",
              summary: "這個 repo 可自由用於測試實驗",
              accepted: true,
              reason: "屬於可長期重用的 repository 背景",
            },
          ],
        },
        resolvedModel: "gpt-5.5",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary:
            "<purpose>這個 repo 可自由用於測試與快速實驗。</purpose>",
          reason: "已完成合併",
        },
        resolvedModel: "gpt-5.5",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleRepositoriesForCompletedRun(
      makeRunContext(run.id, podId),
    );

    expect(memoryStateService.getRepoState(repositoryId)).toMatchObject({
      memoryEnabled: true,
      summary: "<purpose>這個 repo 可自由用於測試與快速實驗。</purpose>",
    });
    expect(memoryStateService.listJobsByScope("repository", repositoryId)).toEqual([
      expect.objectContaining({
        status: "completed",
        attemptCount: 1,
      }),
    ]);
    expect(consumeSnapshotSpy).toHaveBeenCalledWith(run.id, podId);
    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(2);
  });

  it("repo memory 應聚合同一 run 中同 repo 的多顆 pod 證據", async () => {
    const repositoryId = "repo-shared";
    const podA = "pod-repo-a";
    const podB = "pod-repo-b";
    insertPod({ id: podA, repositoryId });
    insertPod({ id: podB, repositoryId });
    memoryStateService.setPodMemoryEnabled(podA, false);
    memoryStateService.setPodMemoryEnabled(podB, false);
    memoryStateService.setRepoMemoryEnabled(repositoryId, true);

    const run = runStore.createRun(CANVAS_ID, podA, "trigger");
    const instanceA = runStore.createPodInstance(run.id, podA, "pending", "not-applicable", {
      runRepoPath: "/tmp/run-repo-shared",
      workspacePath: "/tmp/run-repo-shared",
    });
    const instanceB = runStore.createPodInstance(run.id, podB, "pending", "not-applicable", {
      runRepoPath: "/tmp/run-repo-shared",
      workspacePath: "/tmp/run-repo-shared",
    });
    runStore.updatePodInstanceLastResponseSummary(
      instanceA.id,
      "Pod A 新增 qqq.md",
    );
    runStore.updatePodInstanceLastResponseSummary(
      instanceB.id,
      "Pod B 補上 repo 用途說明",
    );
    appendTranscript({
      runId: run.id,
      podId: podA,
      withRepoToolTrace: false,
    });
    appendTranscript({
      runId: run.id,
      podId: podB,
      withRepoToolTrace: false,
    });

    vi.spyOn(runRepoActivitySnapshotService, "consumeSnapshot").mockReturnValue({
      runId: run.id,
      podId: podA,
      hasActivity: true,
      capturedAt: new Date().toISOString(),
      statusEntries: ["?? qqq.md", " M README.md"],
      snapshotPath: "/tmp/run-repo-shared",
    });

    executeStructuredDisposableTaskMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          observations: [
            {
              title: "Repo 用途",
              summary: "這個 repo 用於測試與快速實驗",
              accepted: true,
              reason: "屬於 repo 共用背景",
            },
          ],
        },
        resolvedModel: "gpt-5.5",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary: "<purpose>這個 repo 用於測試與快速實驗。</purpose>",
          reason: "已合併 accepted observations",
        },
        resolvedModel: "gpt-5.5",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleRepositoriesForCompletedRun(
      makeRunContext(run.id, podA),
    );

    const repoCall = executeStructuredDisposableTaskMock.mock.calls[0]?.[0];
    expect(String(repoCall?.userMessage ?? "")).toContain(`[Pod ${podA}] Pod A 新增 qqq.md`);
    expect(String(repoCall?.userMessage ?? "")).toContain(`[Pod ${podB}] Pod B 補上 repo 用途說明`);
    expect(memoryStateService.getRepoState(repositoryId)?.summary).toBe(
      "<purpose>這個 repo 用於測試與快速實驗。</purpose>",
    );
  });

  it("正式記憶若不是合法 XML 區塊格式，應回饋錯誤給模型後重修", async () => {
    const podId = "pod-memory-xml-revision";
    insertPod({ id: podId });
    memoryStateService.setPodMemoryEnabled(podId, true);

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(
      instance.id,
      "這顆 Pod 交接時要明確列出完成狀態",
    );
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
              title: "Pod 交接",
              summary: "交接時要明確列出完成狀態",
              accepted: true,
              reason: "屬於穩定的交接習慣",
            },
          ],
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary: "交接時要明確列出完成狀態",
          reason: "先整理成一句話",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary: "<handoff>交接時要明確列出完成狀態。</handoff>",
          reason: "已依驗證回饋改成 XML 區塊",
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      });

    await memoryMaintainerService.scheduleForCompletedPod(
      makeRunContext(run.id, podId),
      podId,
    );

    expect(memoryStateService.getPodState(podId)?.summary).toBe(
      "<handoff>\n交接時要明確列出完成狀態。\n</handoff>",
    );
    expect(executeStructuredDisposableTaskMock).toHaveBeenCalledTimes(3);

    const correctionCall = executeStructuredDisposableTaskMock.mock.calls[2]?.[0];
    expect(String(correctionCall?.userMessage ?? "")).toContain(
      "你上一版的 summary 格式未通過驗證",
    );
    expect(String(correctionCall?.userMessage ?? "")).toContain(
      "summary 必須完全由一個以上的 XML 區塊組成",
    );
  });

  it("產品共用基線行為不應寫入 Pod Memory", async () => {
    const podId = "pod-generic-memory";
    insertPod({ id: podId });
    memoryStateService.setPodMemoryEnabled(podId, true);

    const run = runStore.createRun(CANVAS_ID, podId, "trigger");
    const instance = runStore.createPodInstance(run.id, podId);
    runStore.updatePodInstanceLastResponseSummary(
      instance.id,
      "開始前先看 active todo，改完再檢查檔案與 git 狀態",
    );
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
              title: "通用流程",
              summary:
                "開始動作前先檢查 Goal Runtime 的 active todo；修改後會檢查檔案內容與 git 狀態",
              accepted: true,
              reason: "這顆 Pod 常這樣做",
            },
          ],
        },
        resolvedModel: "sonnet",
        rawContent: "{}",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          summary:
            "<workflow>開始動作前先檢查 Goal Runtime 的 active todo；修改後會檢查檔案內容與 git 狀態</workflow>",
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
    const observations = memoryStateService.listObservationsByScope("pod", podId);
    const candidateObservation = observations.find(
      (observation) => observation.kind === "candidate",
    );
    expect(candidateObservation).toMatchObject({
      status: "rejected",
    });
    expect(String(candidateObservation?.payload.reason ?? "")).toContain(
      "產品共用基線行為",
    );
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
