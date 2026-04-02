import { describe, it, expect } from "vitest";
import { telegramProviderConfig } from "@/integration/providers/telegramProvider";

describe("telegramProvider", () => {
  describe("transformApp", () => {
    it("id 從 rawApp.id 轉成字串", () => {
      const app = telegramProviderConfig.transformApp({
        id: 7,
        name: "mybot",
        botUsername: "mybot_bot",
      });
      expect(app.id).toBe("7");
    });

    it("name 從 rawApp.name 轉成字串", () => {
      const app = telegramProviderConfig.transformApp({
        id: "1",
        name: "telegram-bot",
        botUsername: "test_bot",
      });
      expect(app.name).toBe("telegram-bot");
    });

    it("connectionStatus 預設為 disconnected", () => {
      const app = telegramProviderConfig.transformApp({
        id: "1",
        name: "bot",
        botUsername: "bot",
      });
      expect(app.connectionStatus).toBe("disconnected");
    });

    it("connectionStatus 有值時沿用", () => {
      const app = telegramProviderConfig.transformApp({
        id: "1",
        name: "bot",
        botUsername: "bot",
        connectionStatus: "connected",
      });
      expect(app.connectionStatus).toBe("connected");
    });

    it("provider 固定為 telegram", () => {
      const app = telegramProviderConfig.transformApp({
        id: "1",
        name: "bot",
        botUsername: "bot",
      });
      expect(app.provider).toBe("telegram");
    });

    it("resources 為空陣列", () => {
      const app = telegramProviderConfig.transformApp({
        id: "1",
        name: "bot",
        botUsername: "bot",
      });
      expect(app.resources).toEqual([]);
    });

    it("raw 只含 botUsername", () => {
      const app = telegramProviderConfig.transformApp({
        id: "1",
        name: "bot",
        botUsername: "mybot_bot",
        extra: "should-not-appear",
      });
      expect(app.raw).toEqual({ botUsername: "mybot_bot" });
      expect((app.raw as any).extra).toBeUndefined();
    });
  });

  describe("buildCreatePayload", () => {
    it("name 正確放入 payload", () => {
      const payload = telegramProviderConfig.buildCreatePayload({
        name: "my-telegram",
        botToken: "123456:ABC-DEF",
      });
      expect(payload.name).toBe("my-telegram");
    });

    it("botToken 放入 config", () => {
      const payload = telegramProviderConfig.buildCreatePayload({
        name: "my-telegram",
        botToken: "123456:ABC-DEF",
      });
      expect((payload as any).config.botToken).toBe("123456:ABC-DEF");
    });
  });

  describe("buildBindPayload", () => {
    it("appId 正確傳入", () => {
      const payload = telegramProviderConfig.buildBindPayload(
        "app-xyz",
        "12345",
        {},
      );
      expect(payload.appId).toBe("app-xyz");
    });

    it("resourceId 正確傳入", () => {
      const payload = telegramProviderConfig.buildBindPayload(
        "app-xyz",
        "12345",
        {},
      );
      expect(payload.resourceId).toBe("12345");
    });

    it("extra 包含 chatType: private", () => {
      const payload = telegramProviderConfig.buildBindPayload(
        "app-xyz",
        "12345",
        {},
      );
      expect((payload as any).extra).toEqual({ chatType: "private" });
    });
  });

  describe("manualResourceInputConfig validate", () => {
    function getValidate() {
      return telegramProviderConfig.manualResourceInputConfig!.validate;
    }

    it("空字串回傳錯誤訊息", () => {
      expect(getValidate()("")).not.toBe("");
    });

    it("非數字字串回傳錯誤訊息", () => {
      expect(getValidate()("abc")).not.toBe("");
    });

    it("零回傳錯誤訊息", () => {
      expect(getValidate()("0")).not.toBe("");
    });

    it("負數回傳錯誤訊息", () => {
      expect(getValidate()("-1")).not.toBe("");
    });

    it("正整數通過驗證", () => {
      expect(getValidate()("123456")).toBe("");
    });
  });

  describe("createFormFields validate", () => {
    function getField(key: string) {
      return telegramProviderConfig.createFormFields.find(
        (f) => f.key === key,
      )!;
    }

    describe("name 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("name").validate("")).not.toBe("");
      });

      it("非空字串通過驗證", () => {
        expect(getField("name").validate("my-bot")).toBe("");
      });
    });

    describe("botToken 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("botToken").validate("")).not.toBe("");
      });

      it("非空字串通過驗證", () => {
        expect(getField("botToken").validate("123456:ABC-DEF")).toBe("");
      });
    });
  });
});
