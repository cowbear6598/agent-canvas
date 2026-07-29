import { getSecretsDb } from "../database/secretsDatabase.js";
import { encryptionService } from "./encryptionService.js";
import { logger } from "../utils/logger.js";

export type SecretNamespace = "integration-app" | "managed-mcp";

interface SecretRow {
  encrypted_value: string;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

class SecretStore {
  set(
    namespace: SecretNamespace,
    ownerId: string,
    value: Record<string, unknown>,
  ): void {
    const now = nowIsoString();
    const encryptedValue = encryptionService.encrypt(JSON.stringify(value));
    getSecretsDb()
      .prepare(
        `INSERT INTO secret_records (
          namespace, owner_id, encrypted_value, created_at, updated_at
        ) VALUES (
          $namespace, $ownerId, $encryptedValue, $createdAt, $updatedAt
        )
        ON CONFLICT(namespace, owner_id) DO UPDATE SET
          encrypted_value = excluded.encrypted_value,
          updated_at = excluded.updated_at`,
      )
      .run({
        $namespace: namespace,
        $ownerId: ownerId,
        $encryptedValue: encryptedValue,
        $createdAt: now,
        $updatedAt: now,
      });
  }

  get(
    namespace: SecretNamespace,
    ownerId: string,
  ): Record<string, unknown> | undefined {
    const row = getSecretsDb()
      .prepare(
        `SELECT encrypted_value
         FROM secret_records
         WHERE namespace = ? AND owner_id = ?`,
      )
      .get(namespace, ownerId) as SecretRow | null;
    if (!row) return undefined;

    try {
      const plaintext = encryptionService.decrypt(row.encrypted_value);
      const parsed = JSON.parse(plaintext) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("解密後的秘密資料不是物件");
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      logger.error(
        "Encryption",
        "Error",
        `秘密資料解密失敗：${namespace}:${ownerId}`,
        error,
      );
      return undefined;
    }
  }

  delete(namespace: SecretNamespace, ownerId: string): boolean {
    const result = getSecretsDb()
      .prepare(
        "DELETE FROM secret_records WHERE namespace = ? AND owner_id = ?",
      )
      .run(namespace, ownerId);
    return result.changes > 0;
  }
}

export const secretStore = new SecretStore();
