/**
 * connectionStore branch 驗證邏輯測試
 *
 * 涵蓋：
 * - create：triggerMode=branch 時 label 必填、不可為 "None"（大小寫不敏感）、同 source 唯一
 * - update：branch → auto/direct 時清空 branch 欄位並 reset decideStatus；
 *           branch → branch 時 label 唯一性（排除自己）；label="None" throw；
 *           修改 description/provider/model 不動 label 也合法
 * - findBranchGroup：只列出同 source 且 triggerMode=branch 的連線
 */

// getProvider 是 SDK boundary，保留 mock
const { mockGetProvider } = vi.hoisted(() => ({
  mockGetProvider: vi.fn((_provider: string) => ({
    metadata: {
      availableModelValues: new Set(["sonnet", "opus", "haiku"]),
      availableModels: [
        { label: "Sonnet", value: "sonnet" },
        { label: "Opus", value: "opus" },
      ],
      defaultOptions: { model: "sonnet" },
      capabilities: { chat: true, plugin: true, mcp: true, repository: true },
    },
  })),
}));

vi.mock("../../src/services/provider/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/services/provider/index.js")
    >();
  return { ...actual, getProvider: mockGetProvider };
});

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectionStore } from "../../src/services/connectionStore.js";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

const CANVAS_ID = "test-canvas-branch";

/** 建立測試用 canvas */
function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "Test Canvas", 0);
}

/** 直接用 SQL 插入 pod */
function insertPod(podId: string): void {
  getDb()
    .prepare(
      `INSERT INTO pods
         (id, canvas_id, name, x, y, rotation, workspace_path,
          session_id, repository_id, command_id,
          schedule_json, provider, provider_config_json)
         VALUES (?, ?, ?, 0, 0, 0, '/tmp/test-pod', NULL, NULL, NULL, NULL, 'claude',
         '{"model":"sonnet"}')`,
    )
    .run(podId, CANVAS_ID, `Pod-${podId}`);
}

/** 建立一條 branch connection 的捷徑 */
function createBranchConnection(
  sourcePodId: string,
  targetPodId: string,
  label: string,
) {
  return connectionStore.create(CANVAS_ID, {
    sourcePodId,
    sourceAnchor: "right",
    targetPodId,
    targetAnchor: "left",
    triggerMode: "branch",
    label,
    branchProvider: "claude",
    branchModel: "sonnet",
  });
}

describe("connectionStore — branch 驗證邏輯", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    insertCanvas();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  // ----------------------------------------------------------------
  // create 路徑
  // ----------------------------------------------------------------
  describe("create — branch label 驗證", () => {
    it("1. create + branch + 合法 label → 成功建立", () => {
      insertPod("src-1");
      insertPod("dst-1");

      const conn = createBranchConnection("src-1", "dst-1", "Checklist");

      expect(conn.triggerMode).toBe("branch");
      expect(conn.label).toBe("Checklist");
    });

    it("2. create + branch + label='' (空字串) → throw 業務錯誤", () => {
      insertPod("src-2");
      insertPod("dst-2");

      expect(() =>
        connectionStore.create(CANVAS_ID, {
          sourcePodId: "src-2",
          sourceAnchor: "right",
          targetPodId: "dst-2",
          targetAnchor: "left",
          triggerMode: "branch",
          label: "",
        }),
      ).toThrow(/label/);
    });

    it("3. create + branch + label='None' → throw（保留字）", () => {
      insertPod("src-3");
      insertPod("dst-3");

      expect(() =>
        connectionStore.create(CANVAS_ID, {
          sourcePodId: "src-3",
          sourceAnchor: "right",
          targetPodId: "dst-3",
          targetAnchor: "left",
          triggerMode: "branch",
          label: "None",
        }),
      ).toThrow(/label/);
    });

    it("4. create + branch + label='none'（小寫）→ throw（不分大小寫）", () => {
      insertPod("src-4");
      insertPod("dst-4");

      expect(() =>
        connectionStore.create(CANVAS_ID, {
          sourcePodId: "src-4",
          sourceAnchor: "right",
          targetPodId: "dst-4",
          targetAnchor: "left",
          triggerMode: "branch",
          label: "none",
        }),
      ).toThrow(/label/);
    });

    it("5. create + branch + 同 source 已有 label='Checklist'，再 create label='Checklist' → throw（重複）", () => {
      insertPod("src-5");
      insertPod("dst-5a");
      insertPod("dst-5b");

      // 先建立第一條
      createBranchConnection("src-5", "dst-5a", "Checklist");

      // 同 source 再建立相同 label → 應 throw
      expect(() =>
        createBranchConnection("src-5", "dst-5b", "Checklist"),
      ).toThrow(/label/);
    });
  });

  // ----------------------------------------------------------------
  // update 路徑
  // ----------------------------------------------------------------
  describe("update — branch → 其他模式清空欄位", () => {
    it("6. update branch → auto → 清空 label/description/branchProvider/branchModel + decideStatus='none'", () => {
      insertPod("src-6");
      insertPod("dst-6");

      const conn = createBranchConnection("src-6", "dst-6", "MyLabel");
      // 先手動設 decideStatus 為 pending
      connectionStore.update(CANVAS_ID, conn.id, { decideStatus: "pending" });

      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        triggerMode: "auto",
      });

      expect(updated?.triggerMode).toBe("auto");
      expect(updated?.label).toBe("");
      expect(updated?.description).toBeUndefined();
      // branchProvider/branchModel 在 rowToConnection 中 NULL 會 fallback
      // 切換後 DB 應為 NULL；rowToConnection fallback 為 "claude"/"sonnet"
      // 主要驗證 decideStatus 被 reset
      expect(updated?.decideStatus).toBe("none");
    });

    it("7. update branch → direct → 清空 + reset decideStatus='none'", () => {
      insertPod("src-7");
      insertPod("dst-7");

      const conn = createBranchConnection("src-7", "dst-7", "DirectLabel");
      connectionStore.update(CANVAS_ID, conn.id, { decideStatus: "decided" });

      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        triggerMode: "direct",
      });

      expect(updated?.triggerMode).toBe("direct");
      expect(updated?.label).toBe("");
      expect(updated?.decideStatus).toBe("none");
    });
  });

  describe("update — branch → branch label 變更", () => {
    it("8. update branch → branch + label 變更為新值（同 source 內唯一）→ 成功", () => {
      insertPod("src-8");
      insertPod("dst-8");

      const conn = createBranchConnection("src-8", "dst-8", "OldLabel");

      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        triggerMode: "branch",
        label: "NewLabel",
      });

      expect(updated?.label).toBe("NewLabel");
      expect(updated?.triggerMode).toBe("branch");
    });

    it("9. update branch → branch + label='None' → throw", () => {
      insertPod("src-9");
      insertPod("dst-9");

      const conn = createBranchConnection("src-9", "dst-9", "ValidLabel");

      expect(() =>
        connectionStore.update(CANVAS_ID, conn.id, {
          triggerMode: "branch",
          label: "None",
        }),
      ).toThrow(/label/);
    });

    it("10. update branch → branch + label 與另一條 branch 重複 → throw", () => {
      insertPod("src-10");
      insertPod("dst-10a");
      insertPod("dst-10b");

      // 同 source 兩條 branch
      createBranchConnection("src-10", "dst-10a", "Alpha");
      const connB = createBranchConnection("src-10", "dst-10b", "Beta");

      // 嘗試把 connB label 改成 "Alpha"（已被另一條佔用）→ 應 throw
      expect(() =>
        connectionStore.update(CANVAS_ID, connB.id, {
          label: "Alpha",
        }),
      ).toThrow(/label/);
    });

    it("11. update branch → branch + 修改 description / provider / model 不動 label → 成功", () => {
      insertPod("src-11");
      insertPod("dst-11");

      const conn = createBranchConnection("src-11", "dst-11", "StableLabel");

      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        description: "新的描述",
        branchProvider: "claude",
        branchModel: "opus",
      });

      expect(updated?.label).toBe("StableLabel");
      expect(updated?.description).toBe("新的描述");
      expect(updated?.branchProvider).toBe("claude");
      expect(updated?.branchModel).toBe("opus");
    });
  });

  // ----------------------------------------------------------------
  // findBranchGroup
  // ----------------------------------------------------------------
  describe("findBranchGroup — 只列出同 source 的 branch connections", () => {
    it("12. findBranchGroup → 同 source 的 branch connection 全列出，非 branch 的不在內", () => {
      insertPod("src-12");
      insertPod("dst-12a");
      insertPod("dst-12b");
      insertPod("dst-12c");

      // 兩條 branch
      const b1 = createBranchConnection("src-12", "dst-12a", "BranchA");
      const b2 = createBranchConnection("src-12", "dst-12b", "BranchB");

      // 一條 auto（非 branch）
      const autoConn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "src-12",
        sourceAnchor: "right",
        targetPodId: "dst-12c",
        targetAnchor: "left",
        triggerMode: "auto",
      });

      const group = connectionStore.findBranchGroup(CANVAS_ID, "src-12");

      // 只包含兩條 branch
      expect(group).toHaveLength(2);
      const ids = group.map((c) => c.id);
      expect(ids).toContain(b1.id);
      expect(ids).toContain(b2.id);
      // auto 連線不在內
      expect(ids).not.toContain(autoConn.id);
      // 每條都是 branch 模式
      group.forEach((c) => expect(c.triggerMode).toBe("branch"));
    });
  });
});
