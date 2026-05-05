import { Database } from "bun:sqlite";

/**
 * 建立所有資料表（CREATE TABLE IF NOT EXISTS）。
 * 純 DDL，代表目前最新的 schema；新建 DB 直接執行此函式即可。
 */
function createBaseTables(db: Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS canvases (" +
      "id TEXT PRIMARY KEY," +
      "name TEXT NOT NULL UNIQUE," +
      "sort_index INTEGER NOT NULL DEFAULT 0," +
      "password_hash TEXT," +
      "password_version INTEGER NOT NULL DEFAULT 0" +
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

  // 新版 MCP server 名稱 join table（以 name 取代舊的 id）
  db.exec(
    "CREATE TABLE IF NOT EXISTS pod_mcp_server_names (" +
      "pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE," +
      "mcp_server_name TEXT NOT NULL," +
      "PRIMARY KEY (pod_id, mcp_server_name)" +
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
      "connection_status TEXT NOT NULL DEFAULT 'idle'," +
      "summary_model TEXT NOT NULL DEFAULT 'sonnet'," +
      "ai_decide_model TEXT NOT NULL DEFAULT 'sonnet'," +
      // summary_provider 不設 NOT NULL：NULL 代表使用者未指定，
      // runtime 由 connectionExecution 路由 fallback 為 sourcePod.provider。
      "summary_provider TEXT" +
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
      "sub_messages_json TEXT," +
      "metadata_json TEXT" +
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
      "worktree_path TEXT," +
      "workspace_path TEXT," +
      "sandbox_home_path TEXT" +
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
      "sub_messages_json TEXT," +
      "metadata_json TEXT" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_messages_run_pod ON run_messages(run_id, pod_id)",
  );
}

function columnExists(
  db: Database,
  tableName: string,
  columnName: string,
): boolean {
  const rows = db
    .query(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  return rows.some((row) => row.name === columnName);
}

function migrateCanvasPasswordColumns(db: Database): void {
  if (!columnExists(db, "canvases", "password_hash")) {
    db.exec("ALTER TABLE canvases ADD COLUMN password_hash TEXT");
  }

  if (!columnExists(db, "canvases", "password_version")) {
    db.exec(
      "ALTER TABLE canvases ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0",
    );
  }

  db.exec(
    "UPDATE canvases SET password_version = 0 WHERE password_version IS NULL",
  );
}

export function createTables(db: Database): void {
  createBaseTables(db);
  migrateCanvasPasswordColumns(db);
}
