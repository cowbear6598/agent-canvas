/**
 * handlerHelpers 單元測試
 *
 * 保留合理 boundary mock：
 *   - getProvider（SDK boundary：podStore.getById 透過 buildPodFromRow 需要 metadata）
 *   - emitError / socketService（WebSocket 邊界）
 * 移除 podStore.getById 自家 mock，改用 initTestDb + 真實 store。
 */

// vi.hoisted 讓這些 fn 在 vi.mock 工廠被提升後仍可存取
const { mockGetProvider } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(() => ({
    metadata: {
      availableModelValues: new Set(["sonnet", "opus", "haiku"]),
      availableModels: [
        { label: "Sonnet", value: "sonnet" },
        { label: "Opus", value: "opus" },
      ],
      defaultOptions: { model: "sonnet" },
    },
  })),
}));

// getProvider 是 SDK boundary — podStore.getById → buildPodFromRow → resolveProviderConfig 需要 metadata
vi.mock("../../src/services/provider/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/services/provider/index.js")
    >();
  return { ...actual, getProvider: mockGetProvider };
});

vi.mock("../../src/services/socketService.js", () => ({
  socketService: { emitToCanvas: vi.fn(), emitToAll: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPodDisplayName } from "../../src/utils/handlerHelpers.js";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

const CANVAS_ID = "canvas-handler-test";
const POD_ID = "pod-handler-test";

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "Handler Test Canvas", 0);
}

function insertPod(name: string): void {
  getDb()
    .prepare(
      `INSERT INTO pods
             (id, canvas_id, name, x, y, rotation, workspace_path,
              session_id, repository_id, goal_json,
              schedule_json, provider, provider_config_json)
             VALUES (?, ?, ?, 0, 0, 0, '/tmp/handler-pod', NULL, NULL, NULL, NULL, 'claude',
             '{"model":"sonnet"}')`,
    )
    .run(POD_ID, CANVAS_ID, name);
}

describe("getPodDisplayName", () => {
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

  it("Pod 存在時應回傳 Pod 名稱", () => {
    insertPod("My Pod");

    const result = getPodDisplayName(CANVAS_ID, POD_ID);

    expect(result).toBe("My Pod");
  });

  it("Pod 不存在時應回傳 podId 作為 fallback", () => {
    // 不插入 pod，模擬找不到情況
    const result = getPodDisplayName(CANVAS_ID, "non-existent-pod");

    expect(result).toBe("non-existent-pod");
  });
});
