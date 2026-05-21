import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { config } from "../../src/config/index.js";
import { closeDb, initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { handleInternalIntegrationReply } from "../../src/api/internalIntegrationReplyApi.js";
import { canvasStore } from "../../src/services/canvasStore.js";
import { encryptionService } from "../../src/services/encryptionService.js";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import { createIntegrationReplyCapability } from "../../src/services/integration/integrationReplyCapability.js";
import { executeIntegrationReply } from "../../src/services/integration/integrationReplyService.js";
import { integrationRegistry } from "../../src/services/integration/integrationRegistry.js";
import { podStore } from "../../src/services/podStore.js";
import { err, ok, type Result } from "../../src/types/index.js";
import type {
  IntegrationApp,
  IntegrationProvider,
  IntegrationResource,
  NormalizedEvent,
} from "../../src/services/integration/types.js";

function clearIntegrationRegistry(): void {
  (
    integrationRegistry as unknown as {
      providers: Map<string, IntegrationProvider>;
    }
  ).providers.clear();
}

function createProvider(
  sendMessage = vi.fn().mockResolvedValue(ok(undefined)),
): IntegrationProvider {
  return {
    name: "reply-test",
    displayName: "Reply Test",
    createAppSchema: z.object({}),
    validateCreate: vi.fn().mockReturnValue(ok(undefined) as Result<void>),
    sanitizeConfig: vi.fn().mockReturnValue({}),
    initialize: vi.fn(async (_app: IntegrationApp) => undefined),
    destroy: vi.fn((_appId: string) => undefined),
    destroyAll: vi.fn(() => undefined),
    refreshResources: vi.fn(
      async (_appId: string): Promise<IntegrationResource[]> => [],
    ),
    sendMessage,
    formatEventMessage: vi.fn(
      (_event: unknown, _app: IntegrationApp): NormalizedEvent | null => null,
    ),
  };
}

async function createReplyFixture(sendMessage = vi.fn().mockResolvedValue(ok())) {
  const provider = createProvider(sendMessage);
  integrationRegistry.register(provider);

  const appResult = integrationAppStore.create("reply-test", "Reply App", {});
  if (!appResult.success) {
    throw new Error(`Failed to create integration app: ${appResult.error}`);
  }

  const canvasResult = await canvasStore.create("reply-canvas");
  if (!canvasResult.success) {
    throw new Error(`Failed to create canvas: ${canvasResult.error}`);
  }
  await mkdir(config.getCanvasPath(canvasResult.data.name), { recursive: true });

  const { pod } = podStore.create(canvasResult.data.id, {
    name: "Reply Pod",
    x: 0,
    y: 0,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "sonnet" },
  });
  podStore.addIntegrationBinding(canvasResult.data.id, pod.id, {
    provider: "reply-test",
    appId: appResult.data.id,
    resourceId: "resource-1",
    extra: { keep: "extra", threadTs: "from-extra" },
  });

  const capabilityToken = createIntegrationReplyCapability({
    provider: "reply-test",
    appId: appResult.data.id,
    resourceId: "resource-1",
    podId: pod.id,
    extra: { keep: "extra", threadTs: "from-extra" },
    replyContext: { senderId: "U123456", threadTs: "from-context" },
  });

  return { appId: appResult.data.id, capabilityToken, sendMessage };
}

describe("Integration Reply Service", () => {
  beforeEach(async () => {
    closeDb();
    initTestDb();
    resetStatements();
    podStore.__clearCacheForTesting();
    clearIntegrationRegistry();
    await encryptionService.initializeKey();
    await mkdir(config.canvasRoot, { recursive: true });
  });

  afterEach(() => {
    clearIntegrationRegistry();
    podStore.__clearCacheForTesting();
    closeDb();
  });

  it("驗證 capability token 與 pod binding 後，使用主 backend provider 發送訊息", async () => {
    const sendMessage = vi.fn().mockResolvedValue(ok(undefined));
    const fixture = await createReplyFixture(sendMessage);

    const result = await executeIntegrationReply(
      fixture.capabilityToken,
      " hello ",
    );

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      fixture.appId,
      "resource-1",
      "hello",
      {
        keep: "extra",
        senderId: "U123456",
        threadTs: "from-context",
      },
    );
  });

  it("capability token 無效時不呼叫 provider", async () => {
    const sendMessage = vi.fn().mockResolvedValue(ok(undefined));
    await createReplyFixture(sendMessage);

    const result = await executeIntegrationReply("invalid-token", "hello");

    expect(result.success).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("pod binding 不存在時拒絕回覆", async () => {
    const sendMessage = vi.fn().mockResolvedValue(ok(undefined));
    const fixture = await createReplyFixture(sendMessage);
    podStore.removeIntegrationBinding("unused-canvas-id", "missing-pod", "noop");

    const invalidBindingToken = createIntegrationReplyCapability({
      provider: "reply-test",
      appId: fixture.appId,
      resourceId: "resource-1",
      podId: "missing-pod",
      extra: {},
      replyContext: {},
    });

    const result = await executeIntegrationReply(invalidBindingToken, "hello");

    expect(result.success).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("provider 回傳錯誤時轉為 service error", async () => {
    const sendMessage = vi.fn().mockResolvedValue(err("send failed"));
    const fixture = await createReplyFixture(sendMessage);

    const result = await executeIntegrationReply(
      fixture.capabilityToken,
      "hello",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("send failed");
  });

  it("internal API handler 成功時回傳 success JSON", async () => {
    const fixture = await createReplyFixture();
    const response = await handleInternalIntegrationReply(
      new Request("http://localhost/api/internal/integration-reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "1",
        },
        body: JSON.stringify({
          capabilityToken: fixture.capabilityToken,
          text: "hello",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("internal API handler 缺少必要欄位時回傳 400", async () => {
    const response = await handleInternalIntegrationReply(
      new Request("http://localhost/api/internal/integration-reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "1",
        },
        body: JSON.stringify({ capabilityToken: "token", text: " " }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "capabilityToken 與 text 為必填",
    });
  });
});
