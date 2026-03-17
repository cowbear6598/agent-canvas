import { v4 as uuidv4 } from 'uuid';
import { ok, err } from '../../types/index.js';
import type { Result } from '../../types/index.js';
import type { IntegrationConnectionStatus } from '../../types/integration.js';
import { getDb } from '../../database/index.js';
import { getStatements } from '../../database/statements.js';
import { integrationRegistry } from './integrationRegistry.js';
import type { IntegrationApp, IntegrationAppConfig, IntegrationResource } from './types.js';

interface IntegrationAppRow {
  id: string;
  provider: string;
  name: string;
  config_json: string;
  extra_json: string | null;
}

class IntegrationAppStore {
  private runtimeState: Map<string, { connectionStatus: IntegrationConnectionStatus; resources: IntegrationResource[] }> =
    new Map();

  private get stmts(): ReturnType<typeof getStatements>['integrationApp'] {
    return getStatements(getDb()).integrationApp;
  }

  private rowToApp(row: IntegrationAppRow): IntegrationApp {
    const runtime = this.runtimeState.get(row.id);
    const config = JSON.parse(row.config_json) as IntegrationAppConfig;
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      config,
      connectionStatus: runtime?.connectionStatus ?? 'disconnected',
      resources: runtime?.resources ?? [],
    };
  }

  create(provider: string, name: string, config: IntegrationAppConfig): Result<IntegrationApp> {
    const integrationProvider = integrationRegistry.getOrThrow(provider);

    const validateResult = integrationProvider.validateCreate(config);
    if (!validateResult.success) {
      return err(validateResult.error);
    }

    const existing = this.stmts.selectByProviderAndName.get({ $provider: provider, $name: name });
    if (existing) {
      return err(`相同 Provider（${provider}）下已存在名稱為「${name}」的 App`);
    }

    const id = uuidv4();
    const configJson = JSON.stringify(config);
    this.stmts.insert.run({ $id: id, $provider: provider, $name: name, $configJson: configJson, $extraJson: null });

    const app: IntegrationApp = {
      id,
      provider,
      name,
      config,
      connectionStatus: 'disconnected',
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

  getByProviderAndConfigField(provider: string, jsonPath: string, value: string): IntegrationApp | undefined {
    const row = this.stmts.selectByProviderAndConfigField.get({
      $provider: provider,
      $jsonPath: jsonPath,
      $value: value,
    }) as IntegrationAppRow | undefined;
    if (!row) return undefined;
    return this.rowToApp(row);
  }

  updateStatus(id: string, status: IntegrationConnectionStatus): void {
    const current = this.runtimeState.get(id) ?? { connectionStatus: 'disconnected', resources: [] };
    this.runtimeState.set(id, { ...current, connectionStatus: status });
  }

  updateResources(id: string, resources: IntegrationResource[]): void {
    const current = this.runtimeState.get(id) ?? { connectionStatus: 'disconnected', resources: [] };
    this.runtimeState.set(id, { ...current, resources });
  }

  updateExtraJson(id: string, extra: Record<string, unknown>): void {
    this.stmts.updateExtraJson.run({ $extraJson: JSON.stringify(extra), $id: id });
  }

  getByProviderAndName(provider: string, name: string): IntegrationApp | undefined {
    const row = this.stmts.selectByProviderAndName.get({ $provider: provider, $name: name }) as IntegrationAppRow | undefined;
    if (!row) return undefined;
    return this.rowToApp(row);
  }

  delete(id: string): boolean {
    const result = this.stmts.deleteById.run(id);
    this.runtimeState.delete(id);
    return result.changes > 0;
  }
}

export const integrationAppStore = new IntegrationAppStore();
