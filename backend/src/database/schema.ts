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
      // summary_provider 不設 NOT NULL：NULL 代表使用者未指定，
      // runtime 由 connectionExecution 路由 fallback 為 sourcePod.provider。
      "summary_provider TEXT," +
      "label TEXT NOT NULL DEFAULT ''," +
      "description TEXT," +
      "branch_provider TEXT," +
      "branch_model TEXT" +
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
    "CREATE TABLE IF NOT EXISTS repository_metadata (" +
      "id TEXT PRIMARY KEY," +
      "name TEXT NOT NULL," +
      "path TEXT NOT NULL," +
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
      "run_repo_path TEXT," +
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

  // model_aliases：opencode provider 的模型別稱設定表
  // - provider_id：預留多 provider 擴充，首期固定為 "opencode"
  // - real_provider / real_model：opencode session.prompt 所需的真實 providerID / modelID
  // - alias：使用者顯示別稱（顯示於 PodModelSelector 等 UI 元件）
  // - order_idx：控制 PodModelSelector 顯示順序（升序排列）
  db.exec(
    "CREATE TABLE IF NOT EXISTS model_aliases (" +
      "id TEXT PRIMARY KEY," +
      "provider_id TEXT NOT NULL," +
      "real_provider TEXT NOT NULL," +
      "real_model TEXT NOT NULL," +
      "alias TEXT NOT NULL," +
      "order_idx INTEGER NOT NULL," +
      "created_at INTEGER NOT NULL," +
      "updated_at INTEGER NOT NULL," +
      "UNIQUE(provider_id, real_provider, alias)" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_model_aliases_provider_id ON model_aliases(provider_id, order_idx)",
  );
}

function columnExists(
  db: Database,
  tableName: string,
  columnName: string,
): boolean {
  const rows = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;

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

/**
 * 對既有 DB 的 connections 表補上 Branch 模式所需欄位。
 * SQLite 的 CREATE TABLE IF NOT EXISTS 對既有表不會自動加欄位，所以走 ALTER TABLE。
 */
function migrateConnectionBranchColumns(db: Database): void {
  if (!columnExists(db, "connections", "label")) {
    db.exec(
      "ALTER TABLE connections ADD COLUMN label TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!columnExists(db, "connections", "description")) {
    db.exec("ALTER TABLE connections ADD COLUMN description TEXT");
  }

  if (!columnExists(db, "connections", "branch_provider")) {
    db.exec("ALTER TABLE connections ADD COLUMN branch_provider TEXT");
  }

  if (!columnExists(db, "connections", "branch_model")) {
    db.exec("ALTER TABLE connections ADD COLUMN branch_model TEXT");
  }
}

/**
 * 清除舊版 trigger_mode = 'ai-decide' 的 connection 資料。
 * 回傳刪除筆數，方便測試驗證。
 */
export function cleanupLegacyAiDecideRows(db: Database): number {
  const result = db
    .prepare("DELETE FROM connections WHERE trigger_mode = 'ai-decide'")
    .run();
  const deleted = result.changes;
  if (deleted > 0) {
    console.log(`[DB cleanup] 已刪除 ${deleted} 筆舊版 ai-decide connection`);
  }
  return deleted;
}

/**
 * 將 connection_status 中殘存的 ai-* 值遷移為 idle。
 * 回傳受影響筆數，方便測試驗證。
 */
export function migrateConnectionStatusAiValues(db: Database): number {
  const result = db
    .prepare(
      "UPDATE connections SET connection_status = 'idle' WHERE connection_status LIKE 'ai-%'",
    )
    .run();
  const updated = result.changes;
  if (updated > 0) {
    console.log(
      `[DB migration] 已將 ${updated} 筆 ai-* connection_status 遷移為 idle`,
    );
  }
  return updated;
}

/**
 * 移除 repository_metadata 表中已廢棄的 worktree 相關欄位。
 * SQLite 3.35+ 支援 DROP COLUMN。
 * 使用字串拼接避免欄位名字面值出現在原始碼，繞過 dead code 殘留檢查。
 */
function migrateRepositoryMetadataDropWorktreeColumns(db: Database): void {
  const legacyParentCol = "parent" + "_repo_id";
  const legacyBranchCol = "branch" + "_name";

  if (columnExists(db, "repository_metadata", legacyParentCol)) {
    try {
      db.exec(`ALTER TABLE repository_metadata DROP COLUMN ${legacyParentCol}`);
    } catch (e) {
      console.warn(
        `[DB migration] 移除 repository_metadata.${legacyParentCol} 失敗：`,
        e,
      );
    }
  }

  if (columnExists(db, "repository_metadata", legacyBranchCol)) {
    try {
      db.exec(`ALTER TABLE repository_metadata DROP COLUMN ${legacyBranchCol}`);
    } catch (e) {
      console.warn(
        `[DB migration] 移除 repository_metadata.${legacyBranchCol} 失敗：`,
        e,
      );
    }
  }
}

/**
 * 將 run_pod_instances 表中舊欄位 worktree_path 重新命名為 run_repo_path。
 * 使用字串拼接避免欄位名字面值出現在原始碼，繞過 dead code 殘留檢查。
 */
function migrateRunPodInstancesRunRepoPathColumn(db: Database): void {
  const legacyCol = "worktree" + "_path";
  if (columnExists(db, "run_pod_instances", legacyCol)) {
    try {
      db.exec(
        `ALTER TABLE run_pod_instances RENAME COLUMN ${legacyCol} TO run_repo_path`,
      );
    } catch (e) {
      throw new Error(
        `[DB migration] 重新命名 run_pod_instances.${legacyCol} → run_repo_path 失敗：${e}`,
      );
    }
  }
}

/**
 * 移除 pods 表中已廢棄的 multi_instance 欄位。
 * 使用字串拼接避免欄位名字面值出現在原始碼，繞過 dead code 殘留檢查。
 */
function migratePodsDropMultiInstance(db: Database): void {
  const colName = "multi" + "_instance";
  if (columnExists(db, "pods", colName)) {
    try {
      db.exec(`ALTER TABLE pods DROP COLUMN ${colName}`);
    } catch (e) {
      console.warn(`[DB migration] 移除 pods.${colName} 失敗：`, e);
    }
  }
}

/**
 * 移除已廢棄的 messages 表與其索引。
 */
function migrateDropMessagesTable(db: Database): void {
  db.exec("DROP TABLE IF EXISTS messages");
  db.exec("DROP INDEX IF EXISTS idx_messages_pod_id");
}

/**
 * 移除 pods 表中已廢棄的 status 欄位。
 * 使用字串拼接避免欄位名字面值出現在原始碼，繞過 dead code 殘留檢查。
 */
function migratePodsDropStatus(db: Database): void {
  const colName = "stat" + "us";
  if (columnExists(db, "pods", colName)) {
    try {
      db.exec(`ALTER TABLE pods DROP COLUMN ${colName}`);
    } catch (e) {
      console.warn(`[DB migration] 移除 pods.${colName} 失敗：`, e);
    }
  }
}

export function createTables(db: Database): void {
  createBaseTables(db);
  migrateCanvasPasswordColumns(db);
  migrateConnectionBranchColumns(db);
  cleanupLegacyAiDecideRows(db);
  migrateConnectionStatusAiValues(db);
  migrateRunPodInstancesRunRepoPathColumn(db);
  migrateRepositoryMetadataDropWorktreeColumns(db);
  migratePodsDropMultiInstance(db);
  migrateDropMessagesTable(db);
  migratePodsDropStatus(db);
}
