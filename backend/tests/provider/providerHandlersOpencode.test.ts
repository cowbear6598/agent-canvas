/**
 * provider:list handler — opencode 動態 availableModels 整合測試
 *
 * 使用真實 SQLite 記憶體資料庫（不 mock statements）。
 *
 * 驗證：
 *   (1) opencode entry 的 availableModels 等於 DB 內 alias rows 按 order_idx 升序組出的
 *       { label: alias, value: "real_provider/real_model", thinkingLevels: [], defaultThinkingLevel: null }
 *   (2) 其他三家 provider（claude / codex / gemini）的 availableModels
 *       仍是各自 metadata 寫死的內容，未受 opencode 改動影響
 *   (3) alias 表為空時 opencode entry 的 availableModels 為空陣列（F8 placeholder）
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

const { mockEmitToConnection } = vi.hoisted(() => ({
  mockEmitToConnection: vi.fn(),
}));

// mock socketService：WebSocket boundary
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
  },
}));

// mock schemas：提供測試用的 event name 常數
vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    PROVIDER_LIST_RESULT: "provider:list:result",
  },
}));

// ─── imports ──────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, closeDb } from "../../src/database/index.js";
import {
  getStatements,
  resetStatements,
} from "../../src/database/statements.js";
import { Database } from "bun:sqlite";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CONNECTION_ID = "conn-provider-opencode-test";
const REQUEST_ID = "req-provider-opencode-test";

// ─── Setup ────────────────────────────────────────────────────────────────────

let db: Database;

beforeEach(() => {
  vi.clearAllMocks();
  resetStatements();
  db = initTestDb();
});

afterEach(() => {
  closeDb();
});

// ─── 輔助函式 ─────────────────────────────────────────────────────────────────

const NOW = Date.now();

function insertAlias(
  id: string,
  alias: string,
  orderIdx: number,
  realProvider = "anthropic",
  realModel = "claude-3-5-sonnet",
  providerId = "opencode",
): void {
  const stmts = getStatements(db);
  stmts.modelAlias.insert.run({
    $id: id,
    $providerId: providerId,
    $realProvider: realProvider,
    $realModel: realModel,
    $alias: alias,
    $orderIdx: orderIdx,
    $createdAt: NOW,
    $updatedAt: NOW,
  });
}

async function callHandlerAndGetPayload(): Promise<{
  providers: Array<{
    name: string;
    availableModels: Array<{
      label: string;
      value: string;
      thinkingLevels: readonly string[];
      defaultThinkingLevel: string | null;
    }>;
    capabilities: Record<string, unknown>;
    defaultOptions: Record<string, unknown>;
  }>;
}> {
  // handleProviderList 是 async，需重新 import 以確保用同一個 DB 實例
  const { handleProviderList } =
    await import("../../src/handlers/providerHandlers.js");

  await handleProviderList(
    CONNECTION_ID,
    { requestId: REQUEST_ID },
    REQUEST_ID,
  );

  const [, , payload] = mockEmitToConnection.mock.calls[0];
  return payload;
}

// ─── 測試：opencode 動態 availableModels ───────────────────────────────────────

describe("provider:list — opencode 動態 availableModels（真實 SQLite DB）", () => {
  it("(F8) alias 表為空時 opencode entry 的 availableModels 應為空陣列", async () => {
    const payload = await callHandlerAndGetPayload();

    const opencode = payload.providers.find((p) => p.name === "opencode");
    expect(opencode).toBeDefined();
    expect(opencode!.availableModels).toEqual([]);
  });

  it("opencode 對應 entry 的 availableModels 等於 DB 內 alias rows 按 order_idx 升序的 { label, value }", async () => {
    // 故意以亂序插入，驗證結果以 order_idx 升序排列
    insertAlias("id-2", "Opus 4", 2, "anthropic", "claude-opus-4");
    insertAlias("id-0", "Sonnet 4.5", 0, "anthropic", "claude-sonnet-4-5");
    insertAlias("id-1", "GPT-5", 1, "openai", "gpt-5");

    const payload = await callHandlerAndGetPayload();

    const opencode = payload.providers.find((p) => p.name === "opencode");
    expect(opencode).toBeDefined();

    expect(opencode!.availableModels).toEqual([
      {
        label: "Sonnet 4.5",
        value: "anthropic/claude-sonnet-4-5",
        thinkingLevels: [],
        defaultThinkingLevel: null,
      },
      {
        label: "GPT-5",
        value: "openai/gpt-5",
        thinkingLevels: [],
        defaultThinkingLevel: null,
      },
      {
        label: "Opus 4",
        value: "anthropic/claude-opus-4",
        thinkingLevels: [],
        defaultThinkingLevel: null,
      },
    ]);
  });

  it("opencode availableModels 的 thinkingLevels 皆為 []、defaultThinkingLevel 皆為 null", async () => {
    insertAlias("id-1", "Sonnet", 0, "anthropic", "claude-sonnet-4-5");
    insertAlias("id-2", "GPT-5", 1, "openai", "gpt-5");

    const payload = await callHandlerAndGetPayload();

    const opencode = payload.providers.find((p) => p.name === "opencode");
    expect(opencode).toBeDefined();

    for (const model of opencode!.availableModels) {
      expect(model.thinkingLevels).toEqual([]);
      expect(model.defaultThinkingLevel).toBeNull();
    }
  });
});

// ─── 測試：非 opencode provider 不受 DB 影響 ─────────────────────────────────

describe("provider:list — claude / codex / gemini availableModels 不受 opencode DB 影響", () => {
  it("claude 的 availableModels 仍是 metadata 寫死的 sonnet / opus / haiku，未受 DB 影響", async () => {
    // 在 DB 插入 opencode alias，確認 claude 不受影響
    insertAlias("id-1", "Sonnet", 0, "anthropic", "claude-sonnet-4-5");

    const payload = await callHandlerAndGetPayload();

    const claude = payload.providers.find((p) => p.name === "claude");
    expect(claude).toBeDefined();

    // claude 應有 metadata 寫死的 sonnet / opus / haiku（label/value 不含 opencode alias）
    const values = claude!.availableModels.map((m) => m.value);
    expect(values).toContain("sonnet");
    expect(values).toContain("opus");
    expect(values).toContain("haiku");
    // 不應包含 opencode alias 的 value 格式（"anthropic/..."）
    expect(values.some((v) => v.includes("/"))).toBe(false);
  });

  it("codex 的 availableModels 仍是 metadata 寫死的內容（不含 opencode alias）", async () => {
    insertAlias("id-1", "GPT-5", 0, "openai", "gpt-5");

    const payload = await callHandlerAndGetPayload();

    const codex = payload.providers.find((p) => p.name === "codex");
    expect(codex).toBeDefined();

    const values = codex!.availableModels.map((m) => m.value);
    // codex 的 value 應為 gpt-5.4 / gpt-5.5 / gpt-5.4-mini 等寫死值
    expect(values.every((v) => !v.includes("/"))).toBe(true);
    // 不應包含 opencode 動態注入的 "openai/gpt-5"
    expect(values).not.toContain("openai/gpt-5");
  });

  it("gemini 的 availableModels 仍是 metadata 寫死的內容（不含 opencode alias）", async () => {
    insertAlias("id-1", "Gemini Flash", 0, "google", "gemini-2.5-flash");

    const payload = await callHandlerAndGetPayload();

    const gemini = payload.providers.find((p) => p.name === "gemini");
    expect(gemini).toBeDefined();

    const values = gemini!.availableModels.map((m) => m.value);
    expect(values).toContain("gemini-2.5-flash");
    // 不應包含 opencode alias 的 "google/gemini-2.5-flash" 格式
    expect(values).not.toContain("google/gemini-2.5-flash");
  });

  it("四個 provider 都應出現在 providers 陣列內", async () => {
    const payload = await callHandlerAndGetPayload();

    const names = payload.providers.map((p) => p.name);
    expect(names).toContain("claude");
    expect(names).toContain("codex");
    expect(names).toContain("gemini");
    expect(names).toContain("opencode");
  });
});
