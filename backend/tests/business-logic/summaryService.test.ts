import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTestDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { runStore } from "../../src/services/runStore.js";
import { podStore } from "../../src/services/podStore.js";
import { summaryService } from "../../src/services/summaryService.js";
import {
  ensureGoalRuntime,
  removeGoalRuntimeRun,
} from "../../src/services/goalRuntime.js";
import { config } from "../../src/config/index.js";
import type { RunContext } from "../../src/types/run.js";
import path from "path";
import { runWorkflowSnapshotStore } from "../../src/services/workflow/runWorkflowSnapshotStore.js";

const executeDisposableChatMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/disposableChatService.js", () => ({
  executeDisposableChat: executeDisposableChatMock,
}));

const CANVAS_ID = "canvas-summary";
const SOURCE_POD_ID = "pod-source";
const TARGET_POD_ID = "pod-target";

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "summary-canvas", 0);
}

function makeRunContext(runId: string): RunContext {
  return {
    runId,
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
  };
}

describe("SummaryService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStatements();
    initTestDb();
    insertCanvas();
    executeDisposableChatMock.mockReset();
    vi.spyOn(podStore, "getById").mockImplementation(((_canvasId, podId) => ({
      id: podId,
      name: podId === SOURCE_POD_ID ? "Source Pod" : "Target Pod",
      provider: "claude",
      providerConfig: { model: "sonnet" },
      workspacePath: path.join(config.canvasRoot, CANVAS_ID, podId),
      repositoryId: null,
      sessionId: null,
      status: "idle",
      x: 0,
      y: 0,
      rotation: 0,
      multiInstance: false,
      skillIds: [],
    })) as typeof podStore.getById);
    vi.spyOn(runWorkflowSnapshotStore, "getPod").mockImplementation(
      (_runId, podId) => podStore.getById(CANVAS_ID, podId),
    );
  });

  it("應優先使用 persisted summary 與 recent transcript window 建構摘要 prompt", async () => {
    executeDisposableChatMock.mockResolvedValue({
      success: true,
      content: "整理後摘要",
      resolvedModel: "sonnet",
    });

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "trigger");
    const instance = runStore.createPodInstance(run.id, SOURCE_POD_ID);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "既有摘要");

    for (let i = 1; i <= 10; i++) {
      runStore.upsertRunMessage(run.id, SOURCE_POD_ID, {
        id: `00000000-0000-0000-0000-0000000000${i}`,
        role: i % 2 === 0 ? "assistant" : "user",
        content: `第${i}則`,
        timestamp: `2026-05-22T10:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }

    const result = await summaryService.generateSummaryForTarget(
      CANVAS_ID,
      SOURCE_POD_ID,
      TARGET_POD_ID,
      "claude",
      "sonnet",
      "high",
      makeRunContext(run.id),
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        summary: "整理後摘要",
      }),
    );

    const userPrompt = executeDisposableChatMock.mock.calls[0]?.[0]
      ?.userMessage as string;
    expect(userPrompt).toContain("既有摘要");
    expect(userPrompt).toContain("第10則");
    expect(userPrompt).not.toContain("第1則");
    expect(userPrompt).not.toContain("第2則");
    expect(executeDisposableChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePod: expect.objectContaining({ id: SOURCE_POD_ID }),
        runContext: makeRunContext(run.id),
        thinkingLevel: "high",
      }),
    );
  });

  it("AI 摘要失敗時應保留失敗語意，交由 workflow 層決定 fallback", async () => {
    executeDisposableChatMock.mockResolvedValue({
      success: false,
      error: "provider down",
    });

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "trigger");
    const instance = runStore.createPodInstance(run.id, SOURCE_POD_ID);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "既有摘要");

    const result = await summaryService.generateSummaryForTarget(
      CANVAS_ID,
      SOURCE_POD_ID,
      TARGET_POD_ID,
      "claude",
      "sonnet",
      null,
      makeRunContext(run.id),
    );

    expect(result).toEqual({
      targetPodId: TARGET_POD_ID,
      summary: "",
      success: false,
      error: "provider down",
    });
  });

  it("summaryThinkingLevel 為 null 時應以 provider/model 預設值執行", async () => {
    executeDisposableChatMock.mockResolvedValue({
      success: true,
      content: "整理後摘要",
      resolvedModel: "sonnet",
    });

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "trigger");
    const instance = runStore.createPodInstance(run.id, SOURCE_POD_ID);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "既有摘要");

    await summaryService.generateSummaryForTarget(
      CANVAS_ID,
      SOURCE_POD_ID,
      TARGET_POD_ID,
      "claude",
      "sonnet",
      null,
      makeRunContext(run.id),
    );

    expect(executeDisposableChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingLevel: "high",
      }),
    );
  });

  it("應優先使用 run 建立時凍結的 target goal，而不是執行中被修改的 live goal", async () => {
    executeDisposableChatMock.mockResolvedValue({
      success: true,
      content: "整理後摘要",
      resolvedModel: "sonnet",
    });

    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "trigger");
    const runContext = makeRunContext(run.id);
    const instance = runStore.createPodInstance(run.id, SOURCE_POD_ID);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "既有摘要");
    runStore.upsertRunMessage(run.id, SOURCE_POD_ID, {
      id: "00000000-0000-0000-0000-000000000001",
      role: "assistant",
      content: "最近訊息",
      timestamp: "2026-05-22T10:00:01.000Z",
    });

    const sourcePod = {
      id: SOURCE_POD_ID,
      name: "Source Pod",
      provider: "claude" as const,
      providerConfig: { model: "sonnet" },
      workspacePath: path.join(config.canvasRoot, CANVAS_ID, SOURCE_POD_ID),
      repositoryId: null,
      sessionId: null,
      status: "idle" as const,
      x: 0,
      y: 0,
      rotation: 0,
      multiInstance: false,
      skillIds: [],
      goal: null,
    };
    const frozenTargetPod = {
      id: TARGET_POD_ID,
      name: "Target Pod",
      provider: "claude" as const,
      providerConfig: { model: "sonnet" },
      workspacePath: path.join(config.canvasRoot, CANVAS_ID, TARGET_POD_ID),
      repositoryId: null,
      sessionId: null,
      status: "idle" as const,
      x: 0,
      y: 0,
      rotation: 0,
      multiInstance: false,
      skillIds: [],
      goal: {
        todos: [{ id: "todo-1", text: "原始凍結 Goal" }],
      },
    };
    const liveEditedTargetPod = {
      ...frozenTargetPod,
      goal: {
        todos: [{ id: "todo-2", text: "執行中被修改的 Goal" }],
      },
    };

    ensureGoalRuntime(frozenTargetPod, runContext);

    vi.spyOn(podStore, "getById").mockImplementation(((_canvasId, podId) => {
      if (podId === SOURCE_POD_ID) return sourcePod;
      if (podId === TARGET_POD_ID) return liveEditedTargetPod;
      return null;
    }) as typeof podStore.getById);

    await summaryService.generateSummaryForTarget(
      CANVAS_ID,
      SOURCE_POD_ID,
      TARGET_POD_ID,
      "claude",
      "sonnet",
      "high",
      runContext,
    );

    const userPrompt = executeDisposableChatMock.mock.calls.at(-1)?.[0]
      ?.userMessage as string;
    expect(userPrompt).toContain("原始凍結 Goal");
    expect(userPrompt).not.toContain("執行中被修改的 Goal");

    removeGoalRuntimeRun(runContext.runId);
  });
});
