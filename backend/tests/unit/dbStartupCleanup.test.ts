/**
 * dbStartupCleanup unit test
 *
 * 驗證 cleanupLegacyAiDecideRows 能正確刪除
 * trigger_mode = 'ai-decide' 的舊版 connection 資料。
 *
 * 測試策略：
 * 1. 用 initTestDb() 取得乾淨的 in-memory DB（createTables 已被呼叫過一次，此時 table 是空的）
 * 2. 用 raw SQL INSERT 直接寫入 trigger_mode = 'ai-decide' 的 row
 *    （connections table 的 trigger_mode 欄位無 CHECK constraint，故可直接插入舊值）
 * 3. 呼叫 cleanupLegacyAiDecideRows(db) 並驗證回傳刪除筆數正確
 * 4. 確認 SELECT COUNT(*) WHERE trigger_mode = 'ai-decide' → 0
 * 5. 確認其他 trigger_mode 的 row 不受影響
 */

import { Database } from "bun:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, closeDb } from "../../src/database/index.js";
import { cleanupLegacyAiDecideRows } from "../../src/database/schema.js";

// 插入測試用 canvas（因 connections 有 REFERENCES canvases(id)）
function insertCanvas(db: Database, canvasId: string): void {
  db.exec(
    `INSERT INTO canvases (id, name, sort_index) VALUES ('${canvasId}', 'test-canvas-${canvasId}', 0)`,
  );
}

// 插入帶指定 trigger_mode 的 connection
function insertConnection(
  db: Database,
  id: string,
  canvasId: string,
  triggerMode: string,
): void {
  db.exec(
    `INSERT INTO connections
      (id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor, trigger_mode)
     VALUES
      ('${id}', '${canvasId}', 'pod-src', 'bottom', 'pod-dst', 'top', '${triggerMode}')`,
  );
}

// 查詢符合指定 trigger_mode 的筆數
function countByTriggerMode(db: Database, triggerMode: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM connections WHERE trigger_mode = '${triggerMode}'`,
    )
    .get() as { count: number };
  return row.count;
}

describe("cleanupLegacyAiDecideRows", () => {
  let db: Database;

  beforeEach(() => {
    db = initTestDb();
    // initTestDb 內部已呼叫 createTables（含 cleanupLegacyAiDecideRows），
    // 此時 DB 是乾淨的空資料庫，可安全 INSERT 測試資料。
    insertCanvas(db, "c1");
  });

  afterEach(() => {
    closeDb();
  });

  it("應刪除 trigger_mode = ai-decide 的 row 並回傳正確刪除筆數", () => {
    insertConnection(db, "conn-legacy-1", "c1", "ai-decide");
    insertConnection(db, "conn-legacy-2", "c1", "ai-decide");

    // 插入前確認資料已存在
    expect(countByTriggerMode(db, "ai-decide")).toBe(2);

    const deleted = cleanupLegacyAiDecideRows(db);

    expect(deleted).toBe(2);
    expect(countByTriggerMode(db, "ai-decide")).toBe(0);
  });

  it("不應刪除其他 trigger_mode 的 row", () => {
    insertConnection(db, "conn-legacy-3", "c1", "ai-decide");
    insertConnection(db, "conn-auto-1", "c1", "auto");
    insertConnection(db, "conn-manual-1", "c1", "manual");

    cleanupLegacyAiDecideRows(db);

    // ai-decide 全數刪除
    expect(countByTriggerMode(db, "ai-decide")).toBe(0);
    // auto 與 manual 不受影響
    expect(countByTriggerMode(db, "auto")).toBe(1);
    expect(countByTriggerMode(db, "manual")).toBe(1);
  });

  it("當沒有 ai-decide row 時應回傳 0", () => {
    insertConnection(db, "conn-auto-2", "c1", "auto");

    const deleted = cleanupLegacyAiDecideRows(db);

    expect(deleted).toBe(0);
    expect(countByTriggerMode(db, "auto")).toBe(1);
  });

  it("當 connections table 完全為空時應回傳 0", () => {
    const deleted = cleanupLegacyAiDecideRows(db);

    expect(deleted).toBe(0);
  });

  it("應能處理大量 ai-decide row 並全數刪除", () => {
    // 插入 10 筆 ai-decide + 3 筆 auto
    for (let i = 0; i < 10; i++) {
      insertConnection(db, `conn-bulk-legacy-${i}`, "c1", "ai-decide");
    }
    for (let i = 0; i < 3; i++) {
      insertConnection(db, `conn-bulk-auto-${i}`, "c1", "auto");
    }

    const deleted = cleanupLegacyAiDecideRows(db);

    expect(deleted).toBe(10);
    expect(countByTriggerMode(db, "ai-decide")).toBe(0);
    expect(countByTriggerMode(db, "auto")).toBe(3);
  });
});
