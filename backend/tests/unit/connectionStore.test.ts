/**
 * connectionStore unit test
 *
 * 驗證 create 與 update 路徑的 summaryModel 邏輯：
 * - 上游 Pod 為 Claude，未帶 summaryModel → summaryModel 為 Claude 預設
 * - 上游 Pod 為 Codex，未帶 summaryModel → summaryModel 為 Codex 預設
 * - 上游 Pod 為 Claude，帶入 Codex 模型 → fallback 到 Claude 預設
 * - 上游 Pod 為 Codex，帶入 Claude 模型 → fallback 到 Codex 預設
 * - 上游 Pod 找不到 → fallback 到 claude 預設
 * - update 路徑也做 model 驗證
 *
 * 移除 podStore.getById 自家 mock，改用 initTestDb + 真實 pod 資料。
 * getProvider 保留 mock（resolveProviderConfig 與 resolveModelWithFallback 均需要 metadata）。
 *
 * B1–B6：summaryProvider 欄位相關的新測試案例。
 */

// getProvider 是 SDK boundary，且 podStore.getById → buildPodFromRow → resolveProviderConfig 需要 metadata
// 因此保留 mock，並依 provider 回傳對應的 metadata
const { mockGetProvider } = vi.hoisted(() => ({
  mockGetProvider: vi.fn((provider: string) => {
    if (provider === "codex") {
      return {
        metadata: {
          availableModelValues: new Set(["gpt-5.4", "gpt-5.5", "gpt-5.4-mini"]),
          availableModels: [
            { label: "GPT-5.4", value: "gpt-5.4" },
            { label: "GPT-5.5", value: "gpt-5.5" },
          ],
          defaultOptions: { model: "gpt-5.4" },
          capabilities: {
            chat: true,
            plugin: false,
            mcp: false,
            repository: true,
          },
        },
      };
    }
    if (provider === "gemini") {
      return {
        metadata: {
          availableModelValues: new Set([
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.5-flash-lite",
          ]),
          availableModels: [
            { label: "2.5 Flash", value: "gemini-2.5-flash" },
            { label: "2.5 Pro", value: "gemini-2.5-pro" },
          ],
          defaultOptions: { model: "gemini-2.5-flash" },
          capabilities: {
            chat: true,
            plugin: true,
            mcp: true,
            repository: true,
          },
        },
      };
    }
    // 預設回傳 claude metadata
    return {
      metadata: {
        availableModelValues: new Set(["sonnet", "opus", "haiku"]),
        availableModels: [
          { label: "Sonnet", value: "sonnet" },
          { label: "Opus", value: "opus" },
        ],
        defaultOptions: { model: "sonnet" },
        capabilities: { chat: true, plugin: true, mcp: true, repository: true },
      },
    };
  }),
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

const CANVAS_ID = "test-canvas-model";

/** 建立測試用 canvas */
function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "Test Canvas", 0);
}

/** 直接用 SQL 插入 pod，指定 provider */
function insertPod(
  podId: string,
  provider: "claude" | "codex" | "gemini",
): void {
  getDb()
    .prepare(
      `INSERT INTO pods
             (id, canvas_id, name, status, x, y, rotation, workspace_path,
              session_id, repository_id, command_id, multi_instance,
              schedule_json, provider, provider_config_json)
             VALUES (?, ?, ?, 'idle', 0, 0, 0, '/tmp/test-pod', NULL, NULL, NULL, 0, NULL, ?,
             '{"model":"sonnet"}')`,
    )
    .run(podId, CANVAS_ID, `Pod-${podId}`, provider);
}

describe("connectionStore — summaryModel 驗證邏輯", () => {
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
  describe("create — summaryModel 預設與驗證", () => {
    it("上游 Pod 為 Claude，未帶 summaryModel → summaryModel 為 Claude 預設（sonnet）", () => {
      insertPod("pod-src", "claude");

      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
      });

      // Claude 的 defaultOptions.model = "sonnet"（見 claudeProvider.ts）
      expect(conn.summaryModel).toBe("sonnet");
    });

    it("上游 Pod 為 Codex，未帶 summaryModel → summaryModel 為 Codex 預設（gpt-5.4）", () => {
      insertPod("pod-src", "codex");

      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
      });

      // Codex 的 defaultOptions.model = "gpt-5.4"（見 codexProvider.ts）
      expect(conn.summaryModel).toBe("gpt-5.4");
    });

    it("上游 Pod 為 Claude，帶入 Codex 模型 → fallback 到 Claude 預設", () => {
      insertPod("pod-src", "claude");

      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
        summaryModel: "gpt-5.4", // Codex 模型，不在 Claude 合法清單
      });

      // fallback → Claude 預設
      expect(conn.summaryModel).toBe("sonnet");
    });

    it("上游 Pod 為 Codex，帶入 Claude 模型 → fallback 到 Codex 預設", () => {
      insertPod("pod-src", "codex");

      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
        summaryModel: "opus", // Claude 模型，不在 Codex 合法清單
      });

      // fallback → Codex 預設
      expect(conn.summaryModel).toBe("gpt-5.4");
    });

    it("上游 Pod 找不到（DB 中無該 pod）→ fallback 到 claude 預設（sonnet）", () => {
      // 不插入 pod，模擬找不到情況
      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-not-exist",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
      });

      // provider fallback 到 "claude"，summaryModel 為 claude 預設
      expect(conn.summaryModel).toBe("sonnet");
    });
  });

  // ----------------------------------------------------------------
  // update 路徑
  // ----------------------------------------------------------------
  describe("update — summaryModel 驗證", () => {
    /** 先 create 一條 connection（上游指定 provider），再 update summaryModel */
    function createBaseConnection(
      provider: "claude" | "codex" | "gemini" = "claude",
    ) {
      insertPod("pod-src", provider);
      return connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
      });
    }

    it("update 帶入合法 Claude 模型 → summaryModel 更新為新值", () => {
      const base = createBaseConnection("claude");

      const updated = connectionStore.update(CANVAS_ID, base.id, {
        summaryModel: "opus",
      });

      expect(updated?.summaryModel).toBe("opus");
    });

    it("update 帶入不合法模型（Codex 模型給 Claude）→ fallback 到 Claude 預設", () => {
      const base = createBaseConnection("claude");

      const updated = connectionStore.update(CANVAS_ID, base.id, {
        summaryModel: "gpt-5.4", // Codex 模型，不合法
      });

      expect(updated?.summaryModel).toBe("sonnet");
    });

    it("update 帶入合法 Codex 模型（上游為 Codex）→ summaryModel 更新為新值", () => {
      const base = createBaseConnection("codex");

      const updated = connectionStore.update(CANVAS_ID, base.id, {
        summaryModel: "gpt-5.5",
      });

      expect(updated?.summaryModel).toBe("gpt-5.5");
    });

    it("update 帶入不合法模型（Claude 模型給 Codex）→ fallback 到 Codex 預設", () => {
      const base = createBaseConnection("codex");

      const updated = connectionStore.update(CANVAS_ID, base.id, {
        summaryModel: "opus", // Claude 模型，對 Codex 不合法
      });

      expect(updated?.summaryModel).toBe("gpt-5.4");
    });
  });

  // ----------------------------------------------------------------
  // B1–B6：summaryProvider 欄位相關測試案例
  // ----------------------------------------------------------------
  describe("B1–B6 summaryProvider 欄位邏輯", () => {
    // B1: create 不帶 summaryProvider → DB 寫入 NULL
    it("B1: create 不帶 summaryProvider → summaryProvider 寫入 NULL", () => {
      insertPod("pod-src", "claude");

      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
      });

      // summaryProvider=NULL 代表使用者未指定，runtime 從 sourcePod.provider fallback
      expect(conn.summaryProvider).toBeNull();
    });

    // B2: create 帶 summaryProvider=gemini、不帶 summaryModel → summaryModel = gemini-2.5-flash
    it("B2: create 帶 summaryProvider=gemini、不帶 summaryModel → summaryModel 為 gemini 預設（gemini-2.5-flash）", () => {
      insertPod("pod-src", "claude");

      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
        summaryProvider: "gemini",
        // 不帶 summaryModel，應自動用 gemini 的預設模型
      });

      // gemini mock 的 defaultOptions.model = "gemini-2.5-flash"
      expect(conn.summaryModel).toBe("gemini-2.5-flash");
      // summaryProvider 持久化正確
      expect(conn.summaryProvider).toBe("gemini");
    });

    // B3: create 帶 summaryProvider=gemini、summaryModel="sonnet"（cross-provider）→ fallback 到 gemini-2.5-flash
    it("B3: create 帶 summaryProvider=gemini、summaryModel=sonnet（不合法）→ fallback 到 gemini-2.5-flash", () => {
      insertPod("pod-src", "claude");

      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
        summaryProvider: "gemini",
        summaryModel: "sonnet", // Claude 模型，不在 gemini 合法清單
      });

      // 跨 provider 不合法 model → fallback 到 gemini 預設
      expect(conn.summaryModel).toBe("gemini-2.5-flash");
      expect(conn.summaryProvider).toBe("gemini");
    });

    // B4: update 切 summaryProvider 但不帶 summaryModel → summaryModel 自動重設為新 provider 預設
    it("B4: update 切 summaryProvider=gemini 但不帶 summaryModel → summaryModel 自動重設為 gemini-2.5-flash", () => {
      insertPod("pod-src", "claude");
      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
        // 初始 summaryProvider=NULL，summaryModel=sonnet
      });
      // 確認初始狀態
      expect(conn.summaryProvider).toBeNull();
      expect(conn.summaryModel).toBe("sonnet");

      // 切換 summaryProvider 為 gemini，不指定 summaryModel
      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        summaryProvider: "gemini",
      });

      // summaryModel 應重設為 gemini 的預設模型
      expect(updated?.summaryModel).toBe("gemini-2.5-flash");
      expect(updated?.summaryProvider).toBe("gemini");
    });

    // B5: update 同時切 summaryProvider+summaryModel（合法）→ 兩者都按指定值寫入
    it("B5: update 同時指定 summaryProvider=gemini + summaryModel=gemini-2.5-pro（合法）→ 兩者都寫入", () => {
      insertPod("pod-src", "claude");
      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
      });

      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        summaryProvider: "gemini",
        summaryModel: "gemini-2.5-pro", // gemini 合法模型
      });

      expect(updated?.summaryProvider).toBe("gemini");
      expect(updated?.summaryModel).toBe("gemini-2.5-pro");
    });

    // B6: update 只改 summaryModel（既有 summaryProvider=NULL）→ 對 sourcePod.provider 做 resolveModelWithFallback
    it("B6: update 只改 summaryModel（summaryProvider=NULL）→ 以 sourcePod.provider=codex 做驗證，不合法時 fallback", () => {
      insertPod("pod-src", "codex");
      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
        // summaryProvider 未指定（NULL），sourcePod 為 codex
      });
      expect(conn.summaryProvider).toBeNull();
      // 初始 summaryModel 應為 codex 預設
      expect(conn.summaryModel).toBe("gpt-5.4");

      // 只改 summaryModel，帶入 Claude 模型（對 codex 不合法）
      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        summaryModel: "sonnet", // Claude 模型，對 codex 不合法
      });

      // 應 fallback 到 codex 預設模型（因 summaryProvider=NULL → 以 sourcePod.provider=codex 做驗證）
      expect(updated?.summaryModel).toBe("gpt-5.4");
      // summaryProvider 仍應為 NULL
      expect(updated?.summaryProvider).toBeNull();
    });

    // B6.5: update 只改 summaryModel（既有 summaryProvider=gemini）→ 以 summaryProvider 做驗證，不改動 summaryProvider
    it("B6.5: update 只改 summaryModel（summaryProvider=gemini）→ 以 summaryProvider=gemini 做驗證；合法時正常更新，不合法時 fallback 至 gemini 預設", () => {
      insertPod("pod-src", "claude");
      const conn = connectionStore.create(CANVAS_ID, {
        sourcePodId: "pod-src",
        sourceAnchor: "right",
        targetPodId: "pod-dst",
        targetAnchor: "left",
        summaryProvider: "gemini",
        summaryModel: "gemini-2.5-flash",
      });
      expect(conn.summaryProvider).toBe("gemini");
      expect(conn.summaryModel).toBe("gemini-2.5-flash");

      // 只帶 summaryModel（gemini 合法模型），summaryProvider 未傳入
      const updated = connectionStore.update(CANVAS_ID, conn.id, {
        summaryModel: "gemini-2.5-pro",
      });

      // summaryModel 應更新為新值，summaryProvider 維持 gemini
      expect(updated?.summaryModel).toBe("gemini-2.5-pro");
      expect(updated?.summaryProvider).toBe("gemini");

      // 再次 update：帶入 Claude 模型（跨 provider 不合法）
      const updatedCross = connectionStore.update(CANVAS_ID, conn.id, {
        summaryModel: "sonnet", // Claude 模型，對 gemini 不合法
      });

      // 應 fallback 到 gemini 預設，summaryProvider 仍為 gemini
      expect(updatedCross?.summaryModel).toBe("gemini-2.5-flash");
      expect(updatedCross?.summaryProvider).toBe("gemini");
    });
  });
});
