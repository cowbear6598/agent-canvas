import { Database } from 'bun:sqlite';

export function createTables(db: Database): void {
  // canvases：畫布主表
  db.exec(
    'CREATE TABLE IF NOT EXISTS canvases (' +
      'id TEXT PRIMARY KEY,' +
      'name TEXT NOT NULL UNIQUE,' +
      'sort_index INTEGER NOT NULL DEFAULT 0' +
      ')'
  );

  // pods：畫布中的 agent 節點
  db.exec(
    'CREATE TABLE IF NOT EXISTS pods (' +
      'id TEXT PRIMARY KEY,' +
      'canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,' +
      'name TEXT NOT NULL,' +
      'status TEXT NOT NULL DEFAULT \'idle\',' +
      'x REAL NOT NULL DEFAULT 0,' +
      'y REAL NOT NULL DEFAULT 0,' +
      'rotation REAL NOT NULL DEFAULT 0,' +
      'model TEXT NOT NULL DEFAULT \'opus\',' +
      'workspace_path TEXT NOT NULL,' +
      'claude_session_id TEXT,' +
      'output_style_id TEXT,' +
      'repository_id TEXT,' +
      'command_id TEXT,' +
      'auto_clear INTEGER NOT NULL DEFAULT 0,' +
      'schedule_json TEXT,' +
      'slack_binding_json TEXT' +
      ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_pods_canvas_id ON pods(canvas_id)');

  // pod_skill_ids：pod 與技能的多對多關聯
  db.exec(
    'CREATE TABLE IF NOT EXISTS pod_skill_ids (' +
      'pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,' +
      'skill_id TEXT NOT NULL,' +
      'PRIMARY KEY (pod_id, skill_id)' +
      ')'
  );

  // pod_sub_agent_ids：pod 與子代理的多對多關聯
  db.exec(
    'CREATE TABLE IF NOT EXISTS pod_sub_agent_ids (' +
      'pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,' +
      'sub_agent_id TEXT NOT NULL,' +
      'PRIMARY KEY (pod_id, sub_agent_id)' +
      ')'
  );

  // pod_mcp_server_ids：pod 與 MCP server 的多對多關聯
  db.exec(
    'CREATE TABLE IF NOT EXISTS pod_mcp_server_ids (' +
      'pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,' +
      'mcp_server_id TEXT NOT NULL,' +
      'PRIMARY KEY (pod_id, mcp_server_id)' +
      ')'
  );

  // connections：pod 之間的連線
  db.exec(
    'CREATE TABLE IF NOT EXISTS connections (' +
      'id TEXT PRIMARY KEY,' +
      'canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,' +
      'source_pod_id TEXT NOT NULL,' +
      'source_anchor TEXT NOT NULL,' +
      'target_pod_id TEXT NOT NULL,' +
      'target_anchor TEXT NOT NULL,' +
      'trigger_mode TEXT NOT NULL DEFAULT \'auto\',' +
      'decide_status TEXT NOT NULL DEFAULT \'none\',' +
      'decide_reason TEXT,' +
      'connection_status TEXT NOT NULL DEFAULT \'idle\'' +
      ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_connections_canvas_id ON connections(canvas_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_connections_source_pod_id ON connections(source_pod_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_connections_target_pod_id ON connections(target_pod_id)');

  // notes：畫布上的附註節點
  db.exec(
    'CREATE TABLE IF NOT EXISTS notes (' +
      'id TEXT PRIMARY KEY,' +
      'canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,' +
      'type TEXT NOT NULL,' +
      'name TEXT NOT NULL,' +
      'x REAL NOT NULL DEFAULT 0,' +
      'y REAL NOT NULL DEFAULT 0,' +
      'bound_to_pod_id TEXT,' +
      'original_position_json TEXT,' +
      'foreign_key_id TEXT' +
      ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_notes_canvas_id ON notes(canvas_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(canvas_id, type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notes_bound_to_pod_id ON notes(bound_to_pod_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notes_foreign_key_id ON notes(foreign_key_id)');

  // messages：pod 的對話紀錄
  db.exec(
    'CREATE TABLE IF NOT EXISTS messages (' +
      'id TEXT PRIMARY KEY,' +
      'pod_id TEXT NOT NULL,' +
      'canvas_id TEXT NOT NULL,' +
      'role TEXT NOT NULL,' +
      'content TEXT NOT NULL,' +
      'timestamp TEXT NOT NULL,' +
      'sub_messages_json TEXT' +
      ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_pod_id ON messages(pod_id)');

  // slack_apps：Slack 應用程式設定
  db.exec(
    'CREATE TABLE IF NOT EXISTS slack_apps (' +
      'id TEXT PRIMARY KEY,' +
      'name TEXT NOT NULL,' +
      'bot_token TEXT NOT NULL UNIQUE,' +
      'signing_secret TEXT NOT NULL,' +
      'bot_user_id TEXT NOT NULL DEFAULT \'\'' +
      ')'
  );

  // slack_app_channels：Slack 應用程式與頻道的關聯
  db.exec(
    'CREATE TABLE IF NOT EXISTS slack_app_channels (' +
      'slack_app_id TEXT NOT NULL REFERENCES slack_apps(id) ON DELETE CASCADE,' +
      'channel_id TEXT NOT NULL,' +
      'channel_name TEXT NOT NULL,' +
      'PRIMARY KEY (slack_app_id, channel_id)' +
      ')'
  );

  // repository_metadata：Git 儲存庫的元資料
  db.exec(
    'CREATE TABLE IF NOT EXISTS repository_metadata (' +
      'id TEXT PRIMARY KEY,' +
      'name TEXT NOT NULL,' +
      'path TEXT NOT NULL,' +
      'parent_repo_id TEXT,' +
      'branch_name TEXT,' +
      'current_branch TEXT' +
      ')'
  );

  // mcp_servers：MCP Server 設定
  db.exec(
    'CREATE TABLE IF NOT EXISTS mcp_servers (' +
      'id TEXT PRIMARY KEY,' +
      'name TEXT NOT NULL UNIQUE,' +
      'config_json TEXT NOT NULL' +
      ')'
  );

  // pod_manifests：pod 與儲存庫的檔案清單關聯
  db.exec(
    'CREATE TABLE IF NOT EXISTS pod_manifests (' +
      'pod_id TEXT NOT NULL,' +
      'repository_id TEXT NOT NULL,' +
      'files_json TEXT NOT NULL DEFAULT \'[]\',' +
      'PRIMARY KEY (pod_id, repository_id)' +
      ')'
  );
}
