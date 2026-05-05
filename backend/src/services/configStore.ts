import { getStmts } from "../database/stmtsHelper.js";

interface GlobalSettingRow {
  key: string;
  value: string;
}

const TIMEZONE_OFFSET_KEY = "timezone_offset";
const BACKUP_GIT_REMOTE_URL_KEY = "backup_git_remote_url";
const BACKUP_TIME_KEY = "backup_time";
const BACKUP_ENABLED_KEY = "backup_enabled";
const WORKSPACE_PASSWORD_HASH_KEY = "workspace_password_hash";
const WORKSPACE_PASSWORD_VERSION_KEY = "workspace_password_version";

const DEFAULT_TIMEZONE_OFFSET = 8;
const DEFAULT_BACKUP_GIT_REMOTE_URL = "";
const DEFAULT_BACKUP_TIME = "03:00";
const DEFAULT_BACKUP_ENABLED = false;
const DEFAULT_WORKSPACE_PASSWORD_VERSION = 0;

export interface ConfigData {
  timezoneOffset: number;
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
  hasWorkspacePassword: boolean;
  workspacePasswordVersion: number;
}

export interface BackupConfig {
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
}

export interface WorkspacePasswordState {
  passwordHash: string | null;
  hasWorkspacePassword: boolean;
  passwordVersion: number;
}

export class ConfigStore {
  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
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

  getAll(): ConfigData {
    const rows =
      this.stmts.globalSettings.selectAll.all() as GlobalSettingRow[];
    const map = new Map(rows.map((row) => [row.key, row.value]));

    return {
      timezoneOffset: this.parseTimezoneOffset(map.get(TIMEZONE_OFFSET_KEY)),
      backupGitRemoteUrl:
        map.get(BACKUP_GIT_REMOTE_URL_KEY) ?? DEFAULT_BACKUP_GIT_REMOTE_URL,
      backupTime: map.get(BACKUP_TIME_KEY) ?? DEFAULT_BACKUP_TIME,
      backupEnabled:
        map.get(BACKUP_ENABLED_KEY) === "true" ? true : DEFAULT_BACKUP_ENABLED,
      hasWorkspacePassword: !!map.get(WORKSPACE_PASSWORD_HASH_KEY),
      workspacePasswordVersion: this.parseVersion(
        map.get(WORKSPACE_PASSWORD_VERSION_KEY),
      ),
    };
  }

  update(data: Partial<ConfigData>): ConfigData {
    if (data.timezoneOffset !== undefined) {
      this.stmts.globalSettings.upsert.run({
        $key: TIMEZONE_OFFSET_KEY,
        $value: String(data.timezoneOffset),
      });
    }

    if (data.backupGitRemoteUrl !== undefined) {
      this.stmts.globalSettings.upsert.run({
        $key: BACKUP_GIT_REMOTE_URL_KEY,
        $value: data.backupGitRemoteUrl,
      });
    }

    if (data.backupTime !== undefined) {
      this.stmts.globalSettings.upsert.run({
        $key: BACKUP_TIME_KEY,
        $value: data.backupTime,
      });
    }

    if (data.backupEnabled !== undefined) {
      this.stmts.globalSettings.upsert.run({
        $key: BACKUP_ENABLED_KEY,
        $value: data.backupEnabled ? "true" : "false",
      });
    }

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
