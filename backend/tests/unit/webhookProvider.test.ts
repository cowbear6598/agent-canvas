import type { Mock } from "vitest";

vi.mock("../../src/services/integration/integrationAppStore.js", () => ({
  integrationAppStore: {
    getByProviderAndName: vi.fn(() => undefined),
    getById: vi.fn(() => undefined),
    list: vi.fn(() => []),
    updateStatus: vi.fn(),
  },
}));

vi.mock("../../src/services/integration/integrationEventPipeline.js", () => ({
  integrationEventPipeline: {
    processEvent: vi.fn(() => Promise.resolve()),
    safeProcessEvent: vi.fn(),
  },
}));

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

import { webhookProvider } from "../../src/services/integration/providers/webhook/webhookProvider.js";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import type { IntegrationApp } from "../../src/services/integration/types.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

const STORED_TOKEN = "a".repeat(64);

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
  return {
    id: "app-webhook-1",
    name: "my-webhook",
    provider: "webhook",
    config: {
      token: STORED_TOKEN,
    },
    connectionStatus: "connected",
    resources: [],
    ...overrides,
  };
}

function buildBearerRequest(
  body: object,
  token: string,
  appName: string,
): Request {
  return new Request(`http://localhost/webhook/${appName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const validPayload = { event: "test", data: { key: "value" } };

// ───────────────────────────────────────────────
// createAppSchema 測試
// ───────────────────────────────────────────────

describe("WebhookProvider - createAppSchema", () => {
  it("空物件應通過驗證", () => {
    const result = webhookProvider.createAppSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ───────────────────────────────────────────────
// validateCreate 測試
// ───────────────────────────────────────────────

describe("WebhookProvider - validateCreate", () => {
  it("未提供 name 應通過驗證", () => {
    const result = webhookProvider.validateCreate({});
    expect(result.success).toBe(true);
  });

  it("合法的 name 應通過驗證", () => {
    const result = webhookProvider.validateCreate({
      name: "my-webhook_app123",
    });
    expect(result.success).toBe(true);
  });

  it("name 含非法字元（空白）應回傳錯誤", () => {
    const result = webhookProvider.validateCreate({ name: "invalid name!" });
    expect(result.success).toBe(false);
  });

  it("name 超過 50 字元應回傳錯誤", () => {
    const result = webhookProvider.validateCreate({ name: "a".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("name 剛好 50 字元應通過驗證", () => {
    const result = webhookProvider.validateCreate({ name: "a".repeat(50) });
    expect(result.success).toBe(true);
  });
});

// ───────────────────────────────────────────────
// sanitizeConfig 測試
// ───────────────────────────────────────────────

describe("WebhookProvider - sanitizeConfig", () => {
  it("應只回傳含 token 的物件", () => {
    const config = { token: "abc123", secret: "should-not-appear" };
    const result = webhookProvider.sanitizeConfig(config);
    expect(result.token).toBe("abc123");
    expect(Object.keys(result)).toEqual(["token"]);
  });
});

// ───────────────────────────────────────────────
// getExtraDbFields 測試
// ───────────────────────────────────────────────

describe("WebhookProvider - getExtraDbFields", () => {
  it("應回傳含 token 的物件", () => {
    const result = webhookProvider.getExtraDbFields({});
    expect(result).toHaveProperty("token");
  });

  it("token 應為 64 字元 hex 字串", () => {
    const result = webhookProvider.getExtraDbFields({});
    expect(typeof result.token).toBe("string");
    expect((result.token as string).length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(result.token as string)).toBe(true);
  });

  it("每次呼叫應產生不同的 token", () => {
    const r1 = webhookProvider.getExtraDbFields({});
    const r2 = webhookProvider.getExtraDbFields({});
    expect(r1.token).not.toBe(r2.token);
  });
});

// ───────────────────────────────────────────────
// formatEventMessage 測試
// ───────────────────────────────────────────────

describe("WebhookProvider - formatEventMessage", () => {
  it("合法 payload 應回傳 NormalizedEvent，provider 為 webhook、resourceId 為 *", () => {
    const app = makeApp();
    const result = webhookProvider.formatEventMessage(validPayload, app);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("webhook");
    expect(result?.resourceId).toBe("*");
    expect(result?.text).toContain(JSON.stringify(validPayload, null, 2));
  });

  it("null 應回傳 null", () => {
    const app = makeApp();
    const result = webhookProvider.formatEventMessage(null, app);
    expect(result).toBeNull();
  });

  it("undefined 應回傳 null", () => {
    const app = makeApp();
    const result = webhookProvider.formatEventMessage(undefined, app);
    expect(result).toBeNull();
  });
});

// ───────────────────────────────────────────────
// initialize / destroy 測試
// ───────────────────────────────────────────────

describe("WebhookProvider - initialize", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("應將 App 狀態更新為 connected", async () => {
    const app = makeApp();
    await webhookProvider.initialize(app);
    expect(asMock(integrationAppStore.updateStatus)).toHaveBeenCalledWith(
      app.id,
      "connected",
    );
  });
});

describe("WebhookProvider - destroy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("應將 App 狀態更新為 disconnected", () => {
    const app = makeApp();
    webhookProvider.destroy(app.id);
    expect(asMock(integrationAppStore.updateStatus)).toHaveBeenCalledWith(
      app.id,
      "disconnected",
    );
  });
});

// ───────────────────────────────────────────────
// handleWebhookRequest 測試
// ───────────────────────────────────────────────

describe("WebhookProvider - handleWebhookRequest subPath 與 App 查找", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("subPath 為空應回傳 404", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload),
    });

    const res = await webhookProvider.handleWebhookRequest(req);
    expect(res.status).toBe(404);
  });

  it("找不到 App 應回傳 404", async () => {
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(undefined);

    const req = buildBearerRequest(validPayload, STORED_TOKEN, "nonexistent");
    const res = await webhookProvider.handleWebhookRequest(req, "nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("WebhookProvider - handleWebhookRequest 認證驗證", () => {
  const appName = "my-webhook";

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("缺少 Authorization header 應回傳 401", async () => {
    const req = new Request(`http://localhost/webhook/${appName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload),
    });

    const res = await webhookProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(401);
  });

  it("Authorization 格式不符（非 Bearer）應回傳 401", async () => {
    const req = new Request(`http://localhost/webhook/${appName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic abc123",
      },
      body: JSON.stringify(validPayload),
    });

    const res = await webhookProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(401);
  });

  it("Bearer token 錯誤應回傳 401", async () => {
    const req = buildBearerRequest(validPayload, "wrong-token", appName);
    const res = await webhookProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(401);
  });

  it("Bearer token 長度不同但內容不同應回傳 401（timing-safe）", async () => {
    // 測試 token 長度不同時也能正確拒絕（不因長度差異拋例外而誤判）
    const req = buildBearerRequest(validPayload, "short-wrong-token", appName);
    const res = await webhookProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(401);
  });
});

describe("WebhookProvider - handleWebhookRequest 正常流程", () => {
  const appName = "my-webhook";

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("Bearer token 正確 + 合法 JSON 應回傳 200 且觸發 safeProcessEvent", async () => {
    const { integrationEventPipeline } =
      await import("../../src/services/integration/integrationEventPipeline.js");

    const req = buildBearerRequest(validPayload, STORED_TOKEN, appName);
    const res = await webhookProvider.handleWebhookRequest(req, appName);

    expect(res.status).toBe(200);
    expect(
      asMock(integrationEventPipeline.safeProcessEvent),
    ).toHaveBeenCalledOnce();

    const [providerName, , normalizedEvent] = asMock(
      integrationEventPipeline.safeProcessEvent,
    ).mock.calls[0];
    expect(providerName).toBe("webhook");
    expect(normalizedEvent.resourceId).toBe("*");
  });
});

describe("WebhookProvider - handleWebhookRequest 去重防護", () => {
  const appName = "my-webhook";

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("相同 body 第二次請求應回傳 200 但 safeProcessEvent 不被呼叫", async () => {
    const { integrationEventPipeline } =
      await import("../../src/services/integration/integrationEventPipeline.js");

    // 使用獨特 body 避免與其他測試的 dedup 狀態衝突
    const uniqueBody = {
      event: "dedup-test",
      ts: Date.now(),
      unique: Math.random().toString(36),
    };

    const makeReq = () => buildBearerRequest(uniqueBody, STORED_TOKEN, appName);

    await webhookProvider.handleWebhookRequest(makeReq(), appName);
    asMock(integrationEventPipeline.safeProcessEvent).mockClear();

    const res2 = await webhookProvider.handleWebhookRequest(makeReq(), appName);
    expect(res2.status).toBe(200);
    expect(
      asMock(integrationEventPipeline.safeProcessEvent),
    ).not.toHaveBeenCalled();
  });
});

describe("WebhookProvider - handleWebhookRequest Body 大小限制", () => {
  const appName = "my-webhook";

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("content-length 超過 1_000_000 應回傳 413", async () => {
    const req = new Request(`http://localhost/webhook/${appName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${STORED_TOKEN}`,
        "content-length": "1000001",
      },
      body: "{}",
    });

    const res = await webhookProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(413);
  });
});
