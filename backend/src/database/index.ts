import { Database } from 'bun:sqlite';
import path from 'path';
import { config } from '../config/index.js';
import { createTables } from './schema.js';

let db: Database | null = null;

export function getDb(): Database {
  if (db) {
    return db;
  }

  const dbPath = path.join(config.appDataRoot, 'canvas.db');
  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db);

  return db;
}

export function closeDb(): void {
  if (!db) {
    return;
  }

  db.close();
  db = null;
}

export function resetDb(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetDb 僅限測試環境使用');
  }

  const database = getDb();

  database.exec('DELETE FROM global_settings');

  // 子表先刪，避免外鍵約束衝突
  database.exec('DELETE FROM run_messages');
  database.exec('DELETE FROM run_pod_instances');
  database.exec('DELETE FROM workflow_runs');
  database.exec('DELETE FROM pod_manifests');
  database.exec('DELETE FROM messages');
  database.exec('DELETE FROM notes');
  database.exec('DELETE FROM connections');
  database.exec('DELETE FROM pod_skill_ids');
  database.exec('DELETE FROM pod_sub_agent_ids');
  database.exec('DELETE FROM pod_mcp_server_ids');
  database.exec('DELETE FROM integration_bindings');
  database.exec('DELETE FROM pods');
  database.exec('DELETE FROM canvases');
  database.exec('DELETE FROM mcp_servers');
  database.exec('DELETE FROM integration_apps');
  database.exec('DELETE FROM repository_metadata');
}

export function initTestDb(): Database {
  db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db);

  return db;
}
