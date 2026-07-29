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
  IntegrationProvider,
  IntegrationResource,
} from "./types.js";
import { encryptionService } from "../encryptionService.js";
import { logger } from "../../utils/logger.js";
import { secretStore } from "../secretStore.js";

const SECRET_STORAGE_VERSION = 1;

interface IntegrationAppRow {
  id: string;
  provider: string;
  name: string;
  config_json: string;
  extra_json: string | null;
  secret_storage_version: number;
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

  private parseConfigJson(
    row: IntegrationAppRow,
    allowEncrypted: boolean,
  ): IntegrationAppConfig {
    let configJson = row.config_json;
    if (allowEncrypted && encryptionService.isEncrypted(configJson)) {
      configJson = encryptionService.decrypt(configJson);
    }

    const parsed = JSON.parse(configJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Integration App config_json 不是物件");
    }
    return parsed as IntegrationAppConfig;
  }

  private splitConfig(
    provider: IntegrationProvider | undefined,
    config: IntegrationAppConfig,
  ): {
    publicConfig: IntegrationAppConfig;
    secretConfig: IntegrationAppConfig;
  } {
    const secretKeys = new Set(
      provider?.secretConfigKeys ?? Object.keys(config),
    );
    const publicConfig: IntegrationAppConfig = {};
    const secretConfig: IntegrationAppConfig = {};

    for (const [key, value] of Object.entries(config)) {
      if (secretKeys.has(key)) {
        secretConfig[key] = value;
      } else {
        publicConfig[key] = value;
      }
    }

    return { publicConfig, secretConfig };
  }

  private storeSecretConfig(
    provider: IntegrationProvider | undefined,
    appId: string,
    config: IntegrationAppConfig,
  ): IntegrationAppConfig {
    const { publicConfig, secretConfig } = this.splitConfig(provider, config);
    secretStore.set("integration-app", appId, secretConfig);
    return publicConfig;
  }

  private rowToApp(row: IntegrationAppRow): IntegrationApp {
    const runtime = this.runtimeState.get(row.id);
    const baseApp = {
      id: row.id,
      provider: row.provider,
      name: row.name,
      connectionStatus: runtime?.connectionStatus ?? "disconnected",
      resources: runtime?.resources ?? [],
    };

    try {
      if (row.secret_storage_version < SECRET_STORAGE_VERSION) {
        return {
          ...baseApp,
          config: this.parseConfigJson(row, true),
          hasCredentials: true,
        };
      }

      const publicConfig = this.parseConfigJson(row, false);
      const secretConfig = secretStore.get("integration-app", row.id);
      return {
        ...baseApp,
        config: { ...publicConfig, ...(secretConfig ?? {}) },
        hasCredentials: secretConfig !== undefined,
      };
    } catch (error) {
      logger.error(
        "Integration",
        "Error",
        `App ${row.id} (${row.provider}:${row.name}) 的設定讀取失敗，需重新設定`,
        error,
      );
      return {
        ...baseApp,
        config: {},
        hasCredentials: false,
      };
    }
  }

  /**
   * 將 canvas.db 舊版 config_json 內的憑證搬到 secrets.db。
   * migration 失敗時直接中止啟動，避免備份排程先把舊憑證推到遠端。
   */
  migrateSecrets(): void {
    const rows = this.stmts.selectAll.all() as IntegrationAppRow[];
    let migratedCount = 0;

    for (const row of rows) {
      if (row.secret_storage_version >= SECRET_STORAGE_VERSION) continue;

      const config = this.parseConfigJson(row, true);
      const provider = integrationRegistry.get(row.provider);
      const publicConfig = this.storeSecretConfig(provider, row.id, config);
      this.stmts.updateConfigAndSecretVersion.run({
        $id: row.id,
        $configJson: JSON.stringify(publicConfig),
        $secretStorageVersion: SECRET_STORAGE_VERSION,
      });
      migratedCount += 1;
    }

    if (migratedCount > 0) {
      logger.log(
        "Integration",
        "Update",
        `已將 ${migratedCount} 筆 Integration App 憑證搬移至 secrets.db`,
      );
    }
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
    }) as IntegrationAppRow | undefined;
    if (existing) {
      const existingApp = this.rowToApp(existing);
      if (existingApp.hasCredentials === false) {
        const publicConfig = this.storeSecretConfig(
          integrationProvider,
          existing.id,
          config,
        );
        this.stmts.updateConfigAndSecretVersion.run({
          $id: existing.id,
          $configJson: JSON.stringify(publicConfig),
          $secretStorageVersion: SECRET_STORAGE_VERSION,
        });
        return ok({
          ...existingApp,
          config,
          hasCredentials: true,
        });
      }
      return err(`相同 Provider（${provider}）下已存在名稱為「${name}」的 App`);
    }

    const id = uuidv4();
    const publicConfig = this.storeSecretConfig(
      integrationProvider,
      id,
      config,
    );
    try {
      this.stmts.insert.run({
        $id: id,
        $provider: provider,
        $name: name,
        $configJson: JSON.stringify(publicConfig),
        $extraJson: null,
        $secretStorageVersion: SECRET_STORAGE_VERSION,
      });
    } catch (error) {
      secretStore.delete("integration-app", id);
      throw error;
    }

    const app: IntegrationApp = {
      id,
      provider,
      name,
      config,
      hasCredentials: true,
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

  delete(id: string): boolean {
    const result = this.stmts.deleteById.run(id);
    if (result.changes > 0) {
      secretStore.delete("integration-app", id);
    }
    this.runtimeState.delete(id);
    return result.changes > 0;
  }
}

export const integrationAppStore = new IntegrationAppStore();
