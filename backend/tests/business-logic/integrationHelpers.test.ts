/**
 * integrationHelpers 單元測試
 *
 * 保留合理 boundary mock：
 *   - socketService.emitToAll（WebSocket 邊界）
 *   - logger（side-effect only，不影響行為驗證）
 * 移除 integrationAppStore 自家 mock，改用 initTestDb + 真實 store。
 */

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToAll: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  broadcastConnectionStatus,
  destroyProvider,
  initializeProvider,
  formatIntegrationMessage,
  parseWebhookBody,
} from "../../src/services/integration/integrationHelpers.js";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import { socketService } from "../../src/services/socketService.js";
import { logger } from "../../src/utils/logger.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

const APP_ID = "app-test-1";
const PROVIDER = "slack";

/** 插入一筆 integration_apps 記錄（config_json 為純文字 JSON，不加密） */
function insertApp(id: string, provider: string = PROVIDER): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO integration_apps (id, provider, name, config_json)
             VALUES (?, ?, ?, '{}')`,
    )
    .run(id, provider, `Test App ${id}`);
}

describe("broadcastConnectionStatus", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  it("App 不存在時應提早 return，不呼叫 emitToAll", () => {
    // 不插入 app，模擬 getById 回傳 undefined
    broadcastConnectionStatus(PROVIDER, "app-not-found");

    expect(socketService.emitToAll).not.toHaveBeenCalled();
  });

  it("App 存在時應呼叫 emitToAll 並帶正確的 payload", () => {
    insertApp(APP_ID);
    // 設定 resources，透過 integrationAppStore.updateResources 寫入 runtimeState
    integrationAppStore.updateResources(APP_ID, [
      { id: "C001", name: "general" },
    ]);
    integrationAppStore.updateStatus(APP_ID, "connected");

    broadcastConnectionStatus(PROVIDER, APP_ID);

    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
      {
        provider: PROVIDER,
        appId: APP_ID,
        connectionStatus: "connected",
        resources: [{ id: "C001", name: "general" }],
      },
    );
  });
});

describe("destroyProvider", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  it("應從 clients Map 移除 appId", () => {
    insertApp(APP_ID);
    const clients = new Map<string, unknown>([[APP_ID, {}]]);

    destroyProvider(clients, APP_ID, PROVIDER, "Slack");

    expect(clients.has(APP_ID)).toBe(false);
  });

  it("應呼叫 updateStatus 設為 disconnected，透過 getById 確認 runtimeState", () => {
    insertApp(APP_ID);
    integrationAppStore.updateStatus(APP_ID, "connected");
    const clients = new Map<string, unknown>([[APP_ID, {}]]);

    destroyProvider(clients, APP_ID, PROVIDER, "Slack");

    const app = integrationAppStore.getById(APP_ID);
    expect(app?.connectionStatus).toBe("disconnected");
  });

  it("應呼叫 broadcastConnectionStatus（透過 emitToAll 確認）", () => {
    insertApp(APP_ID);
    const clients = new Map<string, unknown>([[APP_ID, {}]]);

    destroyProvider(clients, APP_ID, PROVIDER, "Slack");

    expect(socketService.emitToAll).toHaveBeenCalled();
  });

  it("應呼叫 logger.log", () => {
    insertApp(APP_ID);
    const clients = new Map<string, unknown>([[APP_ID, {}]]);

    destroyProvider(clients, APP_ID, PROVIDER, "Slack");

    expect(logger.log).toHaveBeenCalledWith(
      "Slack",
      "Complete",
      expect.stringContaining(APP_ID),
    );
  });
});

describe("initializeProvider", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  it("validateAndSetupFn 回傳 false 時，App 設為 error 並 broadcast", async () => {
    insertApp(APP_ID);
    const app = integrationAppStore.getById(APP_ID)!;
    const validateFn = vi.fn().mockResolvedValue(false);
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    await initializeProvider(app, validateFn, fetchFn, "Slack");

    const updated = integrationAppStore.getById(APP_ID)!;
    expect(updated.connectionStatus).toBe("error");
    expect(socketService.emitToAll).toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("validateAndSetupFn 回傳 true 時，執行 fetchResourcesFn、設為 connected 並 broadcast", async () => {
    insertApp(APP_ID);
    const app = integrationAppStore.getById(APP_ID)!;
    const validateFn = vi.fn().mockResolvedValue(true);
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    await initializeProvider(app, validateFn, fetchFn, "Slack");

    expect(fetchFn).toHaveBeenCalled();
    const updated = integrationAppStore.getById(APP_ID)!;
    expect(updated.connectionStatus).toBe("connected");
    expect(socketService.emitToAll).toHaveBeenCalled();
  });

  it("fetchResourcesFn 自行攔截錯誤（不拋出）時，connected 狀態仍正常設定", async () => {
    insertApp(APP_ID);
    const app = integrationAppStore.getById(APP_ID)!;
    const validateFn = vi.fn().mockResolvedValue(true);
    // fetchResourcesFn 需自行處理錯誤，不應拋出例外（由 caller 保證）
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    await initializeProvider(app, validateFn, fetchFn, "Slack");

    const updated = integrationAppStore.getById(APP_ID)!;
    expect(updated.connectionStatus).toBe("connected");
  });

  it("初始化成功時 broadcastConnectionStatus 收到的 provider 為小寫", async () => {
    insertApp(APP_ID, "slack");
    const app = integrationAppStore.getById(APP_ID)!;
    const validateFn = vi.fn().mockResolvedValue(true);
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    await initializeProvider(app, validateFn, fetchFn, "Slack");

    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
      expect.objectContaining({ provider: "slack" }),
    );
  });

  it("初始化失敗時 broadcastConnectionStatus 收到的 provider 為小寫", async () => {
    insertApp(APP_ID, "slack");
    const app = integrationAppStore.getById(APP_ID)!;
    const validateFn = vi.fn().mockResolvedValue(false);
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    await initializeProvider(app, validateFn, fetchFn, "Slack");

    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
      expect.objectContaining({ provider: "slack" }),
    );
  });
});

describe("formatIntegrationMessage", () => {
  it("一般輸入應產生正確格式", () => {
    const result = formatIntegrationMessage("Slack", "john", "hello world");

    expect(result).toBe("[Slack: @john] <user_data>hello world</user_data>");
  });

  it("含 < 和 > 特殊字元的輸入應被 escape", () => {
    const result = formatIntegrationMessage(
      "Slack",
      "user<admin>",
      "<script>alert(1)</script>",
    );

    expect(result).not.toContain("<admin>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("＜");
    expect(result).toContain("＞");
  });
});

describe("parseWebhookBody", () => {
  const MAX_SIZE = 1000;

  it("Content-Length 超過 maxBodySize 時回傳 413", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-length": String(MAX_SIZE + 1) },
      body: "{}",
    });

    const result = await parseWebhookBody(req, MAX_SIZE);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("Content-Length 為負值時回傳 413", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-length": "-1" },
      body: "{}",
    });

    const result = await parseWebhookBody(req, MAX_SIZE);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("Content-Length 為 NaN 時回傳 413", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
      body: "{}",
    });

    const result = await parseWebhookBody(req, MAX_SIZE);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("rawBody 實際長度超過 maxBodySize 時回傳 413", async () => {
    const bigBody = JSON.stringify({ data: "x".repeat(MAX_SIZE + 1) });
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      body: bigBody,
    });

    const result = await parseWebhookBody(req, MAX_SIZE);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("JSON 解析失敗時回傳 400", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      body: "not-valid-json",
    });

    const result = await parseWebhookBody(req, MAX_SIZE);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it("正常 JSON 時回傳 { rawBody, payload }", async () => {
    const body = { type: "test", value: 42 };
    const rawBody = JSON.stringify(body);
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-length": String(rawBody.length) },
      body: rawBody,
    });

    const result = await parseWebhookBody(req, MAX_SIZE);

    expect(result).not.toBeInstanceOf(Response);
    const parsed = result as { rawBody: string; payload: unknown };
    expect(parsed.rawBody).toBe(rawBody);
    expect(parsed.payload).toEqual(body);
  });

  it("無 Content-Length header 且 body 正常時回傳 { rawBody, payload }", async () => {
    const body = { hello: "world" };
    const rawBody = JSON.stringify(body);
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      body: rawBody,
    });

    const result = await parseWebhookBody(req, MAX_SIZE);

    expect(result).not.toBeInstanceOf(Response);
    const parsed = result as { rawBody: string; payload: unknown };
    expect(parsed.rawBody).toBe(rawBody);
    expect(parsed.payload).toEqual(body);
  });
});
