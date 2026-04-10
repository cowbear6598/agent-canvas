import { Database } from "bun:sqlite";

export function createTables(db: Database): void {
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
      "output_style_id TEXT," +
      "repository_id TEXT," +
      "command_id TEXT," +
      "multi_instance INTEGER NOT NULL DEFAULT 0," +
      "schedule_json TEXT" +
      ")",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_pods_canvas_id ON pods(canvas_id)");

  db.exec(
    "CREATE TABLE IF NOT EXISTS pod_skill_ids (" +
      "pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE," +
      "skill_id TEXT NOT NULL," +
      "PRIMARY KEY (pod_id, skill_id)" +
      ")",
  );

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
      "claude_session_id TEXT," +
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

  // Migration: run_pod_instances 新增 worktree_path 欄位
  try {
    db.exec("ALTER TABLE run_pod_instances ADD COLUMN worktree_path TEXT");
  } catch (e) {
    // 欄位已存在時忽略，其他錯誤重新拋出
    if (!(e instanceof Error && e.message.includes("duplicate column"))) {
      throw e;
    }
  }

  // Migration: connections 新增 summary_model 欄位
  try {
    db.exec(
      "ALTER TABLE connections ADD COLUMN summary_model TEXT NOT NULL DEFAULT 'sonnet'",
    );
  } catch (e) {
    // 欄位已存在時忽略，其他錯誤重新拋出
    if (!(e instanceof Error && e.message.includes("duplicate column"))) {
      throw e;
    }
  }

  // Migration: connections 新增 ai_decide_model 欄位
  try {
    db.exec(
      "ALTER TABLE connections ADD COLUMN ai_decide_model TEXT NOT NULL DEFAULT 'sonnet'",
    );
  } catch (e) {
    // 欄位已存在時忽略，其他錯誤重新拋出
    if (!(e instanceof Error && e.message.includes("duplicate column"))) {
      throw e;
    }
  }
}
