import type { Mock } from "vitest";
import { createHmac } from "crypto";

vi.mock("../../src/services/integration/integrationAppStore.js", () => ({
  integrationAppStore: {
    getByProviderAndName: vi.fn(() => undefined),
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

import { sentryProvider } from "../../src/services/integration/providers/sentry/sentryProvider.js";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import type { IntegrationApp } from "../../src/services/integration/types.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

const CLIENT_SECRET = "a".repeat(32);

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
  return {
    id: "app-sentry-1",
    name: "test-app",
    provider: "sentry",
    config: {
      clientSecret: CLIENT_SECRET,
    },
    connectionStatus: "connected",
    resources: [],
    ...overrides,
  };
}

function buildValidPayload(actionOverride: string = "created"): object {
  return {
    action: actionOverride,
    data: {
      issue: {
        title: "TypeError: Cannot read property 'foo' of undefined",
        culprit: "src/utils/foo.ts in bar",
        metadata: { type: "TypeError" },
        web_url: "https://sentry.io/organizations/test/issues/123/",
      },
      project: {
        name: "my-project",
        slug: "my-project",
      },
    },
  };
}

function buildSignedRequest(
  payload: object,
  clientSecret: string,
  extraHeaders: Record<string, string> = {},
  overrideSignature?: string,
): Request {
  const rawBody = JSON.stringify(payload);
  const hmac = createHmac("sha256", clientSecret).update(rawBody).digest("hex");
  const signature = overrideSignature ?? hmac;

  return new Request("http://localhost/sentry/events/test-app", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "sentry-hook-resource": "issue",
      "sentry-hook-signature": signature,
      ...extraHeaders,
    },
    body: rawBody,
  });
}

// ───────────────────────────────────────────────
// createAppSchema 測試
// ───────────────────────────────────────────────

describe("SentryProvider - createAppSchema", () => {
  it("建立 Sentry App 成功（clientSecret >= 32 字元）", () => {
    const result = sentryProvider.createAppSchema.safeParse({
      clientSecret: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it("Client Secret 為空字串應驗證失敗", () => {
    const result = sentryProvider.createAppSchema.safeParse({
      clientSecret: "",
    });
    expect(result.success).toBe(false);
  });

  it("Client Secret 長度不足 32 字元應驗證失敗", () => {
    const result = sentryProvider.createAppSchema.safeParse({
      clientSecret: "short",
    });
    expect(result.success).toBe(false);
  });
});

// ───────────────────────────────────────────────
// bindSchema 測試
// ───────────────────────────────────────────────

describe("SentryProvider - bindSchema", () => {
  it("綁定 Sentry App 到 Pod 成功（resourceId 為 *）", () => {
    const result = sentryProvider.bindSchema.safeParse({ resourceId: "*" });
    expect(result.success).toBe(true);
  });

  it("resourceId 非 * 應驗證失敗", () => {
    const result = sentryProvider.bindSchema.safeParse({
      resourceId: "other-id",
    });
    expect(result.success).toBe(false);
  });
});

// ───────────────────────────────────────────────
// handleWebhookRequest 測試
// ───────────────────────────────────────────────

describe("SentryProvider - handleWebhookRequest issue.created 事件觸發", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("收到合法 issue.created 事件應回傳 200 且觸發 safeProcessEvent", async () => {
    const { integrationEventPipeline } =
      await import("../../src/services/integration/integrationEventPipeline.js");
    const payload = buildValidPayload("created");
    const req = buildSignedRequest(payload, CLIENT_SECRET);

    const res = await sentryProvider.handleWebhookRequest(req, "test-app");

    expect(res.status).toBe(200);
    expect(
      asMock(integrationEventPipeline.safeProcessEvent),
    ).toHaveBeenCalledOnce();
  });
});

describe("SentryProvider - handleWebhookRequest 簽章驗證", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("簽章驗證失敗應回傳 403", async () => {
    const payload = buildValidPayload("created");
    const req = buildSignedRequest(
      payload,
      CLIENT_SECRET,
      {},
      "wrong-signature",
    );

    const res = await sentryProvider.handleWebhookRequest(req, "test-app");

    expect(res.status).toBe(403);
  });

  it("缺少 sentry-hook-signature header 應回傳 403", async () => {
    const payload = buildValidPayload("created");
    const rawBody = JSON.stringify(payload);

    const req = new Request("http://localhost/sentry/events/test-app", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sentry-hook-resource": "issue",
        // 故意不帶 sentry-hook-signature
      },
      body: rawBody,
    });

    const res = await sentryProvider.handleWebhookRequest(req, "test-app");

    expect(res.status).toBe(403);
  });
});

describe("SentryProvider - handleWebhookRequest 非 created action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("action 為 resolved 應回傳 200 但不觸發 safeProcessEvent", async () => {
    const { integrationEventPipeline } =
      await import("../../src/services/integration/integrationEventPipeline.js");
    const payload = buildValidPayload("resolved");
    const req = buildSignedRequest(payload, CLIENT_SECRET);

    const res = await sentryProvider.handleWebhookRequest(req, "test-app");

    expect(res.status).toBe(200);
    expect(
      asMock(integrationEventPipeline.safeProcessEvent),
    ).not.toHaveBeenCalled();
  });
});

describe("SentryProvider - handleWebhookRequest subPath 與 App 查找", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("subPath 為空字串應回傳 404", async () => {
    const payload = buildValidPayload("created");
    const req = buildSignedRequest(payload, CLIENT_SECRET);

    const res = await sentryProvider.handleWebhookRequest(req, "");

    expect(res.status).toBe(404);
  });

  it("找不到 App 應回傳 404", async () => {
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(undefined);

    const payload = buildValidPayload("created");
    const req = buildSignedRequest(payload, CLIENT_SECRET);

    const res = await sentryProvider.handleWebhookRequest(
      req,
      "nonexistent-app",
    );

    expect(res.status).toBe(404);
  });
});

describe("SentryProvider - handleWebhookRequest Body 大小限制", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("content-length 超過 1_000_000 應回傳 413", async () => {
    const req = new Request("http://localhost/sentry/events/test-app", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sentry-hook-resource": "issue",
        "sentry-hook-signature": "somesig",
        "content-length": "1000001",
      },
      body: "{}",
    });

    const res = await sentryProvider.handleWebhookRequest(req, "test-app");

    expect(res.status).toBe(413);
  });
});

describe("SentryProvider - handleWebhookRequest 無效 JSON", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(makeApp());
  });

  it("無效 JSON body 應回傳 400", async () => {
    const rawBody = "not json";
    const hmac = createHmac("sha256", CLIENT_SECRET)
      .update(rawBody)
      .digest("hex");

    const req = new Request("http://localhost/sentry/events/test-app", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sentry-hook-resource": "issue",
        "sentry-hook-signature": hmac,
      },
      body: rawBody,
    });

    const res = await sentryProvider.handleWebhookRequest(req, "test-app");

    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────
// formatEventMessage 測試
// ───────────────────────────────────────────────

describe("SentryProvider - formatEventMessage", () => {
  it("正確提取 issue 資訊，回傳包含 title、provider 為 sentry、resourceId 為 *", () => {
    const app = makeApp();
    const payload = buildValidPayload("created");

    const result = sentryProvider.formatEventMessage(payload, app);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("sentry");
    expect(result?.resourceId).toBe("*");
    expect(result?.text).toContain(
      "TypeError: Cannot read property 'foo' of undefined",
    );
  });

  it("收到無效 payload（空物件）應回傳 null", () => {
    const app = makeApp();

    const result = sentryProvider.formatEventMessage({}, app);

    expect(result).toBeNull();
  });
});
