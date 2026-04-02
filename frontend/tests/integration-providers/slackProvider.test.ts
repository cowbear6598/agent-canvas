import { describe, it, expect } from "vitest";
import { slackProviderConfig } from "@/integration/providers/slackProvider";

describe("slackProvider", () => {
  describe("transformApp", () => {
    it("id 從 rawApp.id 轉成字串", () => {
      const app = slackProviderConfig.transformApp({ id: 99, name: "mybot" });
      expect(app.id).toBe("99");
    });

    it("name 從 rawApp.name 轉成字串", () => {
      const app = slackProviderConfig.transformApp({
        id: "1",
        name: "slack-bot",
      });
      expect(app.name).toBe("slack-bot");
    });

    it("connectionStatus 預設為 disconnected", () => {
      const app = slackProviderConfig.transformApp({ id: "1", name: "bot" });
      expect(app.connectionStatus).toBe("disconnected");
    });

    it("connectionStatus 有值時沿用", () => {
      const app = slackProviderConfig.transformApp({
        id: "1",
        name: "bot",
        connectionStatus: "connected",
      });
      expect(app.connectionStatus).toBe("connected");
    });

    it("provider 固定為 slack", () => {
      const app = slackProviderConfig.transformApp({ id: "1", name: "bot" });
      expect(app.provider).toBe("slack");
    });

    it("resources 從 rawApp.resources 轉換", () => {
      const app = slackProviderConfig.transformApp({
        id: "1",
        name: "bot",
        resources: [
          { id: "C001", name: "general" },
          { id: "C002", name: "random" },
        ],
      });
      expect(app.resources).toHaveLength(2);
      expect(app.resources[0]).toEqual({ id: "C001", label: "#general" });
      expect(app.resources[1]).toEqual({ id: "C002", label: "#random" });
    });

    it("resources label 加上 # 前綴", () => {
      const app = slackProviderConfig.transformApp({
        id: "1",
        name: "bot",
        resources: [{ id: "C001", name: "announcements" }],
      });
      expect(app.resources[0]!.label).toBe("#announcements");
    });

    it("rawApp.resources 為 undefined 時 resources 為空陣列", () => {
      const app = slackProviderConfig.transformApp({ id: "1", name: "bot" });
      expect(app.resources).toEqual([]);
    });
  });

  describe("buildCreatePayload", () => {
    it("name 正確放入 payload", () => {
      const payload = slackProviderConfig.buildCreatePayload({
        name: "my-slack",
        botToken: "xoxb-1234",
        signingSecret: "secret123",
      });
      expect(payload.name).toBe("my-slack");
    });

    it("botToken 放入 config", () => {
      const payload = slackProviderConfig.buildCreatePayload({
        name: "my-slack",
        botToken: "xoxb-1234",
        signingSecret: "secret123",
      });
      expect((payload as any).config.botToken).toBe("xoxb-1234");
    });

    it("signingSecret 放入 config", () => {
      const payload = slackProviderConfig.buildCreatePayload({
        name: "my-slack",
        botToken: "xoxb-1234",
        signingSecret: "my-signing-secret",
      });
      expect((payload as any).config.signingSecret).toBe("my-signing-secret");
    });
  });

  describe("buildBindPayload", () => {
    it("appId 直接傳入", () => {
      const payload = slackProviderConfig.buildBindPayload(
        "app-abc",
        "C001",
        {},
      );
      expect(payload.appId).toBe("app-abc");
    });

    it("resourceId 直接傳入", () => {
      const payload = slackProviderConfig.buildBindPayload(
        "app-abc",
        "C001",
        {},
      );
      expect(payload.resourceId).toBe("C001");
    });
  });

  describe("createFormFields validate", () => {
    function getField(key: string) {
      return slackProviderConfig.createFormFields.find((f) => f.key === key)!;
    }

    describe("name 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("name").validate("")).not.toBe("");
      });

      it("非空字串通過驗證", () => {
        expect(getField("name").validate("my-slack")).toBe("");
      });
    });

    describe("botToken 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("botToken").validate("")).not.toBe("");
      });

      it("不以 xoxb- 開頭回傳錯誤訊息", () => {
        expect(getField("botToken").validate("invalid-token")).not.toBe("");
      });

      it("以 xoxb- 開頭通過驗證", () => {
        expect(getField("botToken").validate("xoxb-valid-token")).toBe("");
      });
    });

    describe("signingSecret 欄位", () => {
      it("空字串回傳錯誤訊息", () => {
        expect(getField("signingSecret").validate("")).not.toBe("");
      });

      it("非空字串通過驗證", () => {
        expect(getField("signingSecret").validate("abc123")).toBe("");
      });
    });
  });
});
