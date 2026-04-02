import { beforeEach, describe, expect, it } from "vitest";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import {
  resetStatements,
  getStatements,
} from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import { integrationRegistry } from "../../src/services/integration/integrationRegistry.js";
import { z } from "zod";
import type {
  IntegrationProvider,
  IntegrationApp,
  IntegrationResource,
  NormalizedEvent,
} from "../../src/services/integration/types.js";
import type { Result } from "../../src/types/index.js";
import { ok } from "../../src/types/index.js";

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

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToAll: vi.fn(),
    emitToCanvas: vi.fn(),
    emitToConnection: vi.fn(),
  },
}));

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getCanvasDir: vi.fn(() => "/tmp/test-canvas"),
    getById: vi.fn((id: string) => ({ id, name: "test-canvas", sortIndex: 0 })),
    list: vi.fn(() => [
      { id: "test-canvas-001", name: "test-canvas", sortIndex: 0 },
    ]),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeProvider(name: string): IntegrationProvider {
  return {
    name,
    displayName: name,
    createAppSchema: z.object({}),
    bindSchema: z.object({ resourceId: z.string() }),
    validateCreate(): Result<void> {
      return ok();
    },
    sanitizeConfig(): Record<string, unknown> {
      return {};
    },
    async initialize(_app: IntegrationApp): Promise<void> {},
    destroy(_appId: string): void {},
    destroyAll(): void {},
    async refreshResources(_appId: string): Promise<IntegrationResource[]> {
      return [];
    },
    formatEventMessage(
      _event: unknown,
      _app: IntegrationApp,
    ): NormalizedEvent | null {
      return null;
    },
  };
}

function setupTestCanvas(): string {
  const canvasId = "test-canvas-001";
  const stmts = getStatements(getDb());
  stmts.canvas.insert.run({
    $id: canvasId,
    $name: "test-canvas",
    $sortIndex: 0,
  });
  return canvasId;
}

describe("PodStore - Integration Binding", () => {
  let canvasId: string;
  let appId: string;

  beforeEach(() => {
    initTestDb();
    resetStatements();

    (
      integrationRegistry as unknown as {
        providers: Map<string, IntegrationProvider>;
      }
    ).providers.clear();
    integrationRegistry.register(makeProvider("slack"));
    integrationRegistry.register(makeProvider("telegram"));
    integrationRegistry.register(makeProvider("jira"));

    canvasId = setupTestCanvas();

    const result = integrationAppStore.create("slack", "Test Slack App", {
      botToken: "xoxb-test",
    });
    if (!result.success) throw new Error("Failed to create app");
    appId = result.data!.id;
  });

  afterEach(() => {
    closeDb();
  });

  function createTestPod(name: string) {
    const { pod } = podStore.create(canvasId, {
      name,
      x: 0,
      y: 0,
      rotation: 0,
    });
    return pod;
  }

  describe("addIntegrationBinding", () => {
    it("新增 binding 後 getById 可讀取", () => {
      const pod = createTestPod("pod-binding-read");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
      });

      const found = podStore.getById(canvasId, pod.id);
      const slackBinding = found?.integrationBindings?.find(
        (b) => b.provider === "slack",
      );
      expect(slackBinding).toBeDefined();
      expect(slackBinding?.appId).toBe(appId);
      expect(slackBinding?.resourceId).toBe("C12345");
    });

    it("相同 provider 的 binding 應覆蓋（upsert）", () => {
      const pod = createTestPod("pod-binding-upsert");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C11111",
      });

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C22222",
      });

      const found = podStore.getById(canvasId, pod.id);
      const slackBindings =
        found?.integrationBindings?.filter((b) => b.provider === "slack") ?? [];
      expect(slackBindings).toHaveLength(1);
      expect(slackBindings[0].resourceId).toBe("C22222");
    });

    it("extra JSON 正確序列化和反序列化", () => {
      const pod = createTestPod("pod-binding-extra");
      const extra = { threadTs: "1234567890.123456", chatType: "private" };

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
        extra,
      });

      const found = podStore.getById(canvasId, pod.id);
      const slackBinding = found?.integrationBindings?.find(
        (b) => b.provider === "slack",
      );
      expect(slackBinding?.extra).toEqual(extra);
    });
  });

  describe("removeIntegrationBinding", () => {
    it("移除後不再有該 provider binding", () => {
      const pod = createTestPod("pod-binding-remove");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
      });

      podStore.removeIntegrationBinding(canvasId, pod.id, "slack");

      const found = podStore.getById(canvasId, pod.id);
      const slackBinding = found?.integrationBindings?.find(
        (b) => b.provider === "slack",
      );
      expect(slackBinding).toBeUndefined();
    });

    it("移除不存在的 binding 不應拋出錯誤", () => {
      const pod = createTestPod("pod-binding-remove-nonexistent");

      expect(() => {
        podStore.removeIntegrationBinding(canvasId, pod.id, "slack");
      }).not.toThrow();
    });

    it("移除特定 provider 不影響其他 provider 的 binding", () => {
      const telegramResult = integrationAppStore.create(
        "telegram",
        "Test Telegram App",
        { botToken: "tg-token" },
      );
      const telegramAppId = telegramResult.data!.id;

      const pod = createTestPod("pod-binding-remove-selective");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
      });

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "telegram",
        appId: telegramAppId,
        resourceId: "999888",
      });

      podStore.removeIntegrationBinding(canvasId, pod.id, "slack");

      const found = podStore.getById(canvasId, pod.id);
      expect(
        found?.integrationBindings?.find((b) => b.provider === "slack"),
      ).toBeUndefined();
      expect(
        found?.integrationBindings?.find((b) => b.provider === "telegram"),
      ).toBeDefined();
    });
  });

  describe("findByIntegrationApp", () => {
    it("找到綁定該 appId 的所有 Pod", () => {
      const pod1 = createTestPod("pod-find-app-1");
      const pod2 = createTestPod("pod-find-app-2");
      const pod3 = createTestPod("pod-find-app-other");

      const otherResult = integrationAppStore.create(
        "slack",
        "Other Slack App",
        { botToken: "xoxb-other" },
      );
      const otherAppId = otherResult.data!.id;

      podStore.addIntegrationBinding(canvasId, pod1.id, {
        provider: "slack",
        appId,
        resourceId: "C1",
      });
      podStore.addIntegrationBinding(canvasId, pod2.id, {
        provider: "slack",
        appId,
        resourceId: "C2",
      });
      podStore.addIntegrationBinding(canvasId, pod3.id, {
        provider: "slack",
        appId: otherAppId,
        resourceId: "C3",
      });

      const boundPods = podStore.findByIntegrationApp(appId);
      const podIds = boundPods.map((p) => p.pod.id);

      expect(podIds).toContain(pod1.id);
      expect(podIds).toContain(pod2.id);
      expect(podIds).not.toContain(pod3.id);
    });

    it("無 Pod 綁定時回傳空陣列", () => {
      const result = podStore.findByIntegrationApp(appId);
      expect(result).toEqual([]);
    });
  });

  describe("findByIntegrationAppAndResource", () => {
    it("找到特定 appId + resourceId 的 Pod", () => {
      const pod1 = createTestPod("pod-find-resource-1");
      const pod2 = createTestPod("pod-find-resource-2");

      podStore.addIntegrationBinding(canvasId, pod1.id, {
        provider: "slack",
        appId,
        resourceId: "C-TARGET",
      });
      podStore.addIntegrationBinding(canvasId, pod2.id, {
        provider: "slack",
        appId,
        resourceId: "C-OTHER",
      });

      const result = podStore.findByIntegrationAppAndResource(
        appId,
        "C-TARGET",
      );
      const podIds = result.map((p) => p.pod.id);

      expect(podIds).toContain(pod1.id);
      expect(podIds).not.toContain(pod2.id);
    });

    it("不符合的 resourceId 回傳空陣列", () => {
      const pod = createTestPod("pod-find-resource-no-match");
      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C-EXIST",
      });

      const result = podStore.findByIntegrationAppAndResource(
        appId,
        "C-NONEXISTENT",
      );
      expect(result).toEqual([]);
    });
  });
});

describe("PodStore - resetAllBusyPods", () => {
  let canvasId: string;

  beforeEach(() => {
    initTestDb();
    resetStatements();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-reset";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-reset",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  function createTestPod(name: string) {
    const { pod } = podStore.create(canvasId, {
      name,
      x: 0,
      y: 0,
      rotation: 0,
    });
    return pod;
  }

  it("有 chatting/summarizing Pod 時應重設為 idle 並回傳正確數量", () => {
    const pod1 = createTestPod("pod-chatting");
    const pod2 = createTestPod("pod-summarizing");
    const pod3 = createTestPod("pod-idle");

    // 直接更新 DB 狀態，繞過 socketService 廣播
    getDb()
      .prepare("UPDATE pods SET status = 'chatting' WHERE id = ?")
      .run(pod1.id);
    getDb()
      .prepare("UPDATE pods SET status = 'summarizing' WHERE id = ?")
      .run(pod2.id);

    const count = podStore.resetAllBusyPods();

    expect(count).toBe(2);
    expect(podStore.getById(canvasId, pod1.id)?.status).toBe("idle");
    expect(podStore.getById(canvasId, pod2.id)?.status).toBe("idle");
    expect(podStore.getById(canvasId, pod3.id)?.status).toBe("idle");
  });

  it("無 busy Pod 時應回傳 0", () => {
    createTestPod("pod-idle-only");

    const count = podStore.resetAllBusyPods();

    expect(count).toBe(0);
  });

  it("idle Pod 不應被更動", () => {
    const pod = createTestPod("pod-stays-idle");

    podStore.resetAllBusyPods();

    expect(podStore.getById(canvasId, pod.id)?.status).toBe("idle");
  });
});
