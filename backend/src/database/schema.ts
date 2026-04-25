import { Database } from "bun:sqlite";

/**
 * 判斷 migration catch 到的錯誤是否可以忽略（冪等性保護）。
 * DDL 語句在欄位已存在、已刪除或索引已存在時回傳的錯誤訊息應列入 allowedMessages。
 */
function isIgnorableMigrationError(
  e: unknown,
  ...allowedMessages: string[]
): boolean {
  if (!(e instanceof Error)) return false;
  return allowedMessages.some((msg) => e.message.includes(msg));
}

/**
 * 執行單一 migration SQL，遭遇可忽略錯誤時靜默略過，其餘錯誤重新拋出。
 * 統一封裝 try-catch 樣板，避免重複。
 */
function runMigration(
  db: Database,
  sql: string,
  ignoredMessages: string[],
): void {
  try {
    db.exec(sql);
  } catch (e) {
    if (!isIgnorableMigrationError(e, ...ignoredMessages)) throw e;
  }
}

/**
 * 建立所有資料表（CREATE TABLE IF NOT EXISTS）。
 * 只含純 DDL，不含 migration 語句。
 */
function createBaseTables(db: Database): void {
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_pods_canvas_id ON pods(canvas_id)");

  db.exec(
    "CREATE TABLE IF NOT EXISTS pod_sub_agent_ids (" +
      "pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE," +
      "sub_agent_id TEXT NOT NULL," +
      "PRIMARY KEY (pod_id, sub_agent_id)" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS pod_mcp_server_ids (" +
      "pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE," +
      "mcp_server_id TEXT NOT NULL," +
      "PRIMARY KEY (pod_id, mcp_server_id)" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS pod_plugin_ids (" +
      "pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE," +
      "plugin_id TEXT NOT NULL," +
      "PRIMARY KEY (pod_id, plugin_id)" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS connections (" +
      "id TEXT PRIMARY KEY," +
      "canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE," +
      "source_pod_id TEXT NOT NULL," +
      "source_anchor TEXT NOT NULL," +
      "target_pod_id TEXT NOT NULL," +
      "target_anchor TEXT NOT NULL," +
      "trigger_mode TEXT NOT NULL DEFAULT 'auto'," +
      "decide_status TEXT NOT NULL DEFAULT 'none'," +
      "decide_reason TEXT," +
      "connection_status TEXT NOT NULL DEFAULT 'idle'" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_connections_canvas_id ON connections(canvas_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_connections_source_pod_id ON connections(source_pod_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_connections_target_pod_id ON connections(target_pod_id)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS notes (" +
      "id TEXT PRIMARY KEY," +
      "canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE," +
      "type TEXT NOT NULL," +
      "name TEXT NOT NULL," +
      "x REAL NOT NULL DEFAULT 0," +
      "y REAL NOT NULL DEFAULT 0," +
      "bound_to_pod_id TEXT," +
      "original_position_json TEXT," +
      "foreign_key_id TEXT" +
      ")",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_notes_canvas_id ON notes(canvas_id)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(canvas_id, type)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_notes_bound_to_pod_id ON notes(bound_to_pod_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_notes_foreign_key_id ON notes(foreign_key_id)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS messages (" +
      "id TEXT PRIMARY KEY," +
      "pod_id TEXT NOT NULL," +
      "canvas_id TEXT NOT NULL," +
      "role TEXT NOT NULL," +
      "content TEXT NOT NULL," +
      "timestamp TEXT NOT NULL," +
      "sub_messages_json TEXT" +
      ")",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_pod_id ON messages(pod_id)");

  db.exec(
    "CREATE TABLE IF NOT EXISTS repository_metadata (" +
      "id TEXT PRIMARY KEY," +
      "name TEXT NOT NULL," +
      "path TEXT NOT NULL," +
      "parent_repo_id TEXT," +
      "branch_name TEXT," +
      "current_branch TEXT" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS mcp_servers (" +
      "id TEXT PRIMARY KEY," +
      "name TEXT NOT NULL UNIQUE," +
      "config_json TEXT NOT NULL" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS pod_manifests (" +
      "pod_id TEXT NOT NULL," +
      "repository_id TEXT NOT NULL," +
      "files_json TEXT NOT NULL DEFAULT '[]'," +
      "PRIMARY KEY (pod_id, repository_id)" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS integration_apps (" +
      "id TEXT PRIMARY KEY," +
      "provider TEXT NOT NULL," +
      "name TEXT NOT NULL," +
      "config_json TEXT NOT NULL," +
      "extra_json TEXT," +
      "UNIQUE(provider, name)" +
      ")",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS integration_bindings (" +
      "id TEXT PRIMARY KEY," +
      "pod_id TEXT NOT NULL," +
      "canvas_id TEXT NOT NULL," +
      "provider TEXT NOT NULL," +
      "app_id TEXT NOT NULL," +
      "resource_id TEXT NOT NULL," +
      "extra_json TEXT," +
      "FOREIGN KEY (pod_id) REFERENCES pods(id) ON DELETE CASCADE," +
      "FOREIGN KEY (app_id) REFERENCES integration_apps(id) ON DELETE CASCADE" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_integration_bindings_app_resource ON integration_bindings(app_id, resource_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_integration_bindings_pod ON integration_bindings(pod_id)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS workflow_runs (" +
      "id TEXT PRIMARY KEY," +
      "canvas_id TEXT NOT NULL," +
      "source_pod_id TEXT NOT NULL," +
      "trigger_message TEXT NOT NULL," +
      "status TEXT NOT NULL DEFAULT 'running'," +
      "created_at TEXT NOT NULL," +
      "completed_at TEXT" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workflow_runs_canvas_id ON workflow_runs(canvas_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(canvas_id, status)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS run_pod_instances (" +
      "id TEXT PRIMARY KEY," +
      "run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE," +
      "pod_id TEXT NOT NULL," +
      "status TEXT NOT NULL DEFAULT 'pending'," +
      "session_id TEXT," +
      "error_message TEXT," +
      "triggered_at TEXT," +
      "completed_at TEXT," +
      "auto_pathway_settled INTEGER," +
      "direct_pathway_settled INTEGER," +
      "worktree_path TEXT" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_pod_instances_run_id ON run_pod_instances(run_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_pod_instances_run_pod ON run_pod_instances(run_id, pod_id)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS run_messages (" +
      "id TEXT PRIMARY KEY," +
      "run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE," +
      "pod_id TEXT NOT NULL," +
      "role TEXT NOT NULL," +
      "content TEXT NOT NULL," +
      "timestamp TEXT NOT NULL," +
      "sub_messages_json TEXT" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_messages_run_pod ON run_messages(run_id, pod_id)",
  );
}

/**
 * 執行所有歷史 migration（ALTER TABLE / CREATE INDEX 等）。
 * 每條 migration 均冪等：重複執行不 throw。
 */
function runMigrations(db: Database): void {
  // Migration: 既有 DB 補上 (canvas_id, name) 唯一索引，防止 TOCTOU rename 競爭條件
  runMigration(
    db,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_pods_canvas_name ON pods(canvas_id, name)",
    ["already exists"],
  );

  // Migration: pods.claude_session_id 重命名為 session_id（語意統一，支援 Claude 以外的 provider）
  runMigration(
    db,
    "ALTER TABLE pods RENAME COLUMN claude_session_id TO session_id",
    ["no such column", "duplicate column"],
  );

  // Migration: run_pod_instances.claude_session_id 重命名為 session_id（語意統一，支援 Claude 以外的 provider）
  runMigration(
    db,
    "ALTER TABLE run_pod_instances RENAME COLUMN claude_session_id TO session_id",
    ["no such column", "duplicate column"],
  );

  // Migration: run_pod_instances 新增 worktree_path 欄位
  runMigration(
    db,
    "ALTER TABLE run_pod_instances ADD COLUMN worktree_path TEXT",
    ["duplicate column"],
  );

  // Migration: connections 新增 summary_model 欄位
  runMigration(
    db,
    "ALTER TABLE connections ADD COLUMN summary_model TEXT NOT NULL DEFAULT 'sonnet'",
    ["duplicate column"],
  );

  // Migration: connections 新增 ai_decide_model 欄位
  runMigration(
    db,
    "ALTER TABLE connections ADD COLUMN ai_decide_model TEXT NOT NULL DEFAULT 'sonnet'",
    ["duplicate column"],
  );

  // Migration: pods 新增 provider 欄位（預設 'claude' 確保舊資料相容）
  runMigration(
    db,
    "ALTER TABLE pods ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
    ["duplicate column"],
  );

  // Migration: pods 新增 provider_config_json 欄位
  runMigration(db, "ALTER TABLE pods ADD COLUMN provider_config_json TEXT", [
    "duplicate column",
  ]);

  // Migration: 移除 pods.model 欄位（providerConfig.model 已成為唯一來源）
  // SQLite 3.35+ 支援 ALTER TABLE DROP COLUMN，Bun 內建 SQLite 3.51.0 可安全使用
  // 冪等：欄位不存在時靜默忽略
  runMigration(db, "ALTER TABLE pods DROP COLUMN model", [
    "no such column",
    "no such index",
    "Cannot drop column",
  ]);

  // Migration: 砍除 Output Style 功能後移除欄位
  // 冪等：欄位不存在時靜默忽略
  runMigration(db, "ALTER TABLE pods DROP COLUMN output_style_id", [
    "no such column",
    "Cannot drop column",
  ]);

  // Migration: 砍除 SkillNote / skillIds 功能後移除 join table
  // 冪等：table 不存在時靜默忽略
  runMigration(db, "DROP TABLE IF EXISTS pod_skill_ids", ["no such table"]);
  runMigration(db, "DROP TABLE IF EXISTS skill_notes", ["no such table"]);
}

export function createTables(db: Database): void {
  createBaseTables(db);
  runMigrations(db);
}

export { isIgnorableMigrationError, runMigration };
