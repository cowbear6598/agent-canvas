/**
 * schema-migration 單元測試
 *
 * 測試對象：
 *   - migratePodsDropMultiInstance：移除 pods 表的舊 multi_instance 欄位
 *   - migrateDropMessagesTable：移除舊 messages 表及其 index
 *
 * 策略：
 *   - 使用 bun:sqlite in-memory DB 建立含舊 schema 的資料庫
 *   - 呼叫 createTables（其內部執行所有 migration）
 *   - 以 PRAGMA table_info / sqlite_master 驗證欄位 / 表已移除
 *
 * Mock 邊界：
 *   - 必須使用 bun:sqlite 真實 in-memory DB
 *   - 不可 mock db.prepare / db.exec
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { createTables } from "../../src/database/schema.js";

// ─── 輔助函式 ─────────────────────────────────────────────────────────────────

/** 取得指定表的所有欄位名稱 */
function getColumnNames(db: Database, tableName: string): string[] {
  const rows = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return rows.map((r) => r.name);
}

/** 取得所有使用者建立的表名稱 */
function getTableNames(db: Database): string[] {
  const rows = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 取得指定 index 名稱（若存在回傳 true，否則回傳 false） */
function indexExists(db: Database, indexName: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(indexName) as { name: string } | null;
  return row !== null;
}

// ─── migratePodsDropMultiInstance ───────────────────────────────────────────

describe("migratePodsDropMultiInstance：移除 pods.multi_instance 舊欄位", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = OFF");
  });

  afterEach(() => {
    db.close();
  });

  it("舊 DB 含 multi_instance 欄位，migration 後欄位不存在", () => {
    // 建立含 multi_instance 的舊 pods 表（簡化版，不含 FK，方便 in-memory 測試）
    db.exec(
      "CREATE TABLE pods (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL," +
        "name TEXT NOT NULL," +
        "x REAL NOT NULL DEFAULT 0," +
        "y REAL NOT NULL DEFAULT 0," +
        "rotation REAL NOT NULL DEFAULT 0," +
        "workspace_path TEXT NOT NULL," +
        "session_id TEXT," +
        "repository_id TEXT," +
        "command_id TEXT," +
        "multi_instance INTEGER NOT NULL DEFAULT 0," + // 舊欄位
        "schedule_json TEXT," +
        "provider TEXT NOT NULL DEFAULT 'claude'," +
        "provider_config_json TEXT," +
        "UNIQUE (canvas_id, name)" +
        ")",
    );

    // 確認舊欄位存在
    expect(getColumnNames(db, "pods")).toContain("multi_instance");

    // 執行 createTables（包含 migratePodsDropMultiInstance）
    createTables(db);

    // 驗證 multi_instance 已被移除
    expect(getColumnNames(db, "pods")).not.toContain("multi_instance");
  });

  it("新 DB 不含 multi_instance 欄位，migration 後仍不存在（idempotent）", () => {
    // 建立不含 multi_instance 的乾淨 pods 表
    db.exec(
      "CREATE TABLE pods (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL," +
        "name TEXT NOT NULL," +
        "x REAL NOT NULL DEFAULT 0," +
        "y REAL NOT NULL DEFAULT 0," +
        "rotation REAL NOT NULL DEFAULT 0," +
        "workspace_path TEXT NOT NULL," +
        "session_id TEXT," +
        "repository_id TEXT," +
        "command_id TEXT," +
        "schedule_json TEXT," +
        "provider TEXT NOT NULL DEFAULT 'claude'," +
        "provider_config_json TEXT," +
        "UNIQUE (canvas_id, name)" +
        ")",
    );

    // 確認欄位原本就不存在
    expect(getColumnNames(db, "pods")).not.toContain("multi_instance");

    // 執行 createTables，不應拋出錯誤
    expect(() => createTables(db)).not.toThrow();

    // 驗證欄位依然不存在
    expect(getColumnNames(db, "pods")).not.toContain("multi_instance");
  });

  it("含 multi_instance 資料的舊 DB，migration 後現有資料列仍保留（其他欄位不受影響）", () => {
    db.exec(
      "CREATE TABLE canvases (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_index INTEGER NOT NULL DEFAULT 0)",
    );
    db.exec(
      "CREATE TABLE pods (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL REFERENCES canvases(id)," +
        "name TEXT NOT NULL," +
        "x REAL NOT NULL DEFAULT 0," +
        "y REAL NOT NULL DEFAULT 0," +
        "rotation REAL NOT NULL DEFAULT 0," +
        "workspace_path TEXT NOT NULL," +
        "session_id TEXT," +
        "repository_id TEXT," +
        "command_id TEXT," +
        "multi_instance INTEGER NOT NULL DEFAULT 0," +
        "schedule_json TEXT," +
        "provider TEXT NOT NULL DEFAULT 'claude'," +
        "provider_config_json TEXT," +
        "UNIQUE (canvas_id, name)" +
        ")",
    );

    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'test', 0)",
    );
    db.exec(
      "INSERT INTO pods (id, canvas_id, name, workspace_path, multi_instance) " +
        "VALUES ('p1', 'c1', 'pod1', '/ws', 1)",
    );

    // migration 前確認資料存在
    const before = db.query("SELECT COUNT(*) as cnt FROM pods").get() as {
      cnt: number;
    };
    expect(before.cnt).toBe(1);

    createTables(db);

    // migration 後資料列仍在
    const after = db.query("SELECT COUNT(*) as cnt FROM pods").get() as {
      cnt: number;
    };
    expect(after.cnt).toBe(1);

    // multi_instance 欄位已移除
    expect(getColumnNames(db, "pods")).not.toContain("multi_instance");
  });
});

describe("migratePodsGoalColumn：補上 pods.goal_json 欄位", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = OFF");
  });

  afterEach(() => {
    db.close();
  });

  it("舊 DB 不含 goal_json 時，migration 後應補上欄位", () => {
    db.exec(
      "CREATE TABLE pods (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL," +
        "name TEXT NOT NULL," +
        "x REAL NOT NULL DEFAULT 0," +
        "y REAL NOT NULL DEFAULT 0," +
        "rotation REAL NOT NULL DEFAULT 0," +
        "workspace_path TEXT NOT NULL," +
        "session_id TEXT," +
        "repository_id TEXT," +
        "command_id TEXT," +
        "schedule_json TEXT," +
        "provider TEXT NOT NULL DEFAULT 'claude'," +
        "provider_config_json TEXT," +
        "UNIQUE (canvas_id, name)" +
        ")",
    );

    expect(getColumnNames(db, "pods")).not.toContain("goal_json");

    createTables(db);

    expect(getColumnNames(db, "pods")).toContain("goal_json");
  });
});

describe("replace-command-with-goal Phase 1 migration", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = OFF");
  });

  afterEach(() => {
    db.close();
  });

  it("應清空舊 command 綁定並將 gemini / summary 設定遷移到 claude sonnet", () => {
    db.exec(
      "CREATE TABLE canvases (" +
        "id TEXT PRIMARY KEY," +
        "name TEXT NOT NULL UNIQUE," +
        "sort_index INTEGER NOT NULL DEFAULT 0" +
        ")",
    );
    db.exec(
      "CREATE TABLE pods (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL," +
        "name TEXT NOT NULL," +
        "x REAL NOT NULL DEFAULT 0," +
        "y REAL NOT NULL DEFAULT 0," +
        "rotation REAL NOT NULL DEFAULT 0," +
        "workspace_path TEXT NOT NULL," +
        "session_id TEXT," +
        "repository_id TEXT," +
        "command_id TEXT," +
        "schedule_json TEXT," +
        "provider TEXT NOT NULL DEFAULT 'claude'," +
        "provider_config_json TEXT," +
        "UNIQUE (canvas_id, name)" +
        ")",
    );
    db.exec(
      "CREATE TABLE connections (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL," +
        "source_pod_id TEXT NOT NULL," +
        "source_anchor TEXT NOT NULL," +
        "target_pod_id TEXT NOT NULL," +
        "target_anchor TEXT NOT NULL," +
        "trigger_mode TEXT NOT NULL DEFAULT 'auto'," +
        "decide_status TEXT NOT NULL DEFAULT 'none'," +
        "decide_reason TEXT," +
        "connection_status TEXT NOT NULL DEFAULT 'idle'," +
        "summary_model TEXT NOT NULL DEFAULT 'sonnet'," +
        "summary_provider TEXT" +
        ")",
    );
    db.exec(
      "CREATE TABLE notes (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL," +
        "type TEXT NOT NULL," +
        "name TEXT NOT NULL," +
        "x REAL NOT NULL DEFAULT 0," +
        "y REAL NOT NULL DEFAULT 0," +
        "bound_to_pod_id TEXT," +
        "original_position_json TEXT," +
        "foreign_key_id TEXT" +
        ")",
    );
    db.exec(
      "CREATE TABLE pod_manifests (" +
        "pod_id TEXT NOT NULL," +
        "repository_id TEXT NOT NULL," +
        "files_json TEXT NOT NULL DEFAULT '[]'," +
        "PRIMARY KEY (pod_id, repository_id)" +
        ")",
    );

    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas', 0)",
    );
    db.exec(
      "INSERT INTO pods (" +
        "id, canvas_id, name, workspace_path, command_id, provider, provider_config_json" +
        ") VALUES (" +
        "'p1', 'c1', 'Legacy Gemini Pod', '/tmp/p1', 'cmd-legacy', 'gemini', '{\"model\":\"gemini-2.5-pro\"}'" +
        ")",
    );
    db.exec(
      "INSERT INTO connections (" +
        "id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor, summary_model, summary_provider" +
        ") VALUES (" +
        "'conn-1', 'c1', 'p1', 'right', 'p1', 'left', 'gemini-2.5-pro', 'gemini'" +
        ")",
    );
    db.exec(
      "INSERT INTO connections (" +
        "id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor, summary_model, summary_provider" +
        ") VALUES (" +
        "'conn-2', 'c1', 'p1', 'bottom', 'p1', 'top', 'gemini-2.5-flash', NULL" +
        ")",
    );
    db.exec(
      "INSERT INTO notes (id, canvas_id, type, name) VALUES ('note-1', 'c1', 'command', 'legacy command note')",
    );
    db.exec(
      "INSERT INTO pod_manifests (pod_id, repository_id, files_json) VALUES (" +
        "'p1', 'repo-1', '[\".claude/commands/cmd-legacy.md\",\".claude/skills/keep.md\"]'" +
        ")",
    );

    createTables(db);

    const migratedPod = db
      .query(
        "SELECT provider, provider_config_json, goal_json FROM pods WHERE id = 'p1'",
      )
      .get() as {
      provider: string;
      provider_config_json: string;
      goal_json: string | null;
    };

    expect(migratedPod.provider).toBe("claude");
    expect(JSON.parse(migratedPod.provider_config_json)).toEqual({
      model: "sonnet",
      thinkingLevel: "high",
    });
    expect("goal_json" in migratedPod).toBe(true);
    expect(getColumnNames(db, "pods")).not.toContain("command_id");

    const migratedConnections = db
      .query(
        "SELECT id, summary_model, summary_provider FROM connections ORDER BY id ASC",
      )
      .all() as Array<{
      id: string;
      summary_model: string;
      summary_provider: string | null;
    }>;

    expect(migratedConnections).toEqual([
      {
        id: "conn-1",
        summary_model: "sonnet",
        summary_provider: "claude",
      },
      {
        id: "conn-2",
        summary_model: "sonnet",
        summary_provider: null,
      },
    ]);

    const commandNotes = db
      .query("SELECT COUNT(*) as cnt FROM notes WHERE type = 'command'")
      .get() as { cnt: number };
    expect(commandNotes.cnt).toBe(0);

    const manifestRow = db
      .query(
        "SELECT files_json FROM pod_manifests WHERE pod_id = 'p1' AND repository_id = 'repo-1'",
      )
      .get() as { files_json: string };
    expect(JSON.parse(manifestRow.files_json)).toEqual([
      ".claude/skills/keep.md",
    ]);
  });
});

// ─── migrateDropMessagesTable ────────────────────────────────────────────────

describe("migrateDropMessagesTable：移除舊 messages 表與 index", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = OFF");
  });

  afterEach(() => {
    db.close();
  });

  it("舊 DB 含 messages 表，migration 後表不存在", () => {
    // 建立舊的 messages 表
    db.exec(
      "CREATE TABLE messages (" +
        "id TEXT PRIMARY KEY," +
        "pod_id TEXT NOT NULL," +
        "canvas_id TEXT NOT NULL," +
        "role TEXT NOT NULL," +
        "content TEXT NOT NULL," +
        "timestamp TEXT NOT NULL" +
        ")",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_pod_id ON messages(pod_id)",
    );

    // 確認表與 index 存在
    expect(getTableNames(db)).toContain("messages");
    expect(indexExists(db, "idx_messages_pod_id")).toBe(true);

    createTables(db);

    // 驗證表與 index 已移除
    expect(getTableNames(db)).not.toContain("messages");
    expect(indexExists(db, "idx_messages_pod_id")).toBe(false);
  });

  it("舊 DB 含 messages 表及 index，migration 後兩者都不存在", () => {
    db.exec(
      "CREATE TABLE messages (" +
        "id TEXT PRIMARY KEY," +
        "pod_id TEXT NOT NULL," +
        "canvas_id TEXT NOT NULL," +
        "role TEXT NOT NULL," +
        "content TEXT NOT NULL," +
        "timestamp TEXT NOT NULL," +
        "sub_messages_json TEXT," +
        "metadata_json TEXT" +
        ")",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_pod_id ON messages(pod_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_canvas_id ON messages(canvas_id)",
    );

    createTables(db);

    expect(getTableNames(db)).not.toContain("messages");
    expect(indexExists(db, "idx_messages_pod_id")).toBe(false);
  });

  it("新 DB 不含 messages 表，migration 後 messages 仍不存在（idempotent）", () => {
    // 不建立 messages 表，直接 migration
    expect(getTableNames(db)).not.toContain("messages");

    expect(() => createTables(db)).not.toThrow();

    expect(getTableNames(db)).not.toContain("messages");
  });

  it("含資料的舊 messages 表在 migration 後完全移除（包含資料）", () => {
    db.exec(
      "CREATE TABLE messages (" +
        "id TEXT PRIMARY KEY," +
        "pod_id TEXT NOT NULL," +
        "canvas_id TEXT NOT NULL," +
        "role TEXT NOT NULL," +
        "content TEXT NOT NULL," +
        "timestamp TEXT NOT NULL" +
        ")",
    );
    db.exec(
      "INSERT INTO messages (id, pod_id, canvas_id, role, content, timestamp) " +
        "VALUES ('m1', 'p1', 'c1', 'user', 'hello', '2024-01-01')",
    );

    createTables(db);

    // 表已移除，查詢應不存在
    const tables = getTableNames(db);
    expect(tables).not.toContain("messages");
  });
});

// ─── 兩個 migration 同時存在（完整舊 schema 情境）───────────────────────────

describe("完整舊 schema：同時含 multi_instance 與 messages 表，migration 後兩者都清理", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = OFF");
  });

  afterEach(() => {
    db.close();
  });

  it("舊 DB 同時有 multi_instance 欄位與 messages 表，migration 後兩者都已移除", () => {
    // 建立含 multi_instance 的 pods
    db.exec(
      "CREATE TABLE pods (" +
        "id TEXT PRIMARY KEY," +
        "canvas_id TEXT NOT NULL," +
        "name TEXT NOT NULL," +
        "x REAL NOT NULL DEFAULT 0," +
        "y REAL NOT NULL DEFAULT 0," +
        "rotation REAL NOT NULL DEFAULT 0," +
        "workspace_path TEXT NOT NULL," +
        "session_id TEXT," +
        "repository_id TEXT," +
        "command_id TEXT," +
        "multi_instance INTEGER NOT NULL DEFAULT 0," +
        "schedule_json TEXT," +
        "provider TEXT NOT NULL DEFAULT 'claude'," +
        "provider_config_json TEXT," +
        "UNIQUE (canvas_id, name)" +
        ")",
    );

    // 建立舊 messages 表
    db.exec(
      "CREATE TABLE messages (" +
        "id TEXT PRIMARY KEY," +
        "pod_id TEXT NOT NULL," +
        "canvas_id TEXT NOT NULL," +
        "role TEXT NOT NULL," +
        "content TEXT NOT NULL," +
        "timestamp TEXT NOT NULL" +
        ")",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_pod_id ON messages(pod_id)",
    );

    expect(getColumnNames(db, "pods")).toContain("multi_instance");
    expect(getTableNames(db)).toContain("messages");

    createTables(db);

    expect(getColumnNames(db, "pods")).not.toContain("multi_instance");
    expect(getTableNames(db)).not.toContain("messages");
    expect(indexExists(db, "idx_messages_pod_id")).toBe(false);
  });
});
