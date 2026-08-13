import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTestDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { runStore } from "../../src/services/runStore.js";
import { podStore } from "../../src/services/podStore.js";
import { configStore } from "../../src/services/configStore.js";
import { branchDecider } from "../../src/services/branch/index.js";
import { branchDecisionService } from "../../src/services/workflow/branchDecisionService.js";
import { config } from "../../src/config/index.js";
import type { Connection } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";
import path from "path";
import { runWorkflowSnapshotStore } from "../../src/services/workflow/runWorkflowSnapshotStore.js";

const CANVAS_ID = "canvas-branch";
const SOURCE_POD_ID = "pod-source";

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "branch-canvas", 0);
}

function makeRunContext(runId: string): RunContext {
  return {
    runId,
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
  };
}

function makeConnection(
  id: string,
  label: string,
  targetPodId: string,
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id,
    canvasId: CANVAS_ID,
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId,
    targetAnchor: "left",
    triggerMode: "branch",
    summaryModel: "sonnet",
    summaryProvider: "claude",
    summaryThinkingLevel: null,
    label,
    description: `${label} description`,
    branchProvider: "claude",
    branchModel: "sonnet",
    branchThinkingLevel: "high",
    ...overrides,
  };
}

describe("BranchDecisionService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStatements();
    initTestDb();
    insertCanvas();
    vi.spyOn(branchDecider, "decide").mockResolvedValue({
      kind: "success",
      selectedLabel: "Alpha",
    });
    vi.spyOn(configStore, "getConnectionLineModelConfig").mockReturnValue({
      connectionLineProvider: "claude",
      connectionLineModel: "sonnet",
      connectionLineThinkingLevel: "high",
    });
    vi.spyOn(podStore, "getById").mockImplementation(((_canvasId, podId) => ({
      id: podId,
      name: podId === SOURCE_POD_ID ? "Source Pod" : `Pod ${podId}`,
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
    vi.spyOn(runWorkflowSnapshotStore, "getRequired").mockReturnValue({
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      connectionLineConfig: {
        connectionLineProvider: "claude",
        connectionLineModel: "sonnet",
        connectionLineThinkingLevel: "high",
      },
      pods: new Map(),
      connections: new Map(),
    });
  });

  it("應透過 bounded transcript helper 傳入 recentMessages 與 persisted summary", async () => {
    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "trigger");
    const instance = runStore.createPodInstance(run.id, SOURCE_POD_ID);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "既有摘要");

    for (let i = 1; i <= 6; i++) {
      runStore.upsertRunMessage(run.id, SOURCE_POD_ID, {
        id: `00000000-0000-0000-0000-00000000010${i}`,
        role: i % 2 === 0 ? "assistant" : "user",
        content: `第${i}則`,
        timestamp: `2026-05-22T11:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }

    const result = await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [
        makeConnection("conn-1", "Alpha", "pod-a"),
        makeConnection("conn-2", "Beta", "pod-b"),
      ],
      makeRunContext(run.id),
    );

    expect(result).toEqual({
      outcome: "selected",
      selectedConnectionId: "conn-1",
      rejectedConnectionIds: ["conn-2"],
    });
    expect(branchDecider.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        persistedSummary: "既有摘要",
        provider: "claude",
        model: "sonnet",
        thinkingLevel: "high",
        recentMessages: expect.arrayContaining([
          expect.objectContaining({ content: "第6則" }),
        ]),
      }),
    );

    const recentMessages = vi.mocked(branchDecider.decide).mock.calls[0]?.[0]
      ?.recentMessages;
    expect(recentMessages).toHaveLength(4);
    expect(recentMessages?.map((message) => message.content)).toEqual([
      "第3則",
      "第4則",
      "第5則",
      "第6則",
    ]);
  });

  it("branchDecider 回傳結構化失敗時，應保留 failed outcome 供 workflow 辨識", async () => {
    vi.spyOn(branchDecider, "decide").mockResolvedValueOnce({
      kind: "failed",
      failure: {
        kind: "provider_error",
        message: "模型連線失敗",
        attempts: [
          { attempt: 1, kind: "provider_error", message: "模型連線失敗" },
        ],
      },
    });

    const result = await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [
        makeConnection("conn-1", "Alpha", "pod-a"),
        makeConnection("conn-2", "Beta", "pod-b"),
      ],
      makeRunContext("run-2"),
    );

    expect(result).toEqual({
      outcome: "failed",
      selectedConnectionId: null,
      rejectedConnectionIds: ["conn-1", "conn-2"],
      failure: {
        kind: "provider_error",
        message: "模型連線失敗",
        attempts: [
          { attempt: 1, kind: "provider_error", message: "模型連線失敗" },
        ],
      },
    });
  });

  it("branchThinkingLevel 為 null 時仍以 Connection Line 統一設定決策", async () => {
    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "trigger");
    const instance = runStore.createPodInstance(run.id, SOURCE_POD_ID);
    runStore.updatePodInstanceLastResponseSummary(instance.id, "既有摘要");
    vi.mocked(runWorkflowSnapshotStore.getRequired).mockReturnValue({
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      connectionLineConfig: {
        connectionLineProvider: "codex",
        connectionLineModel: "gpt-5.5",
        connectionLineThinkingLevel: "medium",
      },
      pods: new Map(),
      connections: new Map(),
    });

    await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [
        makeConnection("conn-1", "Alpha", "pod-a", {
          branchThinkingLevel: null,
        }),
      ],
      makeRunContext(run.id),
    );

    expect(branchDecider.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.5",
        thinkingLevel: "medium",
      }),
    );
  });

  it("branch 決策忽略 connection branch 欄位並使用 Connection Line 統一設定", async () => {
    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "trigger");
    vi.mocked(runWorkflowSnapshotStore.getRequired).mockReturnValue({
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
      connectionLineConfig: {
        connectionLineProvider: "claude",
        connectionLineModel: "sonnet",
        connectionLineThinkingLevel: "low",
      },
      pods: new Map(),
      connections: new Map(),
    });

    await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [
        makeConnection("conn-1", "Alpha", "pod-a", {
          branchProvider: "codex" as any,
          branchModel: "gpt-5.5",
          branchThinkingLevel: "high",
        }),
      ],
      makeRunContext(run.id),
    );

    expect(configStore.getConnectionLineModelConfig).not.toHaveBeenCalled();
    expect(branchDecider.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude",
        model: "sonnet",
        thinkingLevel: "low",
      }),
    );
  });
});
