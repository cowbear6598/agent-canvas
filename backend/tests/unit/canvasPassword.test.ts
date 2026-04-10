import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { initTestDb, closeDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { canvasStore } from "../../src/services/canvasStore.js";

describe("CanvasStore 密碼方法", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  // 建立測試用 Canvas 的輔助函式
  async function createTestCanvas(name: string = "test-canvas") {
    const result = await canvasStore.create(name);
    if (!result.success)
      throw new Error(`建立測試 Canvas 失敗：${result.error}`);
    return result.data;
  }

  describe("setPassword", () => {
    it("對無密碼的 Canvas 設定密碼後，password_hash 不為 null", async () => {
      const canvas = await createTestCanvas();

      const result = await canvasStore.setPassword(canvas.id, "my-password");

      expect(result.success).toBe(true);

      // 從 DB 重新讀取，確認 hash 已儲存
      const updated = canvasStore.getById(canvas.id);
      expect(updated).toBeDefined();
      expect(updated!.passwordHash).not.toBeNull();
      expect(typeof updated!.passwordHash).toBe("string");
    });

    it("Canvas 不存在時回傳錯誤", async () => {
      const result = await canvasStore.setPassword(
        "non-existent-id",
        "password",
      );

      expect(result.success).toBe(false);
    });
  });

  describe("changePassword", () => {
    it("舊密碼正確時成功更新密碼", async () => {
      const canvas = await createTestCanvas("canvas-change-pw");
      await canvasStore.setPassword(canvas.id, "old-password");

      const oldHash = canvasStore.getById(canvas.id)!.passwordHash;

      const result = await canvasStore.changePassword(
        canvas.id,
        "old-password",
        "new-password",
      );

      expect(result.success).toBe(true);

      // 確認 hash 已更新（不同於舊 hash）
      const updated = canvasStore.getById(canvas.id);
      expect(updated!.passwordHash).not.toBeNull();
      expect(updated!.passwordHash).not.toBe(oldHash);
    });

    it("舊密碼錯誤時回傳錯誤", async () => {
      const canvas = await createTestCanvas("canvas-wrong-pw");
      await canvasStore.setPassword(canvas.id, "correct-password");

      const result = await canvasStore.changePassword(
        canvas.id,
        "wrong-password",
        "new-password",
      );

      expect(result.success).toBe(false);
    });

    it("Canvas 無密碼時回傳錯誤（沒有舊密碼可驗證）", async () => {
      // 建立未設定密碼的 Canvas
      const canvas = await createTestCanvas("canvas-no-pw");

      const result = await canvasStore.changePassword(
        canvas.id,
        "any-password",
        "new-password",
      );

      expect(result.success).toBe(false);
    });
  });

  describe("removePassword", () => {
    it("密碼正確時清除 password_hash 為 null", async () => {
      const canvas = await createTestCanvas("canvas-remove-pw");
      await canvasStore.setPassword(canvas.id, "the-password");

      const result = await canvasStore.removePassword(
        canvas.id,
        "the-password",
      );

      expect(result.success).toBe(true);

      // 確認 hash 已清除為 null
      const updated = canvasStore.getById(canvas.id);
      expect(updated!.passwordHash).toBeNull();
    });

    it("密碼錯誤時回傳錯誤", async () => {
      const canvas = await createTestCanvas("canvas-remove-wrong");
      await canvasStore.setPassword(canvas.id, "correct-password");

      const result = await canvasStore.removePassword(
        canvas.id,
        "wrong-password",
      );

      expect(result.success).toBe(false);

      // 確認密碼未被清除
      const updated = canvasStore.getById(canvas.id);
      expect(updated!.passwordHash).not.toBeNull();
    });
  });

  describe("verifyPassword", () => {
    it("密碼正確時回傳 true", async () => {
      const canvas = await createTestCanvas("canvas-verify-ok");
      await canvasStore.setPassword(canvas.id, "secret");

      const result = await canvasStore.verifyPassword(canvas.id, "secret");

      expect(result).toBe(true);
    });

    it("密碼錯誤時回傳 false", async () => {
      const canvas = await createTestCanvas("canvas-verify-fail");
      await canvasStore.setPassword(canvas.id, "secret");

      const result = await canvasStore.verifyPassword(
        canvas.id,
        "wrong-secret",
      );

      expect(result).toBe(false);
    });

    it("Canvas 無密碼時回傳 true（不鎖 = 不需驗證）", async () => {
      // 建立未設定密碼的 Canvas
      const canvas = await createTestCanvas("canvas-no-lock");

      const result = await canvasStore.verifyPassword(
        canvas.id,
        "any-password",
      );

      expect(result).toBe(true);
    });
  });

  describe("isLocked", () => {
    it("有密碼的 Canvas 回傳 true", async () => {
      const canvas = await createTestCanvas("canvas-locked");
      await canvasStore.setPassword(canvas.id, "my-password");

      const result = canvasStore.isLocked(canvas.id);

      expect(result).toBe(true);
    });

    it("無密碼的 Canvas 回傳 false", async () => {
      const canvas = await createTestCanvas("canvas-unlocked");

      const result = canvasStore.isLocked(canvas.id);

      expect(result).toBe(false);
    });
  });
});
