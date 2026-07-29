import { Database } from "bun:sqlite";
import path from "path";
import { config } from "../config/index.js";

export const SECRETS_DB_FILE_NAME = "secrets.db";

let secretsDb: Database | null = null;

function createSecretsTables(database: Database): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS secret_records (
      namespace TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace, owner_id)
    )`,
  );
}

function openSecretsDb(databasePath: string): Database {
  const database = new Database(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  createSecretsTables(database);
  return database;
}

export function getSecretsDb(): Database {
  if (!secretsDb) {
    const databasePath = path.join(config.appDataRoot, SECRETS_DB_FILE_NAME);
    secretsDb = openSecretsDb(databasePath);
  }
  return secretsDb;
}

export function closeSecretsDb(): void {
  if (!secretsDb) return;
  secretsDb.close();
  secretsDb = null;
}

export function initTestSecretsDb(databasePath: string = ":memory:"): Database {
  closeSecretsDb();
  secretsDb = openSecretsDb(databasePath);
  return secretsDb;
}

export function resetSecretsDb(): void {
  getSecretsDb().exec("DELETE FROM secret_records");
}
