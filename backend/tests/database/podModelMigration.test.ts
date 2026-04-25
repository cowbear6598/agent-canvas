import { describe, it, expect } from "vitest";
import { Database } from "bun:sqlite";
import { createTables } from "../../src/database/schema.js";

/**
 * 測試 schema.ts migration 的冪等性：
 * 重複執行 createTables 不應拋出錯誤。
 *
 * 每個測試都使用獨立的 :memory: 資料庫，避免測試間互相干擾。
 */

describe("Schema migration 冪等性測試", () => {
  describe("pods.provider ADD COLUMN 冪等", () => {
    it("重複呼叫 createTables 不應拋出 provider 欄位已存在的錯誤", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      expect(() => createTables(db)).not.toThrow();
      expect(() => createTables(db)).not.toThrow();

      // 查詢不拋錯即表示欄位存在
      expect(() =>
        db.prepare("SELECT provider FROM pods LIMIT 0").get(),
      ).not.toThrow();

      db.close();
    });
  });

  describe("pods.provider_config_json ADD COLUMN 冪等", () => {
    it("重複呼叫 createTables 不應拋出 provider_config_json 欄位已存在的錯誤", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      expect(() => createTables(db)).not.toThrow();
      expect(() => createTables(db)).not.toThrow();

      expect(() =>
        db.prepare("SELECT provider_config_json FROM pods LIMIT 0").get(),
      ).not.toThrow();

      db.close();
    });
  });

  describe("pods.model DROP COLUMN 冪等", () => {
    it("重複呼叫 createTables（model 欄位已不存在）不應拋出錯誤", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      // 第一次建立（model 欄位不存在於新 schema，migration 嘗試 DROP 後靜默忽略）
      expect(() => createTables(db)).not.toThrow();
      // 第二次：欄位不存在，冪等不拋錯
      expect(() => createTables(db)).not.toThrow();

      db.close();
    });
  });

  describe("connections.summary_model / ai_decide_model ADD COLUMN 冪等", () => {
    it("重複呼叫 createTables 不應拋出 summary_model / ai_decide_model 欄位已存在的錯誤", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      expect(() => createTables(db)).not.toThrow();
      expect(() => createTables(db)).not.toThrow();

      expect(() =>
        db
          .prepare(
            "SELECT summary_model, ai_decide_model FROM connections LIMIT 0",
          )
          .get(),
      ).not.toThrow();

      db.close();
    });
  });

  describe("pods.output_style_id DROP COLUMN 冪等", () => {
    it("重複呼叫 createTables（output_style_id 欄位已不存在）不應拋出錯誤", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      expect(() => createTables(db)).not.toThrow();
      expect(() => createTables(db)).not.toThrow();

      db.close();
    });
  });

  describe("createTables 整體冪等性", () => {
    it("連續呼叫三次 createTables 不應拋出任何錯誤", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      expect(() => {
        createTables(db);
        createTables(db);
        createTables(db);
      }).not.toThrow();

      db.close();
    });
  });
});
