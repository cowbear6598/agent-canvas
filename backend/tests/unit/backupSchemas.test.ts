import {
  backupTriggerSchema,
  backupTestConnectionSchema,
} from "../../src/schemas/backupSchemas.js";
import { configUpdateSchema } from "../../src/schemas/configSchemas.js";

describe("backupSchemas", () => {
  describe("backupTriggerSchema 驗證", () => {
    it("requestId 必填時驗證通過", () => {
      const result = backupTriggerSchema.safeParse({ requestId: "123" });
      expect(result.success).toBe(true);
    });

    it("缺少 requestId 時驗證失敗", () => {
      const result = backupTriggerSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("gitRemoteUrl 為 https:// 開頭時驗證通過", () => {
      const result = backupTriggerSchema.safeParse({
        requestId: "123",
        gitRemoteUrl: "https://github.com/user/backup.git",
      });
      expect(result.success).toBe(true);
    });

    it("gitRemoteUrl 為 git@ 開頭時驗證通過", () => {
      const result = backupTriggerSchema.safeParse({
        requestId: "123",
        gitRemoteUrl: "git@github.com:user/backup.git",
      });
      expect(result.success).toBe(true);
    });

    it("gitRemoteUrl 格式不合法時驗證失敗", () => {
      const result = backupTriggerSchema.safeParse({
        requestId: "123",
        gitRemoteUrl: "invalid-url",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("backupTestConnectionSchema 驗證", () => {
    it("requestId 必填且 URL 合法時驗證通過", () => {
      const result = backupTestConnectionSchema.safeParse({
        requestId: "123",
        gitRemoteUrl: "https://github.com/user/backup.git",
      });
      expect(result.success).toBe(true);
    });

    it("缺少 requestId 時驗證失敗", () => {
      const result = backupTestConnectionSchema.safeParse({
        gitRemoteUrl: "https://github.com/user/backup.git",
      });
      expect(result.success).toBe(false);
    });

    it("gitRemoteUrl 格式不合法時驗證失敗", () => {
      const result = backupTestConnectionSchema.safeParse({
        requestId: "123",
        gitRemoteUrl: "not-a-valid-url",
      });
      expect(result.success).toBe(false);
    });

    it("gitRemoteUrl 為 git@ 開頭時驗證通過", () => {
      const result = backupTestConnectionSchema.safeParse({
        requestId: "123",
        gitRemoteUrl: "git@github.com:user/backup.git",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("configUpdateSchema backupTime 驗證", () => {
    it("合法時間 00:00 驗證通過", () => {
      const result = configUpdateSchema.safeParse({
        requestId: "123",
        backupTime: "00:00",
      });
      expect(result.success).toBe(true);
    });

    it("合法時間 23:59 驗證通過", () => {
      const result = configUpdateSchema.safeParse({
        requestId: "123",
        backupTime: "23:59",
      });
      expect(result.success).toBe(true);
    });

    it("合法時間 12:30 驗證通過", () => {
      const result = configUpdateSchema.safeParse({
        requestId: "123",
        backupTime: "12:30",
      });
      expect(result.success).toBe(true);
    });

    it("無效時間 25:00 驗證失敗", () => {
      const result = configUpdateSchema.safeParse({
        requestId: "123",
        backupTime: "25:00",
      });
      expect(result.success).toBe(false);
    });

    it("無效時間 12:60 驗證失敗", () => {
      const result = configUpdateSchema.safeParse({
        requestId: "123",
        backupTime: "12:60",
      });
      expect(result.success).toBe(false);
    });

    it("無效時間 99:99 驗證失敗", () => {
      const result = configUpdateSchema.safeParse({
        requestId: "123",
        backupTime: "99:99",
      });
      expect(result.success).toBe(false);
    });
  });
});
