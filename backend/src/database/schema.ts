import { Database } from "bun:sqlite";

const ALLOWED_ALTER_TABLES = new Set([
  "connections",
  "managed_plugins",
  "model_aliases",
  "repo_memory_states",
  "run_pod_instances",
]);

const COLUMN_SQL_PATTERN =
  /^[a-zA-Z_][a-zA-Z0-9_]*\s+[A-Z]+(\s+(NOT NULL|DEFAULT\s+\S+))*$/;

function addColumnIfMissing(
  db: Database,
  tableName: string,
  columnSql: string,
): void {
  if (!ALLOWED_ALTER_TABLES.has(tableName)) {
    throw new Error(
      `addColumnIfMissing：資料表 "${tableName}" 不在白名單中，禁止動態 ALTER TABLE`,
    );
  }
  if (!COLUMN_SQL_PATTERN.test(columnSql)) {
    throw new Error(
      `addColumnIfMissing：columnSql "${columnSql}" 格式不合法，禁止執行`,
    );
  }
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("duplicate column name")
    ) {
      throw error;
    }
  }
}

function ensureModelAliasesThinkingColumns(db: Database): void {
  db.transaction(() => {
    addColumnIfMissing(db, "model_aliases", "thinking_levels_json TEXT");
    addColumnIfMissing(db, "model_aliases", "default_thinking_level TEXT");
    addColumnIfMissing(db, "model_aliases", "thinking_metadata_json TEXT");
    addColumnIfMissing(
      db,
      "model_aliases",
      "thinking_metadata_fetched_at INTEGER",
    );
  })();
}

function ensureConnectionPersistenceColumns(db: Database): void {
  db.transaction(() => {
    addColumnIfMissing(db, "connections", "summary_thinking_level TEXT");
    addColumnIfMissing(
      db,
      "connections",
      "direct_enabled INTEGER NOT NULL DEFAULT 0",
    );
  })();
}

function ensureManagedPluginBundleColumns(db: Database): void {
  db.transaction(() => {
    addColumnIfMissing(
      db,
      "managed_plugins",
      "source_type TEXT NOT NULL DEFAULT 'github'",
    );
    addColumnIfMissing(
      db,
      "managed_plugins",
      "source_ref TEXT NOT NULL DEFAULT ''",
    );
    db.exec(
      `UPDATE managed_plugins
       SET source_type = CASE
         WHEN source_type IS NULL OR trim(source_type) = '' THEN 'github'
         ELSE source_type
       END,
       source_ref = CASE
         WHEN source_ref IS NULL OR trim(source_ref) = ''
           THEN COALESCE(NULLIF(github_repo, ''), id)
         ELSE source_ref
       END`,
    );
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_plugins_source_unique ON managed_plugins(source_type, source_ref)",
    );
  })();
}

function ensureRepoMemoryEnabledColumn(db: Database): void {
  db.transaction(() => {
    addColumnIfMissing(
      db,
      "repo_memory_states",
      "memory_enabled INTEGER NOT NULL DEFAULT 0",
    );
    db.exec(
      `UPDATE repo_memory_states
       SET memory_enabled = CASE
         WHEN has_summary = 1 THEN 1
         ELSE COALESCE(memory_enabled, 0)
       END`,
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_repo_memory_states_enabled ON repo_memory_states(memory_enabled)",
    );
  })();
}

function migrateLegacyCodexMiniModel(db: Database): void {
  db.transaction(() => {
    db.exec(
      `UPDATE pods
       SET provider_config_json = json_set(provider_config_json, '$.model', 'gpt-5.4')
       WHERE json_extract(provider_config_json, '$.model') = 'gpt-5.4-mini'`,
    );

    db.exec(
      `UPDATE connections
       SET summary_model = CASE WHEN summary_model = 'gpt-5.4-mini' THEN 'gpt-5.4' ELSE summary_model END
       WHERE summary_model = 'gpt-5.4-mini'`,
    );
  })();
}

function ensureModelAliasesUniqueRealModelIndex(db: Database): void {
  db.exec(
    `DELETE FROM model_aliases
     WHERE id IN (
       SELECT duplicate.id
       FROM model_aliases AS duplicate
       WHERE duplicate.id != (
         SELECT keeper.id
         FROM model_aliases AS keeper
         WHERE keeper.provider_id = duplicate.provider_id
           AND keeper.real_provider = duplicate.real_provider
           AND keeper.real_model = duplicate.real_model
         ORDER BY keeper.order_idx ASC, keeper.created_at ASC, keeper.id ASC
         LIMIT 1
       )
     )`,
  );

  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_model_aliases_provider_real_model_unique ON model_aliases(provider_id, real_provider, real_model)",
  );
}

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
      "goal_json TEXT," +
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
    "CREATE TABLE IF NOT EXISTS managed_mcp_servers (" +
      "id TEXT PRIMARY KEY," +
      "name TEXT NOT NULL UNIQUE," +
      "transport TEXT NOT NULL," +
      "command TEXT," +
      "args_json TEXT NOT NULL DEFAULT '[]'," +
      "cwd TEXT," +
      "env_json TEXT NOT NULL DEFAULT '{}'," +
      "url TEXT," +
      "enabled INTEGER NOT NULL DEFAULT 1," +
      "created_at TEXT NOT NULL," +
      "updated_at TEXT NOT NULL," +
      "last_known_status TEXT NOT NULL DEFAULT 'unknown'," +
      "last_error TEXT" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_managed_mcp_servers_name ON managed_mcp_servers(name)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS pod_plugin_ids (" +
      "pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE," +
      "plugin_id TEXT NOT NULL," +
      "PRIMARY KEY (pod_id, plugin_id)" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_pod_plugin_ids_plugin_id ON pod_plugin_ids(plugin_id)",
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
      "summary_thinking_level TEXT," +
      "direct_enabled INTEGER NOT NULL DEFAULT 0," +
      "label TEXT NOT NULL DEFAULT ''," +
      "description TEXT" +
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
    "CREATE TABLE IF NOT EXISTS pod_memory_states (" +
      "pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE," +
      "memory_enabled INTEGER NOT NULL DEFAULT 0," +
      "summary TEXT," +
      "has_summary INTEGER NOT NULL DEFAULT 0," +
      "summary_updated_at TEXT," +
      "created_at TEXT NOT NULL," +
      "updated_at TEXT NOT NULL" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_pod_memory_states_enabled ON pod_memory_states(memory_enabled)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_pod_memory_states_has_summary ON pod_memory_states(has_summary)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS repo_memory_states (" +
      "repository_id TEXT PRIMARY KEY," +
      "memory_enabled INTEGER NOT NULL DEFAULT 0," +
      "summary TEXT," +
      "has_summary INTEGER NOT NULL DEFAULT 0," +
      "summary_updated_at TEXT," +
      "created_at TEXT NOT NULL," +
      "updated_at TEXT NOT NULL" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_repo_memory_states_has_summary ON repo_memory_states(has_summary)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS memory_jobs (" +
      "id TEXT PRIMARY KEY," +
      "scope_type TEXT NOT NULL," +
      "scope_id TEXT NOT NULL," +
      "source_pod_id TEXT," +
      "repository_id TEXT," +
      "status TEXT NOT NULL," +
      "attempt_count INTEGER NOT NULL DEFAULT 0," +
      "error_message TEXT," +
      "metadata_json TEXT NOT NULL DEFAULT '{}'," +
      "created_at TEXT NOT NULL," +
      "updated_at TEXT NOT NULL," +
      "expires_at TEXT NOT NULL" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memory_jobs_scope ON memory_jobs(scope_type, scope_id, created_at)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memory_jobs_expires_at ON memory_jobs(expires_at)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS memory_observations (" +
      "id TEXT PRIMARY KEY," +
      "job_id TEXT NOT NULL REFERENCES memory_jobs(id) ON DELETE CASCADE," +
      "scope_type TEXT NOT NULL," +
      "scope_id TEXT NOT NULL," +
      "kind TEXT NOT NULL," +
      "status TEXT NOT NULL DEFAULT 'recorded'," +
      "summary TEXT," +
      "payload_json TEXT NOT NULL DEFAULT '{}'," +
      "created_at TEXT NOT NULL," +
      "updated_at TEXT NOT NULL," +
      "expires_at TEXT NOT NULL" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memory_observations_job_id ON memory_observations(job_id, created_at)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memory_observations_scope ON memory_observations(scope_type, scope_id, created_at)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memory_observations_expires_at ON memory_observations(expires_at)",
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
      "FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE," +
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
      "completed_at TEXT," +
      "FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workflow_runs_canvas_id ON workflow_runs(canvas_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(canvas_id, status)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workflow_runs_canvas_created_id ON workflow_runs(canvas_id, created_at DESC, id DESC)",
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
      "last_response_summary TEXT," +
      "run_repo_path TEXT," +
      "workspace_path TEXT" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_pod_instances_run_id ON run_pod_instances(run_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_pod_instances_run_pod ON run_pod_instances(run_id, pod_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_pod_instances_pod_status ON run_pod_instances(pod_id, status)",
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
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_messages_page ON run_messages(run_id, pod_id, timestamp DESC, id DESC)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS run_goal_round_dividers (" +
      "id TEXT PRIMARY KEY," +
      "run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE," +
      "pod_id TEXT NOT NULL," +
      "source_pod_ids_json TEXT NOT NULL," +
      "source_pod_names_json TEXT NOT NULL," +
      "status TEXT NOT NULL," +
      "blocked_reason TEXT," +
      "completed_at TEXT NOT NULL," +
      "connection_ids_json TEXT NOT NULL" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_run_goal_round_dividers_run_pod ON run_goal_round_dividers(run_id, pod_id, completed_at)",
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
      "thinking_levels_json TEXT," +
      "default_thinking_level TEXT," +
      "thinking_metadata_json TEXT," +
      "thinking_metadata_fetched_at INTEGER," +
      "created_at INTEGER NOT NULL," +
      "updated_at INTEGER NOT NULL," +
      "UNIQUE(provider_id, real_provider, alias)" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_model_aliases_provider_id ON model_aliases(provider_id, order_idx)",
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS managed_plugins (" +
      "id TEXT PRIMARY KEY," +
      "github_repo TEXT NOT NULL," +
      "source_type TEXT NOT NULL DEFAULT 'github'," +
      "source_ref TEXT NOT NULL," +
      "display_name TEXT," +
      "description TEXT," +
      "install_path TEXT NOT NULL," +
      "sort_index INTEGER NOT NULL DEFAULT 0," +
      "installed_at TEXT NOT NULL," +
      "updated_at TEXT NOT NULL" +
      ")",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_managed_plugins_github_repo ON managed_plugins(github_repo)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_managed_plugins_sort_index ON managed_plugins(sort_index)",
  );
}

export function createTables(db: Database): void {
  createBaseTables(db);
  addColumnIfMissing(db, "run_pod_instances", "last_response_summary TEXT");
  ensureConnectionPersistenceColumns(db);
  ensureManagedPluginBundleColumns(db);
  ensureModelAliasesThinkingColumns(db);
  ensureRepoMemoryEnabledColumn(db);
  ensureModelAliasesUniqueRealModelIndex(db);
  migrateLegacyCodexMiniModel(db);
}
