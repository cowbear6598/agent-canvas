import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { createTables } from "../../src/database/schema.js";

/**
 * 測試 schema.ts 末段的 data migration：
 * 將 pods.model 搬移至 provider_config_json 的 { model } 欄位。
 *
 * 每個測試都使用獨立的 :memory: 資料庫，避免測試間互相干擾。
 */

/** 建立乾淨的 in-memory DB，僅建立 pods 相關基本表格（不跑 data migration）*/
function initRawDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");

  // 只建立 canvases 與 pods 基本表（不含 provider/provider_config_json 欄位，模擬舊版 schema）
  db.exec(
    "CREATE TABLE IF NOT EXISTS canvases (" +
      "id TEXT PRIMARY KEY," +
      "name TEXT NOT NULL UNIQUE," +
      "sort_index INTEGER NOT NULL DEFAULT 0" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS pods (" +
      "id TEXT PRIMARY KEY," +
      "canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE," +
      "name TEXT NOT NULL," +
      "status TEXT NOT NULL DEFAULT 'idle'," +
      "x REAL NOT NULL DEFAULT 0," +
      "y REAL NOT NULL DEFAULT 0," +
      "rotation REAL NOT NULL DEFAULT 0," +
      "model TEXT NOT NULL DEFAULT 'opus'," +
      "workspace_path TEXT NOT NULL," +
      "claude_session_id TEXT," +
      "repository_id TEXT," +
      "command_id TEXT," +
      "multi_instance INTEGER NOT NULL DEFAULT 0," +
      "schedule_json TEXT" +
      ")",
  );

  return db;
}

/** 在已有舊版 schema 的 DB 上插入一筆舊格式 pod（無 provider_config_json 欄位）*/
function insertOldPod(db: Database, id: string, model: string): void {
  db.exec(
    `INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas', 0)`,
  );
  db.exec(
    `INSERT INTO pods (id, canvas_id, name, model, workspace_path) VALUES ('${id}', 'c1', 'pod-${id}', '${model}', '/ws')`,
  );
}

// 歷史遷移驗證已於 2026-04 完成，pods.model 欄位已由 migration 移除（ALTER TABLE DROP COLUMN）。
// Case 2/4 試圖 INSERT model 欄位、Case 3 查詢 model IS NOT NULL，在新 schema 下均會拋出 SQLite 錯誤。
// 保留為歷史記錄，skip 以避免持續干擾測試結果。
describe.skip("Pod model → provider_config_json data migration", () => {
  describe("Case 1：舊資料搬移", () => {
    it("provider_config_json IS NULL 的舊 pod，跑 migration 後應被填成 {model:xxx}", () => {
      // 建立舊版 schema（無 provider/provider_config_json 欄位）
      const db = initRawDb();

      // 插入一筆舊 pod（model='sonnet'，無 provider_config_json 欄位）
      insertOldPod(db, "p1", "sonnet");

      // 執行 createTables，包含 ALTER TABLE 新增欄位及 data migration
      createTables(db);

      const row = db
        .prepare("SELECT provider_config_json FROM pods WHERE id = 'p1'")
        .get() as { provider_config_json: string | null };

      expect(row.provider_config_json).not.toBeNull();

      const parsed = JSON.parse(row.provider_config_json!) as { model: string };
      expect(parsed.model).toBe("sonnet");

      db.close();
    });
  });

  describe("Case 2：冪等性", () => {
    it("重複呼叫 createTables（migration 執行兩次），已有 providerConfig 的 row 不被覆蓋", () => {
      // 使用完整的 initTestDb 流程：第一次就已有 provider_config_json 欄位
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      // 第一次建立所有表格 + migration
      createTables(db);

      // 插入一筆已含 provider_config_json 的新式 pod
      db.exec(
        "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas', 0)",
      );
      db.exec(
        "INSERT INTO pods (id, canvas_id, name, model, workspace_path, provider_config_json) " +
          "VALUES ('p1', 'c1', 'pod1', 'opus', '/ws', '{\"model\":\"haiku\",\"extra\":\"keep\"}')",
      );

      // 第二次執行 migration（模擬重啟）
      createTables(db);

      const row = db
        .prepare("SELECT provider_config_json FROM pods WHERE id = 'p1'")
        .get() as { provider_config_json: string | null };

      expect(row.provider_config_json).not.toBeNull();

      const parsed = JSON.parse(row.provider_config_json!) as {
        model: string;
        extra: string;
      };
      // 既有 providerConfig 不應被覆蓋
      expect(parsed.model).toBe("haiku");
      expect(parsed.extra).toBe("keep");

      db.close();
    });
  });

  describe("Case 3：驗證查詢", () => {
    it("migration 後 COUNT(*)（provider_config_json IS NULL AND model IS NOT NULL）必須為 0", () => {
      // 建立舊版 schema，插入多筆舊 pod
      const db = initRawDb();

      db.exec(
        `INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas', 0)`,
      );
      db.exec(
        "INSERT INTO pods (id, canvas_id, name, model, workspace_path) VALUES " +
          "('p1', 'c1', 'pod1', 'sonnet', '/ws')," +
          "('p2', 'c1', 'pod2', 'haiku', '/ws')," +
          "('p3', 'c1', 'pod3', 'opus', '/ws')",
      );

      // 跑 migration
      createTables(db);

      const result = db
        .prepare(
          "SELECT COUNT(*) as count FROM pods WHERE provider_config_json IS NULL AND model IS NOT NULL",
        )
        .get() as { count: number };

      expect(result.count).toBe(0);

      db.close();
    });
  });

  describe("Case 4：不影響新 Pod", () => {
    it("provider_config_json 已有值的 row 在 migration 後不被動到（model 欄位保持原值，providerConfig 保持原值）", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA foreign_keys = ON");

      // 第一次建立表格
      createTables(db);

      // 插入一筆新式 pod（已有 provider_config_json，含 model 與其他 key）
      db.exec(
        "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas', 0)",
      );
      db.exec(
        "INSERT INTO pods (id, canvas_id, name, model, workspace_path, provider, provider_config_json) " +
          "VALUES ('p1', 'c1', 'pod1', 'opus', '/ws', 'claude', '{\"model\":\"sonnet\",\"temperature\":0.5}')",
      );

      // 再次執行 migration
      createTables(db);

      const row = db
        .prepare("SELECT model, provider_config_json FROM pods WHERE id = 'p1'")
        .get() as { model: string; provider_config_json: string };

      // pods.model 欄位不應被 migration 改動
      expect(row.model).toBe("opus");

      const parsed = JSON.parse(row.provider_config_json) as {
        model: string;
        temperature: number;
      };
      // providerConfig 不應被 migration 覆蓋
      expect(parsed.model).toBe("sonnet");
      expect(parsed.temperature).toBe(0.5);

      db.close();
    });
  });
});
