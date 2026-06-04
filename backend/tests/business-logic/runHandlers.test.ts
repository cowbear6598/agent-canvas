import { beforeEach, describe, expect, it, vi } from "vitest";

const CANVAS_ID = "canvas-run-handlers";
const CONNECTION_ID = "conn-run-handlers";
const REQUEST_ID = "req-run-handlers";

const state = vi.hoisted(() => ({
  activeCanvasId: "canvas-run-handlers",
}));

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => state.activeCanvasId),
  },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

import { initTestDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import {
  handleRunDelete,
  handleRunLoadHistory,
  handleRunLoadPodMessages,
} from "../../src/handlers/runHandlers.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { emitSuccess } from "../../src/utils/websocketResponse.js";

describe("handleRunLoadPodMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStatements();
    initTestDb();
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
      )
      .run(CANVAS_ID, "run-handler-canvas", 0);
    state.activeCanvasId = CANVAS_ID;
  });

  it("回傳最近一頁訊息與 pageInfo", async () => {
    const run = runStore.createRun(CANVAS_ID, "source-pod", "trigger");
    const podId = "00000000-0000-0000-0000-000000000099";

    runStore.upsertRunMessage(run.id, podId, {
      id: "00000000-0000-0000-0000-000000000001",
      role: "assistant",
      content: "第一則",
      timestamp: "2026-05-22T10:00:00.000Z",
    });
    runStore.upsertRunMessage(run.id, podId, {
      id: "00000000-0000-0000-0000-000000000002",
      role: "assistant",
      content: "第二則",
      timestamp: "2026-05-22T10:00:01.000Z",
    });
    runStore.upsertRunMessage(run.id, podId, {
      id: "00000000-0000-0000-0000-000000000003",
      role: "assistant",
      content: "第三則",
      timestamp: "2026-05-22T10:00:02.000Z",
    });

    await handleRunLoadPodMessages(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        runId: run.id,
        podId,
        limit: 2,
      },
      REQUEST_ID,
    );

    expect(emitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      WebSocketResponseEvents.RUN_POD_MESSAGES_LOADED,
      {
        requestId: REQUEST_ID,
        success: true,
        runId: run.id,
        podId,
        timelineItems: [
          expect.objectContaining({ content: "第二則" }),
          expect.objectContaining({ content: "第三則" }),
        ],
        pageInfo: {
          hasMore: true,
          nextCursor: {
            beforeTimestamp: "2026-05-22T10:00:01.000Z",
            beforeMessageId: "00000000-0000-0000-0000-000000000002",
            beforeItemType: "message",
          },
        },
      },
    );
  });

  it("timelineItems 應 sanitize message metadata 並保留 divider 欄位", async () => {
    const run = runStore.createRun(CANVAS_ID, "source-pod", "trigger");
    const podId = "00000000-0000-0000-0000-000000000099";

    runStore.upsertRunMessage(run.id, podId, {
      id: "00000000-0000-0000-0000-000000000001",
      role: "system",
      content: "系統訊息",
      timestamp: "2026-05-22T10:00:00.000Z",
      metadata: {
        provider: "claude",
        code: "PROVIDER_ERROR",
        severity: "error",
        rawContent: "不應傳給前端的原始內容",
      },
    });
    runStore.addRunGoalRoundDivider({
      runId: run.id,
      podId,
      sourcePodIds: ["source-pod"],
      sourcePodNames: ["Source Pod"],
      status: "completed",
      completedAt: "2026-05-22T10:00:01.000Z",
      connectionIds: ["conn-1"],
      id: "00000000-0000-0000-0000-000000000002",
    });

    await handleRunLoadPodMessages(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        runId: run.id,
        podId,
        limit: 10,
      },
      REQUEST_ID,
    );

    expect(emitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      WebSocketResponseEvents.RUN_POD_MESSAGES_LOADED,
      expect.objectContaining({
        timelineItems: [
          expect.objectContaining({
            metadata: expect.objectContaining({ rawContent: "" }),
          }),
          expect.objectContaining({
            type: "goal-round-divider",
            sourcePodIds: ["source-pod"],
            sourcePodNames: ["Source Pod"],
            connectionIds: ["conn-1"],
          }),
        ],
      }),
    );
  });

  it("timelineItems 應原樣回傳 blocked divider status 與 blockedReason", async () => {
    const run = runStore.createRun(CANVAS_ID, "source-pod", "trigger");
    const podId = "00000000-0000-0000-0000-000000000199";

    runStore.addRunGoalRoundDivider({
      runId: run.id,
      podId,
      sourcePodIds: ["source-pod"],
      sourcePodNames: ["Source Pod"],
      status: "blocked",
      blockedReason: "等待人工確認",
      completedAt: "2026-05-22T10:00:03.000Z",
      connectionIds: ["conn-blocked-1"],
      id: "00000000-0000-0000-0000-000000000004",
    });

    await handleRunLoadPodMessages(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        runId: run.id,
        podId,
        limit: 10,
      },
      REQUEST_ID,
    );

    expect(emitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      WebSocketResponseEvents.RUN_POD_MESSAGES_LOADED,
      expect.objectContaining({
        requestId: REQUEST_ID,
        success: true,
        runId: run.id,
        podId,
        timelineItems: [
          expect.objectContaining({
            type: "goal-round-divider",
            status: "blocked",
            blockedReason: "等待人工確認",
            sourcePodIds: ["source-pod"],
            sourcePodNames: ["Source Pod"],
            connectionIds: ["conn-blocked-1"],
          }),
        ],
      }),
    );
  });
});

describe("handleRunLoadHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStatements();
    initTestDb();
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
      )
      .run(CANVAS_ID, "run-handler-canvas", 0);
    state.activeCanvasId = CANVAS_ID;
  });

  it("blocked pod status 應原樣回傳給前端 run history 契約", async () => {
    const run = runStore.createRun(CANVAS_ID, "source-pod", "trigger");
    const instance = runStore.createPodInstance(run.id, "pod-blocked");
    runStore.updatePodInstanceStatus(
      instance.id,
      "blocked",
      "Goal 已標記為 blocked，workflow 已停止觸發下游 Pod：等待人工確認",
    );

    await handleRunLoadHistory(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
      },
      REQUEST_ID,
    );

    expect(emitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      WebSocketResponseEvents.RUN_HISTORY_RESULT,
      expect.objectContaining({
        requestId: REQUEST_ID,
        success: true,
        runs: [
          expect.objectContaining({
            id: run.id,
            podInstances: expect.arrayContaining([
              expect.objectContaining({
                podId: "pod-blocked",
                status: "blocked",
                errorMessage:
                  "Goal 已標記為 blocked，workflow 已停止觸發下游 Pod：等待人工確認",
              }),
            ]),
          }),
        ],
      }),
    );
  });
});

describe("handleRunDelete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStatements();
    initTestDb();
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
      )
      .run(CANVAS_ID, "run-handler-canvas", 0);
    state.activeCanvasId = CANVAS_ID;
  });

  it("刪除成功後應回傳 request-scoped success ack", async () => {
    const run = runStore.createRun(CANVAS_ID, "source-pod", "trigger");
    const deleteSpy = vi
      .spyOn(runExecutionService, "deleteRun")
      .mockResolvedValueOnce();

    await handleRunDelete(
      CONNECTION_ID,
      {
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
        runId: run.id,
      },
      REQUEST_ID,
    );

    expect(deleteSpy).toHaveBeenCalledWith(run.id);
    expect(emitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      WebSocketResponseEvents.RUN_DELETED,
      {
        requestId: REQUEST_ID,
        success: true,
        canvasId: CANVAS_ID,
        runId: run.id,
      },
    );
  });
});
