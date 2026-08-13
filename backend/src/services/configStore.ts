import { getStmts } from "../database/stmtsHelper.js";
import type { ProviderName } from "./provider/types.js";
import { resolveModelWithFallback } from "./provider/index.js";
import {
  resolveProvider,
  sanitizeProviderConfigStrict,
} from "./pod/providerConfigResolver.js";

interface GlobalSettingRow {
  key: string;
  value: string;
}

const TIMEZONE_OFFSET_KEY = "timezone_offset";
const BACKUP_GIT_REMOTE_URL_KEY = "backup_git_remote_url";
const BACKUP_TIME_KEY = "backup_time";
const BACKUP_ENABLED_KEY = "backup_enabled";
const MEMORY_PROVIDER_KEY = "memory_provider";
const MEMORY_MODEL_KEY = "memory_model";
const MEMORY_THINKING_LEVEL_KEY = "memory_thinking_level";
const CONNECTION_LINE_PROVIDER_KEY = "connection_line_provider";
const CONNECTION_LINE_MODEL_KEY = "connection_line_model";
const CONNECTION_LINE_THINKING_LEVEL_KEY = "connection_line_thinking_level";
const WORKSPACE_PASSWORD_HASH_KEY = "workspace_password_hash";
const WORKSPACE_PASSWORD_VERSION_KEY = "workspace_password_version";

const DEFAULT_TIMEZONE_OFFSET = 8;
const DEFAULT_BACKUP_GIT_REMOTE_URL = "";
const DEFAULT_BACKUP_TIME = "03:00";
const DEFAULT_BACKUP_ENABLED = false;
const DEFAULT_MEMORY_PROVIDER: ProviderName = "claude";
const DEFAULT_CONNECTION_LINE_PROVIDER: ProviderName = "claude";
const DEFAULT_WORKSPACE_PASSWORD_VERSION = 0;

export interface ConfigData {
  timezoneOffset: number;
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
  memoryProvider: ProviderName;
  memoryModel: string;
  memoryThinkingLevel: string | null;
  connectionLineProvider: ProviderName;
  connectionLineModel: string;
  connectionLineThinkingLevel: string | null;
  hasWorkspacePassword: boolean;
  workspacePasswordVersion: number;
}

export interface BackupConfig {
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
}

export interface MemoryConfig {
  memoryProvider: ProviderName;
  memoryModel: string;
  memoryThinkingLevel: string | null;
}

export interface ConnectionLineModelConfig {
  connectionLineProvider: ProviderName;
  connectionLineModel: string;
  connectionLineThinkingLevel: string | null;
}

export interface WorkspacePasswordState {
  passwordHash: string | null;
  hasWorkspacePassword: boolean;
  passwordVersion: number;
}

interface ProviderModelConfig {
  provider: ProviderName;
  model: string;
  thinkingLevel: string | null;
}

export class ConfigStore {
  private cachedStmts: ReturnType<typeof getStmts> | null = null;
  private connectionLineModelConfigCache: ConnectionLineModelConfig | null =
    null;

  private get stmts(): ReturnType<typeof getStmts> {
    const stmts = getStmts();
    if (this.cachedStmts !== stmts) {
      this.cachedStmts = stmts;
      this.connectionLineModelConfigCache = null;
    }
    return stmts;
  }

  private invalidateConnectionLineModelConfigCache(): void {
    this.connectionLineModelConfigCache = null;
  }

  private parseTimezoneOffset(value: string | undefined): number {
    const parsed = Number(value);
    return isNaN(parsed) ? DEFAULT_TIMEZONE_OFFSET : parsed;
  }

  private parseVersion(value: string | undefined): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_WORKSPACE_PASSWORD_VERSION;
  }

  private getDefaultMemoryModel(provider: ProviderName): string {
    const defaultModel = resolveModelWithFallback(provider, "").resolved;
    return typeof defaultModel === "string" ? defaultModel : "";
  }

  private getDefaultConnectionLineModel(provider: ProviderName): string {
    const defaultModel = resolveModelWithFallback(provider, "").resolved;
    return typeof defaultModel === "string" ? defaultModel : "";
  }

  private parseMemoryProvider(value: string | undefined): ProviderName {
    if (!value) return DEFAULT_MEMORY_PROVIDER;
    return resolveProvider(value);
  }

  private parseConnectionLineProvider(value: string | undefined): ProviderName {
    if (!value) return DEFAULT_CONNECTION_LINE_PROVIDER;
    return resolveProvider(value);
  }

  private parseMemoryModel(
    provider: ProviderName,
    value: string | undefined,
  ): string {
    if (!value || value.trim().length === 0) {
      return this.getDefaultMemoryModel(provider);
    }

    return resolveModelWithFallback(provider, value).resolved;
  }

  private parseConnectionLineModel(
    provider: ProviderName,
    value: string | undefined,
  ): string {
    if (!value || value.trim().length === 0) {
      return this.getDefaultConnectionLineModel(provider);
    }

    return resolveModelWithFallback(provider, value).resolved;
  }

  private parseMemoryThinkingLevel(
    _provider: ProviderName,
    _model: string,
    value: string | undefined,
  ): string | null {
    return value && value.trim().length > 0 ? value : null;
  }

  private parseConnectionLineThinkingLevel(
    _provider: ProviderName,
    _model: string,
    value: string | undefined,
  ): string | null {
    return value && value.trim().length > 0 ? value : null;
  }

  private validateProviderModelConfig(config: ProviderModelConfig): void {
    const rawConfig: Record<string, unknown> = {
      model: config.model,
    };

    if (config.thinkingLevel !== null) {
      rawConfig.thinkingLevel = config.thinkingLevel;
    }

    sanitizeProviderConfigStrict(rawConfig, config.provider);
  }

  private validateModelConfigUpdate(data: Partial<ConfigData>): void {
    const updatesMemoryConfig = this.hasDefinedValue(
      data.memoryProvider,
      data.memoryModel,
      data.memoryThinkingLevel,
    );
    const updatesConnectionLineConfig = this.hasDefinedValue(
      data.connectionLineProvider,
      data.connectionLineModel,
      data.connectionLineThinkingLevel,
    );

    if (!updatesMemoryConfig && !updatesConnectionLineConfig) {
      return;
    }

    const current = this.getAll();

    if (updatesMemoryConfig) {
      this.validateProviderModelConfig({
        provider: data.memoryProvider ?? current.memoryProvider,
        model: data.memoryModel ?? current.memoryModel,
        thinkingLevel:
          data.memoryThinkingLevel !== undefined
            ? data.memoryThinkingLevel
            : current.memoryThinkingLevel,
      });
    }

    if (updatesConnectionLineConfig) {
      this.validateProviderModelConfig({
        provider: data.connectionLineProvider ?? current.connectionLineProvider,
        model: data.connectionLineModel ?? current.connectionLineModel,
        thinkingLevel:
          data.connectionLineThinkingLevel !== undefined
            ? data.connectionLineThinkingLevel
            : current.connectionLineThinkingLevel,
      });
    }
  }

  private hasDefinedValue(...values: unknown[]): boolean {
    return values.some((value) => value !== undefined);
  }

  private updateDefinedSettings(
    entries: Array<{ key: string; value: string | number | boolean | undefined }>,
  ): void {
    for (const { key, value } of entries) {
      if (value === undefined) continue;
      this.stmts.globalSettings.upsert.run({
        $key: key,
        $value: String(value),
      });
    }
  }

  private updateNullableSetting(
    key: string,
    value: string | null | undefined,
  ): void {
    if (value === undefined) return;
    if (value === null) {
      this.stmts.globalSettings.deleteByKey.run(key);
      return;
    }
    this.stmts.globalSettings.upsert.run({ $key: key, $value: value });
  }

  private buildConnectionLineModelConfig(
    connectionLineProvider: ProviderName,
    connectionLineModel: string,
    connectionLineThinkingLevel: string | null,
  ): ConnectionLineModelConfig {
    return {
      connectionLineProvider,
      connectionLineModel,
      connectionLineThinkingLevel,
    };
  }

  private readConnectionLineModelConfig(): ConnectionLineModelConfig {
    const providerRow = this.stmts.globalSettings.selectByKey.get(
      CONNECTION_LINE_PROVIDER_KEY,
    ) as GlobalSettingRow | undefined;
    const modelRow = this.stmts.globalSettings.selectByKey.get(
      CONNECTION_LINE_MODEL_KEY,
    ) as GlobalSettingRow | undefined;
    const thinkingLevelRow = this.stmts.globalSettings.selectByKey.get(
      CONNECTION_LINE_THINKING_LEVEL_KEY,
    ) as GlobalSettingRow | undefined;
    const connectionLineProvider = this.parseConnectionLineProvider(
      providerRow?.value,
    );
    const connectionLineModel = this.parseConnectionLineModel(
      connectionLineProvider,
      modelRow?.value,
    );

    return this.buildConnectionLineModelConfig(
      connectionLineProvider,
      connectionLineModel,
      this.parseConnectionLineThinkingLevel(
        connectionLineProvider,
        connectionLineModel,
        thinkingLevelRow?.value,
      ),
    );
  }

  getAll(): ConfigData {
    const rows =
      this.stmts.globalSettings.selectAll.all() as GlobalSettingRow[];
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const memoryProvider = this.parseMemoryProvider(map.get(MEMORY_PROVIDER_KEY));
    const memoryModel = this.parseMemoryModel(
      memoryProvider,
      map.get(MEMORY_MODEL_KEY),
    );
    const connectionLineProvider = this.parseConnectionLineProvider(
      map.get(CONNECTION_LINE_PROVIDER_KEY),
    );
    const connectionLineModel = this.parseConnectionLineModel(
      connectionLineProvider,
      map.get(CONNECTION_LINE_MODEL_KEY),
    );

    const config = {
      timezoneOffset: this.parseTimezoneOffset(map.get(TIMEZONE_OFFSET_KEY)),
      backupGitRemoteUrl:
        map.get(BACKUP_GIT_REMOTE_URL_KEY) ?? DEFAULT_BACKUP_GIT_REMOTE_URL,
      backupTime: map.get(BACKUP_TIME_KEY) ?? DEFAULT_BACKUP_TIME,
      backupEnabled:
        map.get(BACKUP_ENABLED_KEY) === "true" ? true : DEFAULT_BACKUP_ENABLED,
      memoryProvider,
      memoryModel,
      memoryThinkingLevel: this.parseMemoryThinkingLevel(
        memoryProvider,
        memoryModel,
        map.get(MEMORY_THINKING_LEVEL_KEY),
      ),
      connectionLineProvider,
      connectionLineModel,
      connectionLineThinkingLevel: this.parseConnectionLineThinkingLevel(
        connectionLineProvider,
        connectionLineModel,
        map.get(CONNECTION_LINE_THINKING_LEVEL_KEY),
      ),
      hasWorkspacePassword: !!map.get(WORKSPACE_PASSWORD_HASH_KEY),
      workspacePasswordVersion: this.parseVersion(
        map.get(WORKSPACE_PASSWORD_VERSION_KEY),
      ),
    };
    this.connectionLineModelConfigCache = this.buildConnectionLineModelConfig(
      config.connectionLineProvider,
      config.connectionLineModel,
      config.connectionLineThinkingLevel,
    );

    return config;
  }

  update(data: Partial<ConfigData>): ConfigData {
    this.validateModelConfigUpdate(data);
    this.updateDefinedSettings([
      { key: TIMEZONE_OFFSET_KEY, value: data.timezoneOffset },
      { key: BACKUP_GIT_REMOTE_URL_KEY, value: data.backupGitRemoteUrl },
      { key: BACKUP_TIME_KEY, value: data.backupTime },
      { key: BACKUP_ENABLED_KEY, value: data.backupEnabled },
      { key: MEMORY_PROVIDER_KEY, value: data.memoryProvider },
      { key: MEMORY_MODEL_KEY, value: data.memoryModel },
    ]);
    this.updateNullableSetting(
      MEMORY_THINKING_LEVEL_KEY,
      data.memoryThinkingLevel,
    );

    if (
      this.hasDefinedValue(
        data.connectionLineProvider,
        data.connectionLineModel,
        data.connectionLineThinkingLevel,
      )
    ) {
      this.invalidateConnectionLineModelConfigCache();
    }
    this.updateDefinedSettings([
      { key: CONNECTION_LINE_PROVIDER_KEY, value: data.connectionLineProvider },
      { key: CONNECTION_LINE_MODEL_KEY, value: data.connectionLineModel },
    ]);
    this.updateNullableSetting(
      CONNECTION_LINE_THINKING_LEVEL_KEY,
      data.connectionLineThinkingLevel,
    );

    return this.getAll();
  }

  getTimezoneOffset(): number {
    const row = this.stmts.globalSettings.selectByKey.get(
      TIMEZONE_OFFSET_KEY,
    ) as GlobalSettingRow | undefined;
    return this.parseTimezoneOffset(row?.value);
  }

  getBackupConfig(): BackupConfig {
    const { backupGitRemoteUrl, backupTime, backupEnabled } = this.getAll();
    return { backupGitRemoteUrl, backupTime, backupEnabled };
  }

  getMemoryConfig(): MemoryConfig {
    const { memoryProvider, memoryModel, memoryThinkingLevel } = this.getAll();
    return { memoryProvider, memoryModel, memoryThinkingLevel };
  }

  getConnectionLineModelConfig(): ConnectionLineModelConfig {
    if (!this.connectionLineModelConfigCache) {
      this.connectionLineModelConfigCache = this.readConnectionLineModelConfig();
    }

    return this.connectionLineModelConfigCache;
  }

  getWorkspacePasswordState(): WorkspacePasswordState {
    const passwordRow = this.stmts.globalSettings.selectByKey.get(
      WORKSPACE_PASSWORD_HASH_KEY,
    ) as GlobalSettingRow | undefined;
    const versionRow = this.stmts.globalSettings.selectByKey.get(
      WORKSPACE_PASSWORD_VERSION_KEY,
    ) as GlobalSettingRow | undefined;

    const passwordHash = passwordRow?.value || null;

    return {
      passwordHash,
      hasWorkspacePassword: passwordHash !== null,
      passwordVersion: this.parseVersion(versionRow?.value),
    };
  }

  setWorkspacePasswordHash(passwordHash: string): WorkspacePasswordState {
    const nextVersion = this.getWorkspacePasswordState().passwordVersion + 1;

    this.stmts.globalSettings.upsert.run({
      $key: WORKSPACE_PASSWORD_HASH_KEY,
      $value: passwordHash,
    });
    this.stmts.globalSettings.upsert.run({
      $key: WORKSPACE_PASSWORD_VERSION_KEY,
      $value: String(nextVersion),
    });

    return {
      passwordHash,
      hasWorkspacePassword: true,
      passwordVersion: nextVersion,
    };
  }

  clearWorkspacePassword(): WorkspacePasswordState {
    const nextVersion = this.getWorkspacePasswordState().passwordVersion + 1;

    this.stmts.globalSettings.deleteByKey.run(WORKSPACE_PASSWORD_HASH_KEY);
    this.stmts.globalSettings.upsert.run({
      $key: WORKSPACE_PASSWORD_VERSION_KEY,
      $value: String(nextVersion),
    });

    return {
      passwordHash: null,
      hasWorkspacePassword: false,
      passwordVersion: nextVersion,
    };
  }
}

export const configStore = new ConfigStore();
