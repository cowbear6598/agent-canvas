import { v4 as uuidv4 } from "uuid";
import { ok, err } from "../../types/index.js";
import type { Result } from "../../types/index.js";
import type { IntegrationConnectionStatus } from "../../types/integration.js";
import { getDb } from "../../database/index.js";
import { getStatements } from "../../database/statements.js";
import { integrationRegistry } from "./integrationRegistry.js";
import type {
  IntegrationApp,
  IntegrationAppConfig,
  IntegrationResource,
} from "./types.js";
import { encryptionService } from "../encryptionService.js";
import { logger } from "../../utils/logger.js";

interface IntegrationAppRow {
  id: string;
  provider: string;
  name: string;
  config_json: string;
  extra_json: string | null;
}

class IntegrationAppStore {
  private runtimeState: Map<
    string,
    {
      connectionStatus: IntegrationConnectionStatus;
      resources: IntegrationResource[];
    }
  > = new Map();

  private get stmts(): ReturnType<typeof getStatements>["integrationApp"] {
    return getStatements(getDb()).integrationApp;
  }

  private rowToApp(row: IntegrationAppRow): IntegrationApp {
    const runtime = this.runtimeState.get(row.id);
    let configJson: string;
    try {
      configJson = encryptionService.isEncrypted(row.config_json)
        ? encryptionService.decrypt(row.config_json)
        : row.config_json;
    } catch (error) {
      logger.error(
        "Integration",
        "Error",
        `App ${row.id} (${row.provider}:${row.name}) 的憑證解密失敗，需重新設定`,
        error,
      );
      configJson = "{}";
    }
    const config = JSON.parse(configJson) as IntegrationAppConfig;
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      config,
      connectionStatus: runtime?.connectionStatus ?? "disconnected",
      resources: runtime?.resources ?? [],
    };
  }

  create(
    provider: string,
    name: string,
    config: IntegrationAppConfig,
  ): Result<IntegrationApp> {
    const integrationProvider = integrationRegistry.getOrThrow(provider);

    const validateResult = integrationProvider.validateCreate(config);
    if (!validateResult.success) {
      return err(validateResult.error);
    }

    const existing = this.stmts.selectByProviderAndName.get({
      $provider: provider,
      $name: name,
    });
    if (existing) {
      return err(`相同 Provider（${provider}）下已存在名稱為「${name}」的 App`);
    }

    const id = uuidv4();
    const configJson = encryptionService.encrypt(JSON.stringify(config));
    this.stmts.insert.run({
      $id: id,
      $provider: provider,
      $name: name,
      $configJson: configJson,
      $extraJson: null,
    });

    const app: IntegrationApp = {
      id,
      provider,
      name,
      config,
      connectionStatus: "disconnected",
      resources: [],
    };

    return ok(app);
  }

  list(provider?: string): IntegrationApp[] {
    const rows = provider
      ? (this.stmts.selectByProvider.all(provider) as IntegrationAppRow[])
      : (this.stmts.selectAll.all() as IntegrationAppRow[]);
    return rows.map((row) => this.rowToApp(row));
  }

  getById(id: string): IntegrationApp | undefined {
    const row = this.stmts.selectById.get(id) as IntegrationAppRow | undefined;
    if (!row) return undefined;
    return this.rowToApp(row);
  }

  getByProviderAndConfigField(
    provider: string,
    jsonPath: string,
    value: string,
  ): IntegrationApp | undefined {
    // 白名單驗證：jsonPath 只允許 $.fieldName 格式（字母、數字、底線）
    if (!/^\$\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(jsonPath)) {
      throw new Error(`非法的 jsonPath 格式：${jsonPath}`);
    }
    // 加密後無法使用 SQLite 的 json_extract 查詢，改為應用層過濾
    const rows = this.stmts.selectByProvider.all(
      provider,
    ) as IntegrationAppRow[];
    for (const row of rows) {
      const app = this.rowToApp(row);
      const fieldName = jsonPath.slice(2);
      if (app.config[fieldName] === value) {
        return app;
      }
    }
    return undefined;
  }

  updateStatus(id: string, status: IntegrationConnectionStatus): void {
    const current = this.runtimeState.get(id) ?? {
      connectionStatus: "disconnected",
      resources: [],
    };
    this.runtimeState.set(id, { ...current, connectionStatus: status });
  }

  updateResources(id: string, resources: IntegrationResource[]): void {
    const current = this.runtimeState.get(id) ?? {
      connectionStatus: "disconnected",
      resources: [],
    };
    this.runtimeState.set(id, { ...current, resources });
  }

  updateExtraJson(id: string, extra: Record<string, unknown>): void {
    this.stmts.updateExtraJson.run({
      $extraJson: JSON.stringify(extra),
      $id: id,
    });
  }

  getByProviderAndName(
    provider: string,
    name: string,
  ): IntegrationApp | undefined {
    const row = this.stmts.selectByProviderAndName.get({
      $provider: provider,
      $name: name,
    }) as IntegrationAppRow | undefined;
    if (!row) return undefined;
    return this.rowToApp(row);
  }

  migrateUnencryptedConfigs(): number {
    const rows = this.stmts.selectAll.all() as IntegrationAppRow[];
    let migratedCount = 0;

    for (const row of rows) {
      try {
        const needsMigration =
          !encryptionService.isEncrypted(row.config_json) ||
          encryptionService.isLegacyEncrypted(row.config_json);

        if (needsMigration) {
          // 若為舊格式加密，先解密再以新格式重新加密；若為明文則直接加密
          const plaintext = encryptionService.isLegacyEncrypted(row.config_json)
            ? encryptionService.decrypt(row.config_json)
            : row.config_json;
          const encrypted = encryptionService.encrypt(plaintext);
          this.stmts.updateConfigJson.run({
            $configJson: encrypted,
            $id: row.id,
          });
          migratedCount++;
        }
      } catch (error) {
        logger.error(
          "Encryption",
          "Error",
          `App ${row.id} (${row.provider}:${row.name}) 憑證遷移失敗`,
          error,
        );
      }
    }

    if (migratedCount > 0) {
      logger.log(
        "Encryption",
        "Migrate",
        `已將 ${migratedCount} 筆 Integration App 憑證加密`,
      );
    }

    return migratedCount;
  }

  delete(id: string): boolean {
    const result = this.stmts.deleteById.run(id);
    this.runtimeState.delete(id);
    return result.changes > 0;
  }
}

export const integrationAppStore = new IntegrationAppStore();
