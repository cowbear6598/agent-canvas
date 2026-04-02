import { describe, it, expect } from "vitest";
import { webhookProviderConfig } from "@/integration/providers/webhookProvider";

describe("webhookProvider", () => {
  describe("transformApp", () => {
    it("id 從 rawApp.id 轉成字串", () => {
      const app = webhookProviderConfig.transformApp({
        id: 5,
        name: "deploy-hook",
      });
      expect(app.id).toBe("5");
    });

    it("name 從 rawApp.name 轉成字串", () => {
      const app = webhookProviderConfig.transformApp({
        id: "1",
        name: "my-hook",
      });
      expect(app.name).toBe("my-hook");
    });

    it("connectionStatus 預設為 connected", () => {
      const app = webhookProviderConfig.transformApp({ id: "1", name: "hook" });
      expect(app.connectionStatus).toBe("connected");
    });

    it("connectionStatus 有值時沿用", () => {
      const app = webhookProviderConfig.transformApp({
        id: "1",
        name: "hook",
        connectionStatus: "error",
      });
      expect(app.connectionStatus).toBe("error");
    });

    it("provider 固定為 webhook", () => {
      const app = webhookProviderConfig.transformApp({ id: "1", name: "hook" });
      expect(app.provider).toBe("webhook");
    });

    it("resources 為空陣列", () => {
      const app = webhookProviderConfig.transformApp({ id: "1", name: "hook" });
      expect(app.resources).toEqual([]);
    });
  });

  describe("buildCreatePayload", () => {
    it("name 正確放入 payload", () => {
      const payload = webhookProviderConfig.buildCreatePayload({
        name: "deploy-hook",
      });
      expect(payload.name).toBe("deploy-hook");
    });

    it("config 為空物件", () => {
      const payload = webhookProviderConfig.buildCreatePayload({
        name: "deploy-hook",
      });
      expect((payload as any).config).toEqual({});
    });
  });

  describe("buildBindPayload", () => {
    it("resourceId 固定為 *", () => {
      const payload = webhookProviderConfig.buildBindPayload(
        "app1",
        "ignored",
        {},
      );
      expect(payload.resourceId).toBe("*");
    });

    it("appId 正確傳入", () => {
      const payload = webhookProviderConfig.buildBindPayload(
        "app-abc",
        "anything",
        {},
      );
      expect(payload.appId).toBe("app-abc");
    });
  });

  describe("getWebhookUrl", () => {
    it("回傳 /webhook/{name} 格式", () => {
      const fakeApp = webhookProviderConfig.transformApp({
        id: "1",
        name: "deploy-hook",
      });
      const url = webhookProviderConfig.getWebhookUrl!(fakeApp);
      expect(url).toBe("/webhook/deploy-hook");
    });
  });

  describe("getTokenValue", () => {
    it("raw.config.token 存在時回傳 token", () => {
      const fakeApp = webhookProviderConfig.transformApp({
        id: "1",
        name: "hook",
        config: { token: "my-secret-token" },
      });
      const token = webhookProviderConfig.getTokenValue!(fakeApp);
      expect(token).toBe("my-secret-token");
    });

    it("raw.config.token 不存在時回傳 null", () => {
      const fakeApp = webhookProviderConfig.transformApp({
        id: "1",
        name: "hook",
      });
      const token = webhookProviderConfig.getTokenValue!(fakeApp);
      expect(token).toBeNull();
    });
  });

  describe("createFormFields validate", () => {
    function getField(key: string) {
      return webhookProviderConfig.createFormFields.find((f) => f.key === key)!;
    }

    describe("name 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("name").validate("")).not.toBe("");
      });

      it("超過 50 字元回傳錯誤訊息", () => {
        expect(getField("name").validate("a".repeat(51))).not.toBe("");
      });

      it("50 字元以內合法字元通過驗證", () => {
        expect(getField("name").validate("deploy-hook_123")).toBe("");
      });

      it("含非法字元（空格）回傳錯誤訊息", () => {
        expect(getField("name").validate("invalid name")).not.toBe("");
      });

      it("含非法字元（@）回傳錯誤訊息", () => {
        expect(getField("name").validate("invalid@hook")).not.toBe("");
      });
    });
  });
});
