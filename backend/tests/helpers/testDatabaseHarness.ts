import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { closeDb, initTestDb, resetDb } from "../../src/database/index.js";

export interface TestDatabaseHarness {
  db: Database;
  databasePath: string;
  reset: () => void;
  cleanup: () => Promise<void>;
}

export async function createTestDatabaseHarness(
  rootDir: string,
  name = "canvas.db",
): Promise<TestDatabaseHarness> {
  await mkdir(rootDir, { recursive: true });
  const databasePath = join(rootDir, name);
  const db = initTestDb({ path: databasePath });

  return {
    db,
    databasePath,
    reset: () => resetDb(),
    cleanup: async () => {
      closeDb();
      await Promise.all([
        rm(databasePath, { force: true }),
        rm(`${databasePath}-wal`, { force: true }),
        rm(`${databasePath}-shm`, { force: true }),
      ]);
    },
  };
}
