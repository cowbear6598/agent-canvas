import { getStmts } from "../database/stmtsHelper.js";
import type { ModelType } from "../types/pod.js";

interface GlobalSettingRow {
  key: string;
  value: string;
}

const SUMMARY_MODEL_KEY = "summary_model";
const AI_DECIDE_MODEL_KEY = "ai_decide_model";
const TIMEZONE_OFFSET_KEY = "timezone_offset";
const BACKUP_GIT_REMOTE_URL_KEY = "backup_git_remote_url";
const BACKUP_TIME_KEY = "backup_time";
const BACKUP_ENABLED_KEY = "backup_enabled";

const DEFAULT_MODEL: ModelType = "sonnet";
const DEFAULT_TIMEZONE_OFFSET = 8;
const DEFAULT_BACKUP_GIT_REMOTE_URL = "";
const DEFAULT_BACKUP_TIME = "03:00";
const DEFAULT_BACKUP_ENABLED = false;

export interface ConfigData {
  summaryModel: ModelType;
  aiDecideModel: ModelType;
  timezoneOffset: number;
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
}

export interface BackupConfig {
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
}

export class ConfigStore {
  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  private parseTimezoneOffset(value: string | undefined): number {
    const parsed = Number(value);
    return isNaN(parsed) ? DEFAULT_TIMEZONE_OFFSET : parsed;
  }

  getAll(): ConfigData {
    const rows =
      this.stmts.globalSettings.selectAll.all() as GlobalSettingRow[];
    const map = new Map(rows.map((row) => [row.key, row.value]));

    return {
      summaryModel: (map.get(SUMMARY_MODEL_KEY) as ModelType) ?? DEFAULT_MODEL,
      aiDecideModel:
        (map.get(AI_DECIDE_MODEL_KEY) as ModelType) ?? DEFAULT_MODEL,
      timezoneOffset: this.parseTimezoneOffset(map.get(TIMEZONE_OFFSET_KEY)),
      backupGitRemoteUrl:
        map.get(BACKUP_GIT_REMOTE_URL_KEY) ?? DEFAULT_BACKUP_GIT_REMOTE_URL,
      backupTime: map.get(BACKUP_TIME_KEY) ?? DEFAULT_BACKUP_TIME,
      backupEnabled:
        map.get(BACKUP_ENABLED_KEY) === "true" ? true : DEFAULT_BACKUP_ENABLED,
    };
  }

  update(data: Partial<ConfigData>): ConfigData {
    if (data.summaryModel !== undefined) {
      this.stmts.globalSettings.upsert.run({
        $key: SUMMARY_MODEL_KEY,
        $value: data.summaryModel,
      });
    }

    if (data.aiDecideModel !== undefined) {
      this.stmts.globalSettings.upsert.run({
        $key: AI_DECIDE_MODEL_KEY,
        $value: data.aiDecideModel,
      });
    }

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

  getSummaryModel(): ModelType {
    const row = this.stmts.globalSettings.selectByKey.get(SUMMARY_MODEL_KEY) as
      | GlobalSettingRow
      | undefined;
    return (row?.value as ModelType) ?? DEFAULT_MODEL;
  }

  getAiDecideModel(): ModelType {
    const row = this.stmts.globalSettings.selectByKey.get(
      AI_DECIDE_MODEL_KEY,
    ) as GlobalSettingRow | undefined;
    return (row?.value as ModelType) ?? DEFAULT_MODEL;
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
}

export const configStore = new ConfigStore();
