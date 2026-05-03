/**
 * Pod thinkingLevel 行為測試（Phase 5：B3–B12）
 *
 * 涵蓋：
 *  - [B3][B4][B5][B6] Pod 建立時 thinkingLevel 預設值寫入行為（透過 podStore.create + DB 重讀）
 *  - [B7][B8][B9][B10] handlePodSetModel 切 model 時 thinkingLevel 清空 / 寫入新 default 行為
 *  - [B11][B12] handlePodSetThinkingLevel 寫入 DB + emit pod public view payload
 *
 * Mock 邊界：
 *  - 可 mock：socketService、canvasStore、encryptionService、logger
 *  - 禁止 mock：providerConfigResolver、podStore、capabilities、buildClaudeOptions、buildCodexArgs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import {
  resetStatements,
  getStatements,
} from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";

// ── mocks（只 mock 邊界依賴：encryption / socket / canvasStore / logger）──

// 加密服務：Base64 假加密，避免測試環境執行真實 AES
vi.mock("../../src/services/encryptionService.js", () => ({
  encryptionService: {
    encrypt: (text: string) => Buffer.from(text).toString("base64"),
    decrypt: (text: string) => Buffer.from(text, "base64").toString("utf8"),
    isEncrypted: (value: string) => {
      try {
        JSON.parse(value);
        return false;
      } catch {
        return true;
      }
    },
    initializeKey: vi.fn().mockResolvedValue(undefined),
  },
}));

// socketService：捕捉 emitToCanvas / emitToConnection 呼叫
const emitToCanvasMock = vi.fn();
const emitToConnectionMock = vi.fn();
const emitToAllMock = vi.fn();
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: (...args: unknown[]) => emitToCanvasMock(...args),
    emitToConnection: (...args: unknown[]) => emitToConnectionMock(...args),
    emitToAll: (...args: unknown[]) => emitToAllMock(...args),
  },
}));

// canvasStore：handlerHelpers.getCanvasId 透過 getActiveCanvas 取 canvasId
const TEST_CONNECTION_ID = "conn-thinking-test";
const TEST_CANVAS_ID = "canvas-thinking-test";
vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => TEST_CANVAS_ID),
    getCanvasDir: vi.fn(() => "/tmp/test-canvas-thinking"),
    getById: vi.fn((id: string) => ({
      id,
      name: "test-canvas-thinking",
      sortIndex: 0,
    })),
    list: vi.fn(() => [
      { id: TEST_CANVAS_ID, name: "test-canvas-thinking", sortIndex: 0 },
    ]),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  // sanitizeSensitiveInfo 由其他模組共用，需 export 避免 import 失敗
  sanitizeSensitiveInfo: (s: string) => s,
}));

// websocketResponse：handler 內 emitError / emitSuccess / emitNotFound 都走這裡
vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

// ── imports（mock 設定後）─────────────────────────────────────────────────

import {
  handlePodSetModel,
  handlePodSetThinkingLevel,
} from "../../src/handlers/podHandlers.js";
import type {
  PodSetModelPayload,
  PodSetThinkingLevelPayload,
} from "../../src/schemas";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";

// ── 共用工具 ─────────────────────────────────────────────────────────────

/** 清除 podStore 內部 PreparedStatement 快取，避免跨測試使用過期 DB instance */
function clearPodStoreCache(): void {
  type PodStoreTestHooks = { stmtCache: Map<string, unknown> };
  const store = podStore as unknown as PodStoreTestHooks;
  store.stmtCache.clear();
}

function setupCanvas(canvasId: string = TEST_CANVAS_ID): void {
  const stmts = getStatements(getDb());
  stmts.canvas.insert.run({
    $id: canvasId,
    $name: "test-canvas-thinking",
    $sortIndex: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  initTestDb();
  resetStatements();
  clearPodStoreCache();
  setupCanvas();
});

afterEach(() => {
  closeDb();
});

// ════════════════════════════════════════════════════════════════════════
// [B3]–[B6] Pod 建立時 providerConfig.thinkingLevel 預設值寫入行為
// ════════════════════════════════════════════════════════════════════════

describe("Pod 建立預設 thinkingLevel 寫入", () => {
  it("[B3] Claude opus Pod 建立後 DB 內 providerConfig.thinkingLevel 應為 'high'", () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b3-claude-opus",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus" },
    });

    // DB 重讀驗證持久化欄位（不依賴 create 回傳值）
    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };
    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;
    expect(parsed.model).toBe("opus");
    expect(parsed.thinkingLevel).toBe("high");

    const found = podStore.getById(TEST_CANVAS_ID, pod.id);
    expect(found?.providerConfig).toEqual({
      model: "opus",
      thinkingLevel: "high",
    });
  });

  it("[B4] Codex gpt-5.5 Pod 建立後 DB 內 providerConfig.thinkingLevel 應為 'medium'", () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b4-codex-gpt55",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "codex",
      providerConfig: { model: "gpt-5.5" },
    });

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };
    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;
    expect(parsed.model).toBe("gpt-5.5");
    expect(parsed.thinkingLevel).toBe("medium");
  });

  it("[B5] Claude haiku Pod 建立後 providerConfig 不應含 thinkingLevel key", () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b5-claude-haiku",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "haiku" },
    });

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };
    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;
    expect(parsed.model).toBe("haiku");
    expect("thinkingLevel" in parsed).toBe(false);
  });

  it("[B6] Gemini Pod 建立後 providerConfig 不應含 thinkingLevel key", () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b6-gemini",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "gemini",
      providerConfig: { model: "gemini-2.5-pro" },
    });

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };
    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;
    expect(parsed.model).toBe("gemini-2.5-pro");
    expect("thinkingLevel" in parsed).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// [B7]–[B10] handlePodSetModel 切 model 時 thinkingLevel 清空 / 寫入新 default
// ════════════════════════════════════════════════════════════════════════

describe("handlePodSetModel 切 model 對 thinkingLevel 的影響", () => {
  /** 直接由 SQL 寫入指定 thinkingLevel，繞過 sanitize 自動補預設邏輯，供後續切 model 測試使用 */
  function patchThinkingLevel(
    podId: string,
    model: string,
    level: string | null,
  ): void {
    const config: Record<string, unknown> = { model };
    if (level !== null) config.thinkingLevel = level;
    getDb()
      .prepare("UPDATE pods SET provider_config_json = ? WHERE id = ?")
      .run(JSON.stringify(config), podId);
  }

  function makeSetModelPayload(
    podId: string,
    model: string,
  ): PodSetModelPayload {
    return {
      requestId: "req-test",
      canvasId: TEST_CANVAS_ID,
      podId,
      model,
    };
  }

  it("[B7] Opus(thinkingLevel=xhigh) → Sonnet：thinkingLevel 應重設為 sonnet 的 default 'high'", async () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b7",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus", thinkingLevel: "xhigh" },
    });

    // 確認起始狀態
    expect(podStore.getById(TEST_CANVAS_ID, pod.id)?.providerConfig).toEqual({
      model: "opus",
      thinkingLevel: "xhigh",
    });

    await handlePodSetModel(
      TEST_CONNECTION_ID,
      makeSetModelPayload(pod.id, "sonnet"),
      "req-test",
    );

    const after = podStore.getById(TEST_CANVAS_ID, pod.id);
    expect(after?.providerConfig).toEqual({
      model: "sonnet",
      thinkingLevel: "high",
    });
  });

  it("[B8] Sonnet(thinkingLevel=max) → Haiku：thinkingLevel 欄位應被移除（haiku 不支援）", async () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b8",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "sonnet", thinkingLevel: "max" },
    });

    await handlePodSetModel(
      TEST_CONNECTION_ID,
      makeSetModelPayload(pod.id, "haiku"),
      "req-test",
    );

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };
    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;
    expect(parsed.model).toBe("haiku");
    expect("thinkingLevel" in parsed).toBe(false);
  });

  it("[B9] Haiku → Opus：thinkingLevel 應寫入 opus 的 default 'high'", async () => {
    // 先用 sanitize 不支援欄位的 haiku 建立，再透過 SQL 確認沒有 thinkingLevel
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b9",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "haiku" },
    });
    patchThinkingLevel(pod.id, "haiku", null);

    await handlePodSetModel(
      TEST_CONNECTION_ID,
      makeSetModelPayload(pod.id, "opus"),
      "req-test",
    );

    const after = podStore.getById(TEST_CANVAS_ID, pod.id);
    expect(after?.providerConfig).toEqual({
      model: "opus",
      thinkingLevel: "high",
    });
  });

  it("[B10] Opus(thinkingLevel=max) → Opus（同 model）：thinkingLevel 應保留原值 'max'", async () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b10",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus", thinkingLevel: "max" },
    });

    await handlePodSetModel(
      TEST_CONNECTION_ID,
      makeSetModelPayload(pod.id, "opus"),
      "req-test",
    );

    const after = podStore.getById(TEST_CANVAS_ID, pod.id);
    expect(after?.providerConfig).toEqual({
      model: "opus",
      thinkingLevel: "max",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// [B11][B12] handlePodSetThinkingLevel：DB 持久化 + emit 完整 pod public view
// ════════════════════════════════════════════════════════════════════════

describe("handlePodSetThinkingLevel", () => {
  function makeSetThinkingPayload(
    podId: string,
    level: string,
  ): PodSetThinkingLevelPayload {
    return {
      requestId: "req-thinking",
      canvasId: TEST_CANVAS_ID,
      podId,
      level,
    };
  }

  it("[B11] handler 應將 payload.level 寫入 DB 的 providerConfig.thinkingLevel，並保留原 model", async () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b11",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "sonnet", thinkingLevel: "low" },
    });

    await handlePodSetThinkingLevel(
      TEST_CONNECTION_ID,
      makeSetThinkingPayload(pod.id, "max"),
      "req-thinking",
    );

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };
    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({ model: "sonnet", thinkingLevel: "max" });
  });

  it("[B12] handler 應 emitToCanvas POD_THINKING_LEVEL_SET，payload.pod 為完整 public view（含更新後 providerConfig）", async () => {
    const { pod } = podStore.create(TEST_CANVAS_ID, {
      name: "pod-b12",
      x: 10,
      y: 20,
      rotation: 5,
      provider: "claude",
      providerConfig: { model: "opus", thinkingLevel: "low" },
    });

    await handlePodSetThinkingLevel(
      TEST_CONNECTION_ID,
      makeSetThinkingPayload(pod.id, "xhigh"),
      "req-thinking",
    );

    // 至少要有一次 emitToCanvas 帶 POD_THINKING_LEVEL_SET 事件
    const matched = emitToCanvasMock.mock.calls.find(
      (call) => call[1] === WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
    );
    expect(matched).toBeDefined();
    const [emittedCanvasId, , emittedPayload] = matched as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(emittedCanvasId).toBe(TEST_CANVAS_ID);
    expect(emittedPayload.success).toBe(true);
    expect(emittedPayload.requestId).toBe("req-thinking");

    // payload.pod 應為完整 public view（不含 workspacePath / sessionId）
    const podView = emittedPayload.pod as Record<string, unknown>;
    expect(podView).toBeDefined();
    expect(podView.id).toBe(pod.id);
    expect(podView.name).toBe("pod-b12");
    expect(podView.providerConfig).toEqual({
      model: "opus",
      thinkingLevel: "xhigh",
    });
    // PodPublicView 已剝除 workspacePath / sessionId
    expect("workspacePath" in podView).toBe(false);
    expect("sessionId" in podView).toBe(false);
  });
});
