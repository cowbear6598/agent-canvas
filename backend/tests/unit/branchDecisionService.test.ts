/**
 * branchDecisionService 單元測試（Phase 6A，C 區塊）
 *
 * 此檔案取代原 aiDecideService.test.ts，測試新的 branchDecisionService。
 *
 * Mock 邊界：
 *   - executeDisposableChat（Claude/Codex API 邊界）
 *   - commandService.getContent（filesystem 邊界）
 *   - logger（side-effect only）
 *   - podStore.getById（DB 邊界）
 *   - messageStore.getMessages（DB 邊界）
 *   - branchDecider.decide（BranchDecider SDK 邊界）
 *
 * 不 mock：branchDecisionParser、branchPromptBuilder
 */

vi.mock("../../src/services/disposableChatService.js", () => ({
  executeDisposableChat: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import path from "path";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { branchDecisionService } from "../../src/services/workflow/branchDecisionService.js";
import { branchDecider } from "../../src/services/branch/index.js";
import { messageStore } from "../../src/services/messageStore.js";
import { runStore } from "../../src/services/runStore.js";
import { podStore } from "../../src/services/podStore.js";
import { config } from "../../src/config/index.js";
import type { Connection } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";
import { BranchAbortError } from "../../src/services/branch/abortError.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

const CANVAS_ID = "test-canvas-branch-decision";

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, `canvas-${CANVAS_ID}`, 0);
}

function insertPodViaSQL(podId: string, name: string): void {
  const workspacePath = path.join(config.canvasRoot, CANVAS_ID, `pod-${podId}`);
  getDb()
    .prepare(
      `INSERT INTO pods
       (id, canvas_id, name, status, x, y, rotation, workspace_path,
        session_id, repository_id, command_id, multi_instance,
        schedule_json, provider, provider_config_json)
       VALUES (?, ?, ?, 'idle', 0, 0, 0, ?, NULL, NULL, NULL, 0, NULL, 'claude',
       '{"model":"sonnet"}')`,
    )
    .run(podId, CANVAS_ID, name, workspacePath);
}

/** 建立標準 branch Connection 物件供測試使用 */
function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    sourcePodId: "source-pod",
    sourceAnchor: "right",
    targetPodId: "target-pod",
    targetAnchor: "left",
    triggerMode: "branch",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    summaryProvider: null,
    label: "Checklist",
    description: undefined,
    branchProvider: "claude",
    branchModel: "sonnet",
    ...overrides,
  };
}

const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";

describe("BranchDecisionService", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    insertCanvas();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
  });

  // ──────────────────────────────────────────────────────────────
  // C1: 空陣列 → 提早回傳，不發 model call
  // ──────────────────────────────────────────────────────────────
  it("branchConnections 為空陣列：不呼叫 branchDecider，直接回傳空結果", async () => {
    const decideSpy = vi.spyOn(branchDecider, "decide");

    const result = await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [],
    );

    expect(result.selectedConnectionId).toBeNull();
    expect(result.rejectedConnectionIds).toHaveLength(0);
    expect(decideSpy).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────
  // C2: sourcePod 沒任何訊息 → branchDecider 收到空 recentMessages → 走 None
  // ──────────────────────────────────────────────────────────────
  it("Source Pod 沒有任何訊息 → branchDecider 收到 recentMessages=[]，回傳 None（不發 model call）", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Target Pod");

    // 沒有插入任何訊息
    vi.spyOn(branchDecider, "decide").mockResolvedValue({
      selectedLabel: "None",
    });

    const result = await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [makeConnection()],
    );

    expect(result.selectedConnectionId).toBeNull();
    expect(result.rejectedConnectionIds).toEqual(["conn-1"]);

    // 確認 branchDecider 收到空 recentMessages
    const callArg = asMock(branchDecider.decide).mock.calls[0][0];
    expect(callArg.recentMessages).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────
  // C3: Source Pod 有訊息 → 取最後 4 段
  // ──────────────────────────────────────────────────────────────
  describe("recentMessages 截取邏輯", () => {
    it("Source Pod 訊息少於 4 段 → 全部訊息丟進 branchDecider", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");

      // 插入 2 段訊息
      messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
        id: "msg-u1",
        role: "user",
        content: "請分析",
        timestamp: new Date().toISOString(),
      });
      messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
        id: "msg-a1",
        role: "assistant",
        content: "分析完成",
        timestamp: new Date().toISOString(),
      });

      vi.spyOn(branchDecider, "decide").mockResolvedValue({
        selectedLabel: "Checklist",
      });

      await branchDecisionService.decideBranch(CANVAS_ID, SOURCE_POD_ID, [
        makeConnection(),
      ]);

      const callArg = asMock(branchDecider.decide).mock.calls[0][0];
      expect(callArg.recentMessages).toHaveLength(2);
    });

    it("Source Pod 訊息超過 4 段 → 只取最後 4 段", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");

      // 插入 6 段訊息
      for (let i = 0; i < 6; i++) {
        messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
          id: `msg-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `訊息 ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      vi.spyOn(branchDecider, "decide").mockResolvedValue({
        selectedLabel: "None",
      });

      await branchDecisionService.decideBranch(CANVAS_ID, SOURCE_POD_ID, [
        makeConnection(),
      ]);

      const callArg = asMock(branchDecider.decide).mock.calls[0][0];
      expect(callArg.recentMessages).toHaveLength(4);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // C4: AI 選中 → selectedConnectionId 對應正確
  // ──────────────────────────────────────────────────────────────
  it("branchDecider 回傳 selectedLabel=Checklist → selectedConnectionId 為對應 conn id", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Target Pod");
    messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
      id: "msg-1",
      role: "assistant",
      content: "任務完成",
      timestamp: new Date().toISOString(),
    });

    vi.spyOn(branchDecider, "decide").mockResolvedValue({
      selectedLabel: "Checklist",
    });

    const result = await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [makeConnection({ id: "conn-checklist", label: "Checklist" })],
    );

    expect(result.selectedConnectionId).toBe("conn-checklist");
    expect(result.rejectedConnectionIds).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────
  // C5: AI 選 None → selectedConnectionId=null，所有 conn 走 rejected
  // ──────────────────────────────────────────────────────────────
  it("branchDecider 回傳 selectedLabel=None → selectedConnectionId=null，全部 rejected", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Target Pod");
    messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
      id: "msg-1",
      role: "assistant",
      content: "無相關任務",
      timestamp: new Date().toISOString(),
    });

    vi.spyOn(branchDecider, "decide").mockResolvedValue({
      selectedLabel: "None",
    });

    const conn1 = makeConnection({ id: "conn-1", label: "Checklist" });
    const conn2 = makeConnection({
      id: "conn-2",
      label: "Review",
      targetPodId: "target-pod-2",
    });

    const result = await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [conn1, conn2],
    );

    expect(result.selectedConnectionId).toBeNull();
    expect(result.rejectedConnectionIds).toEqual(["conn-1", "conn-2"]);
  });

  // ──────────────────────────────────────────────────────────────
  // C6: abort 情況 → BranchAbortError 向上傳遞
  // ──────────────────────────────────────────────────────────────
  it("abortSignal 觸發時 → BranchAbortError 向上拋出，不做任何後續處理", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Target Pod");
    messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
      id: "msg-1",
      role: "assistant",
      content: "分析完成",
      timestamp: new Date().toISOString(),
    });

    vi.spyOn(branchDecider, "decide").mockRejectedValue(new BranchAbortError());

    await expect(
      branchDecisionService.decideBranch(CANVAS_ID, SOURCE_POD_ID, [
        makeConnection(),
      ]),
    ).rejects.toThrow("Branch decision aborted");
  });

  // ──────────────────────────────────────────────────────────────
  // C7: branchDecider.decide 拋出非 abort 例外 → 全部 rejected
  // ──────────────────────────────────────────────────────────────
  it("branchDecider.decide 拋出非 abort 例外 → 全部 connection rejected", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Target Pod");
    messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
      id: "msg-1",
      role: "assistant",
      content: "分析完成",
      timestamp: new Date().toISOString(),
    });

    vi.spyOn(branchDecider, "decide").mockRejectedValue(
      new Error("模型呼叫失敗"),
    );

    const result = await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [
        makeConnection({ id: "conn-1", label: "Checklist" }),
        makeConnection({
          id: "conn-2",
          label: "Review",
          targetPodId: "target-pod-2",
        }),
      ],
    );

    expect(result.selectedConnectionId).toBeNull();
    expect(result.rejectedConnectionIds).toEqual(["conn-1", "conn-2"]);
  });

  // ──────────────────────────────────────────────────────────────
  // C8: sourcePod 不存在 → throw
  // ──────────────────────────────────────────────────────────────
  it("sourcePod 不存在 → 拋出找不到 Pod 的例外", async () => {
    // 不插入 source pod

    await expect(
      branchDecisionService.decideBranch(CANVAS_ID, "nonexistent-pod", [
        makeConnection({ sourcePodId: "nonexistent-pod" }),
      ]),
    ).rejects.toThrow("[BranchDecisionService] 找不到來源 Pod");
  });

  // ──────────────────────────────────────────────────────────────
  // C9: run 模式 → 從 runStore 讀取訊息
  // ──────────────────────────────────────────────────────────────
  it("有 runContext 時從 runStore 讀取訊息，不使用 messageStore", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Target Pod");

    // messageStore 插入假資料（run mode 不應讀這個）
    messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
      id: "msg-not-used",
      role: "assistant",
      content: "不應被讀取",
      timestamp: new Date().toISOString(),
    });

    // 建立 run 並插入 run message
    const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
    runStore.upsertRunMessage(run.id, SOURCE_POD_ID, {
      id: "run-msg-1",
      role: "assistant",
      content: "run 模式分析結果",
      timestamp: new Date().toISOString(),
    });

    const runContext: RunContext = {
      runId: run.id,
      canvasId: CANVAS_ID,
      sourcePodId: SOURCE_POD_ID,
    };

    vi.spyOn(branchDecider, "decide").mockResolvedValue({
      selectedLabel: "Checklist",
    });

    await branchDecisionService.decideBranch(
      CANVAS_ID,
      SOURCE_POD_ID,
      [makeConnection()],
      runContext,
    );

    const callArg = asMock(branchDecider.decide).mock.calls[0][0];
    // run 模式下讀取 runStore 的訊息，內容為 run-msg-1
    expect(callArg.recentMessages).toHaveLength(1);
    expect(callArg.recentMessages[0].content).toBe("run 模式分析結果");
  });

  // ──────────────────────────────────────────────────────────────
  // C10: branchDecider 傳入正確的 provider / model（來自第一條 connection）
  // ──────────────────────────────────────────────────────────────
  it("branchDecider 使用第一條 connection 的 branchProvider / branchModel", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Target Pod");
    messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
      id: "msg-1",
      role: "assistant",
      content: "分析完成",
      timestamp: new Date().toISOString(),
    });

    vi.spyOn(branchDecider, "decide").mockResolvedValue({
      selectedLabel: "None",
    });

    await branchDecisionService.decideBranch(CANVAS_ID, SOURCE_POD_ID, [
      makeConnection({ branchProvider: "claude", branchModel: "opus" }),
    ]);

    const callArg = asMock(branchDecider.decide).mock.calls[0][0];
    expect(callArg.provider).toBe("claude");
    expect(callArg.model).toBe("opus");
  });

  // ──────────────────────────────────────────────────────────────
  // C11: branches 陣列正確組裝（含 label / description / targetPodName）
  // ──────────────────────────────────────────────────────────────
  it("branches 陣列正確包含 label、description 與 targetPodName", async () => {
    insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
    insertPodViaSQL(TARGET_POD_ID, "Review Pod");
    messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
      id: "msg-1",
      role: "assistant",
      content: "分析完成",
      timestamp: new Date().toISOString(),
    });

    vi.spyOn(branchDecider, "decide").mockResolvedValue({
      selectedLabel: "None",
    });

    await branchDecisionService.decideBranch(CANVAS_ID, SOURCE_POD_ID, [
      makeConnection({
        label: "Checklist",
        description: "如清單有問題則觸發",
        targetPodId: TARGET_POD_ID,
      }),
    ]);

    const callArg = asMock(branchDecider.decide).mock.calls[0][0];
    expect(callArg.branches).toHaveLength(1);
    expect(callArg.branches[0].label).toBe("Checklist");
    expect(callArg.branches[0].description).toBe("如清單有問題則觸發");
    expect(callArg.branches[0].targetPodName).toBe("Review Pod");
  });
});
