import { getStmts } from "../database/stmtsHelper.js";
import type { ModelType } from "../types/pod.js";

interface GlobalSettingRow {
  key: string;
  value: string;
}

const SUMMARY_MODEL_KEY = "summary_model";
const AI_DECIDE_MODEL_KEY = "ai_decide_model";
const ENABLED_PLUGINS_KEY = "enabled_plugins";
const DEFAULT_MODEL: ModelType = "sonnet";

function parseStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x: unknown) => typeof x === "string");
  } catch {
    return [];
  }
}

export interface ConfigData {
  summaryModel: ModelType;
  aiDecideModel: ModelType;
  enabledPluginIds: string[];
}

export class ConfigStore {
  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  getAll(): ConfigData {
    const rows =
      this.stmts.globalSettings.selectAll.all() as GlobalSettingRow[];
    const map = new Map(rows.map((row) => [row.key, row.value]));

    return {
      summaryModel: (map.get(SUMMARY_MODEL_KEY) as ModelType) ?? DEFAULT_MODEL,
      aiDecideModel:
        (map.get(AI_DECIDE_MODEL_KEY) as ModelType) ?? DEFAULT_MODEL,
      enabledPluginIds: parseStringArray(map.get(ENABLED_PLUGINS_KEY)),
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

    if (data.enabledPluginIds !== undefined) {
      this.stmts.globalSettings.upsert.run({
        $key: ENABLED_PLUGINS_KEY,
        $value: JSON.stringify(data.enabledPluginIds),
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

  getEnabledPluginIds(): string[] {
    const row = this.stmts.globalSettings.selectByKey.get(
      ENABLED_PLUGINS_KEY,
    ) as GlobalSettingRow | undefined;
    return parseStringArray(row?.value);
  }
}

export const configStore = new ConfigStore();
