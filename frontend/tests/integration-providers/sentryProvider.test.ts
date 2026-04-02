import { describe, it, expect } from "vitest";
import { sentryProviderConfig } from "@/integration/providers/sentryProvider";

describe("sentryProvider", () => {
  describe("transformApp", () => {
    it("id 從 rawApp.id 轉成字串", () => {
      const app = sentryProviderConfig.transformApp({ id: 42, name: "test" });
      expect(app.id).toBe("42");
    });

    it("name 從 rawApp.name 轉成字串", () => {
      const app = sentryProviderConfig.transformApp({
        id: "1",
        name: "my-sentry",
      });
      expect(app.name).toBe("my-sentry");
    });

    it("connectionStatus 預設為 disconnected", () => {
      const app = sentryProviderConfig.transformApp({ id: "1", name: "test" });
      expect(app.connectionStatus).toBe("disconnected");
    });

    it("connectionStatus 有值時沿用", () => {
      const app = sentryProviderConfig.transformApp({
        id: "1",
        name: "test",
        connectionStatus: "connected",
      });
      expect(app.connectionStatus).toBe("connected");
    });

    it("provider 固定為 sentry", () => {
      const app = sentryProviderConfig.transformApp({ id: "1", name: "test" });
      expect(app.provider).toBe("sentry");
    });

    it("resources 為空陣列", () => {
      const app = sentryProviderConfig.transformApp({ id: "1", name: "test" });
      expect(app.resources).toEqual([]);
    });
  });

  describe("buildCreatePayload", () => {
    it("name 正確放入 payload", () => {
      const payload = sentryProviderConfig.buildCreatePayload({
        name: "my-sentry",
        clientSecret: "a".repeat(32),
      });
      expect(payload.name).toBe("my-sentry");
    });

    it("clientSecret 放入 config", () => {
      const secret = "b".repeat(32);
      const payload = sentryProviderConfig.buildCreatePayload({
        name: "my-sentry",
        clientSecret: secret,
      });
      expect((payload as any).config.clientSecret).toBe(secret);
    });
  });

  describe("buildBindPayload", () => {
    it("resourceId 固定為 *", () => {
      const payload = sentryProviderConfig.buildBindPayload(
        "app1",
        "ignored",
        {},
      );
      expect(payload.resourceId).toBe("*");
    });

    it("appId 正確傳入", () => {
      const payload = sentryProviderConfig.buildBindPayload("app-123", "*", {});
      expect(payload.appId).toBe("app-123");
    });
  });

  describe("getWebhookUrl", () => {
    it("回傳 /sentry/events/{name} 格式", () => {
      const fakeApp = sentryProviderConfig.transformApp({
        id: "1",
        name: "my-sentry",
      });
      const url = sentryProviderConfig.getWebhookUrl!(fakeApp);
      expect(url).toBe("/sentry/events/my-sentry");
    });
  });

  describe("createFormFields validate", () => {
    function getField(key: string) {
      return sentryProviderConfig.createFormFields.find((f) => f.key === key)!;
    }

    describe("name 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("name").validate("")).not.toBe("");
      });

      it("超過 50 字元回傳錯誤訊息", () => {
        expect(getField("name").validate("a".repeat(51))).not.toBe("");
      });

      it("50 字元以內合法字元通過驗證", () => {
        expect(getField("name").validate("valid-name_123")).toBe("");
      });

      it("含非法字元（空格）回傳錯誤訊息", () => {
        expect(getField("name").validate("invalid name")).not.toBe("");
      });

      it("含非法字元（@）回傳錯誤訊息", () => {
        expect(getField("name").validate("invalid@name")).not.toBe("");
      });
    });

    describe("clientSecret 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("clientSecret").validate("")).not.toBe("");
      });

      it("少於 32 個字元回傳錯誤訊息", () => {
        expect(getField("clientSecret").validate("a".repeat(31))).not.toBe("");
      });

      it("剛好 32 個字元通過驗證", () => {
        expect(getField("clientSecret").validate("a".repeat(32))).toBe("");
      });

      it("超過 32 個字元通過驗證", () => {
        expect(getField("clientSecret").validate("a".repeat(64))).toBe("");
      });
    });
  });
});
