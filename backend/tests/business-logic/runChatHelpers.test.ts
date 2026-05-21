/**
 * runChatHelpers 單元測試
 *
 * 保留合理 boundary mock：
 *   - socketService.emitToCanvas（WebSocket 邊界）
 * 移除自家 store mock，改用 initTestDb + 真實 store。
 */

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: vi.fn(),
  },
}));

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { injectRunUserMessage } from "../../src/utils/runChatHelpers.js";
import { socketService } from "../../src/services/socketService.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import type { RunContext } from "../../src/types/run.js";
import type { ContentBlock } from "../../src/types/index.js";

const CANVAS_ID = "canvas-run-chat";
const POD_ID = "pod-run-src";
const RUN_ID = "run-test-1";

const RUN_CONTEXT: RunContext = {
  runId: RUN_ID,
  canvasId: CANVAS_ID,
  sourcePodId: POD_ID,
};

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "Run Chat Canvas", 0);
}

function insertWorkflowRun(): void {
  // run_messages 的 FK → workflow_runs，需先建立 run 記錄
  getDb()
    .prepare(
      `INSERT INTO workflow_runs
             (id, canvas_id, source_pod_id, trigger_message, status, created_at)
             VALUES (?, ?, ?, '', 'running', datetime('now'))`,
    )
    .run(RUN_ID, CANVAS_ID, POD_ID);
}

describe("injectRunUserMessage", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    insertCanvas();
    insertWorkflowRun();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  it("應呼叫 runStore.addRunMessage 真實寫入 run message", async () => {
    await injectRunUserMessage(RUN_CONTEXT, POD_ID, "測試訊息");

    // 從 DB 直接確認記錄存在
    const row = getDb()
      .prepare("SELECT * FROM run_messages WHERE run_id = ? AND pod_id = ?")
      .get(RUN_ID, POD_ID) as { role: string; content: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.role).toBe("user");
    expect(row!.content).toBe("測試訊息");
  });

  it("應透過 socketService.emitToCanvas 發送 RUN_MESSAGE 事件", async () => {
    await injectRunUserMessage(RUN_CONTEXT, POD_ID, "廣播測試");

    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_MESSAGE,
      expect.objectContaining({
        runId: RUN_ID,
        canvasId: CANVAS_ID,
        podId: POD_ID,
        content: "廣播測試",
        messageId: expect.any(String),
        isPartial: false,
        role: "user",
      }),
    );
  });

  it("不應修改 pod 的全域狀態（run mode 不改 DB 狀態）", async () => {
    // run mode 不呼叫 podStore.setStatus，DB 狀態應維持原始值
    await injectRunUserMessage(RUN_CONTEXT, POD_ID, "測試");

    // run_chat_helpers 不修改 pod 狀態，emitToCanvas 只被 RUN_MESSAGE 呼叫一次
    expect(socketService.emitToCanvas).toHaveBeenCalledTimes(1);
    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_MESSAGE,
      expect.anything(),
    );
  });

  it("content 為 string 時應正確寫入原始字串", async () => {
    await injectRunUserMessage(RUN_CONTEXT, POD_ID, "純文字訊息");

    const row = getDb()
      .prepare(
        "SELECT content FROM run_messages WHERE run_id = ? AND pod_id = ?",
      )
      .get(RUN_ID, POD_ID) as { content: string } | undefined;
    expect(row?.content).toBe("純文字訊息");
    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_MESSAGE,
      expect.objectContaining({ content: "純文字訊息" }),
    );
  });

  it("content 為 ContentBlock[] 時應經 extractDisplayContent 轉換後寫入", async () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "區塊文字" },
      { type: "image", mediaType: "image/png", base64Data: "xyz" },
    ];

    await injectRunUserMessage(RUN_CONTEXT, POD_ID, blocks);

    const expectedDisplay = "區塊文字[image]";
    const row = getDb()
      .prepare(
        "SELECT content FROM run_messages WHERE run_id = ? AND pod_id = ?",
      )
      .get(RUN_ID, POD_ID) as { content: string } | undefined;
    expect(row?.content).toBe(expectedDisplay);
    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      CANVAS_ID,
      WebSocketResponseEvents.RUN_MESSAGE,
      expect.objectContaining({ content: expectedDisplay }),
    );
  });
});
