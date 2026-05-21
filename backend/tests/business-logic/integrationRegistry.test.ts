import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IntegrationRegistry } from "../../src/services/integration/integrationRegistry.js";
import type {
  IntegrationProvider,
  IntegrationApp,
  IntegrationResource,
  NormalizedEvent,
} from "../../src/services/integration/types.js";
import type { Result } from "../../src/types/index.js";
import { ok } from "../../src/types/index.js";

function makeProvider(name: string, withWebhook = false): IntegrationProvider {
  return {
    name,
    displayName: name,
    createAppSchema: z.object({}),
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
    ...(withWebhook ? { webhookPath: `/${name}/events` } : {}),
  };
}

describe("IntegrationRegistry", () => {
  describe("register", () => {
    it("成功註冊一個 Provider", () => {
      const registry = new IntegrationRegistry();
      const provider = makeProvider("slack");

      expect(() => registry.register(provider)).not.toThrow();
      expect(registry.get("slack")).toBe(provider);
    });

    it("重複註冊同名 Provider 應拋出錯誤", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeProvider("slack"));

      expect(() => registry.register(makeProvider("slack"))).toThrow("slack");
    });
  });

  describe("get", () => {
    it("取得已註冊的 Provider", () => {
      const registry = new IntegrationRegistry();
      const provider = makeProvider("telegram");
      registry.register(provider);

      expect(registry.get("telegram")).toBe(provider);
    });

    it("取得未註冊的 Provider 回傳 undefined", () => {
      const registry = new IntegrationRegistry();

      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("getOrThrow", () => {
    it("取得已存在的 Provider", () => {
      const registry = new IntegrationRegistry();
      const provider = makeProvider("jira");
      registry.register(provider);

      expect(registry.getOrThrow("jira")).toBe(provider);
    });

    it("取得不存在的 Provider 應拋出錯誤", () => {
      const registry = new IntegrationRegistry();

      expect(() => registry.getOrThrow("missing")).toThrow("missing");
    });
  });

  describe("list", () => {
    it("列出所有已註冊 Provider", () => {
      const registry = new IntegrationRegistry();
      const slack = makeProvider("slack");
      const telegram = makeProvider("telegram");
      registry.register(slack);
      registry.register(telegram);

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContain(slack);
      expect(list).toContain(telegram);
    });

    it("無 Provider 時回傳空陣列", () => {
      const registry = new IntegrationRegistry();

      expect(registry.list()).toEqual([]);
    });
  });

  describe("getWebhookRoutes", () => {
    it("只回傳有 webhookPath 的 Provider", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeProvider("telegram", false));
      registry.register(makeProvider("slack", true));
      registry.register(makeProvider("jira", true));

      const routes = registry.getWebhookRoutes();
      expect(routes).toHaveLength(2);
      expect(routes.map((r) => r.path)).toContain("/slack/events");
      expect(routes.map((r) => r.path)).toContain("/jira/events");
    });

    it("所有 Provider 都沒有 webhookPath 時回傳空陣列", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeProvider("telegram", false));

      expect(registry.getWebhookRoutes()).toEqual([]);
    });
  });
});
