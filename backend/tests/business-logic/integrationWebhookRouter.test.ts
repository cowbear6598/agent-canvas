import type { Mock } from "vitest";
import type { IntegrationProvider } from "../../src/services/integration/types.js";

vi.mock("../../src/services/integration/integrationRegistry.js", () => ({
  integrationRegistry: {
    getWebhookRoutes: vi.fn(() => []),
  },
}));

import {
  handleIntegrationWebhook,
  buildWebhookRoutes,
} from "../../src/services/integration/integrationWebhookRouter.js";
import { integrationRegistry } from "../../src/services/integration/integrationRegistry.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

function makeProvider(
  overrides: Partial<IntegrationProvider> = {},
): IntegrationProvider {
  return {
    name: "test",
    displayName: "Test",
    createAppSchema: {} as IntegrationProvider["createAppSchema"],
    validateCreate: vi.fn(),
    sanitizeConfig: vi.fn(),
    initialize: vi.fn(),
    destroy: vi.fn(),
    destroyAll: vi.fn(),
    refreshResources: vi.fn(),
    formatEventMessage: vi.fn(),
    webhookPath: "/test/events",
    handleWebhookRequest: vi.fn(() =>
      Promise.resolve(new Response("OK", { status: 200 })),
    ),
    ...overrides,
  };
}

// 每個 describe 前需重置 webhookRoutes 快取，
// 因為 buildWebhookRoutes 會快取結果，透過 vi.resetModules 無法清除，
// 所以直接在 beforeEach 重新設定 mock 並重建路由
function setupRoutes(providers: IntegrationProvider[]): void {
  asMock(integrationRegistry.getWebhookRoutes).mockReturnValue(
    providers
      .filter((p) => p.webhookPath)
      .map((p) => ({ path: p.webhookPath as string, provider: p })),
  );
}

describe("integrationWebhookRouter - 精確匹配", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("精確匹配路由應呼叫對應 provider 並回傳 200", async () => {
    const provider = makeProvider({ webhookPath: "/slack/events" });
    setupRoutes([provider]);

    // 強制重建快取
    const { buildWebhookRoutes: rebuild, handleIntegrationWebhook: handle } =
      await import(
        "../../src/services/integration/integrationWebhookRouter.js?t=" +
          Date.now()
      );

    const routes = rebuild();
    expect(routes.has("/slack/events")).toBe(true);

    const req = new Request("http://localhost/slack/events", {
      method: "POST",
    });
    const res = await handle(req, "/slack/events");
    expect(res?.status).toBe(200);
    expect(provider.handleWebhookRequest).toHaveBeenCalledWith(req);
  });

  it("不存在的路徑應回傳 null", async () => {
    setupRoutes([]);

    const { handleIntegrationWebhook: handle } = await import(
      "../../src/services/integration/integrationWebhookRouter.js?t=" +
        Date.now() +
        "2"
    );

    const req = new Request("http://localhost/nonexistent", { method: "POST" });
    const res = await handle(req, "/nonexistent");
    expect(res).toBeNull();
  });
});

describe("integrationWebhookRouter - 前綴匹配", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("前綴匹配應擷取 subPath 並呼叫 handleWebhookRequest", async () => {
    const handleFn = vi.fn(() =>
      Promise.resolve(new Response("OK", { status: 200 })),
    );
    const provider = makeProvider({
      webhookPath: "/jira/events",
      webhookPathMatchMode: "prefix",
      handleWebhookRequest: handleFn,
    });
    setupRoutes([provider]);

    const { handleIntegrationWebhook: handle } = await import(
      "../../src/services/integration/integrationWebhookRouter.js?t=" +
        Date.now() +
        "3"
    );

    const req = new Request("http://localhost/jira/events/my-app", {
      method: "POST",
    });
    const res = await handle(req, "/jira/events/my-app");
    expect(res?.status).toBe(200);
    expect(handleFn).toHaveBeenCalledWith(req, "my-app");
  });

  it("前綴匹配但無 appName 子路徑不應匹配", async () => {
    const handleFn = vi.fn(() =>
      Promise.resolve(new Response("OK", { status: 200 })),
    );
    const provider = makeProvider({
      webhookPath: "/jira/events",
      webhookPathMatchMode: "prefix",
      handleWebhookRequest: handleFn,
    });
    setupRoutes([provider]);

    const { handleIntegrationWebhook: handle } = await import(
      "../../src/services/integration/integrationWebhookRouter.js?t=" +
        Date.now() +
        "4"
    );

    const req = new Request("http://localhost/jira/events", { method: "POST" });
    const res = await handle(req, "/jira/events");
    expect(res).toBeNull();
    expect(handleFn).not.toHaveBeenCalled();
  });

  it("exact 模式的 provider 不應前綴匹配", async () => {
    const handleFn = vi.fn(() =>
      Promise.resolve(new Response("OK", { status: 200 })),
    );
    const provider = makeProvider({
      webhookPath: "/slack/events",
      webhookPathMatchMode: "exact",
      handleWebhookRequest: handleFn,
    });
    setupRoutes([provider]);

    const { handleIntegrationWebhook: handle } = await import(
      "../../src/services/integration/integrationWebhookRouter.js?t=" +
        Date.now() +
        "5"
    );

    const req = new Request("http://localhost/slack/events/extra", {
      method: "POST",
    });
    const res = await handle(req, "/slack/events/extra");
    expect(res).toBeNull();
    expect(handleFn).not.toHaveBeenCalled();
  });

  it("未設定 webhookPathMatchMode 的 provider 不應前綴匹配", async () => {
    const handleFn = vi.fn(() =>
      Promise.resolve(new Response("OK", { status: 200 })),
    );
    const provider = makeProvider({
      webhookPath: "/telegram/events",
      handleWebhookRequest: handleFn,
    });
    setupRoutes([provider]);

    const { handleIntegrationWebhook: handle } = await import(
      "../../src/services/integration/integrationWebhookRouter.js?t=" +
        Date.now() +
        "6"
    );

    const req = new Request("http://localhost/telegram/events/extra", {
      method: "POST",
    });
    const res = await handle(req, "/telegram/events/extra");
    expect(res).toBeNull();
    expect(handleFn).not.toHaveBeenCalled();
  });
});
