import { defineStore } from "pinia";
import { ref, type Ref } from "vue";
import { getConfig } from "@/services/configApi";
import type { PodProvider } from "@/types/pod";

interface ModelSettingsConfig {
  provider: PodProvider | null;
  model: string;
  thinkingLevel: string | null;
}

type LoadedConfig = Awaited<ReturnType<typeof getConfig>>;

function setIfDefined<T>(target: Ref<T>, value: T | undefined): void {
  if (value !== undefined) target.value = value;
}

function readModelSettings(
  config: LoadedConfig,
  keys: {
    provider: "memoryProvider" | "connectionLineProvider";
    model: "memoryModel" | "connectionLineModel";
    thinkingLevel: "memoryThinkingLevel" | "connectionLineThinkingLevel";
  },
): ModelSettingsConfig {
  const hasConfig = Object.values(keys).some((key) => key in config);
  if (!hasConfig) {
    return { provider: null, model: "", thinkingLevel: null };
  }

  return {
    provider: config[keys.provider] ?? null,
    model: config[keys.model] ?? "",
    thinkingLevel: config[keys.thinkingLevel] ?? null,
  };
}

export const useConfigStore = defineStore("config", () => {
  const timezoneOffset = ref<number>(8);

  // 備份相關狀態
  const backupGitRemoteUrl = ref<string>("");
  const backupTime = ref<string>("03:00");
  const backupEnabled = ref<boolean>(false);
  const backupStatus = ref<"idle" | "running" | "success" | "failed">("idle");
  const lastBackupError = ref<string | null>(null);
  const lastBackupTime = ref<string | null>(null);
  const memoryProvider = ref<PodProvider | null>(null);
  const memoryModel = ref<string>("");
  const memoryThinkingLevel = ref<string | null>(null);
  const connectionLineProvider = ref<PodProvider | null>(null);
  const connectionLineModel = ref<string>("");
  const connectionLineThinkingLevel = ref<string | null>(null);

  const fetchConfig = async (): Promise<void> => {
    const result = await getConfig();
    setIfDefined(timezoneOffset, result.timezoneOffset);
    setIfDefined(backupGitRemoteUrl, result.backupGitRemoteUrl);
    setIfDefined(backupTime, result.backupTime);
    setIfDefined(backupEnabled, result.backupEnabled);

    setMemoryConfig(
      readModelSettings(result, {
        provider: "memoryProvider",
        model: "memoryModel",
        thinkingLevel: "memoryThinkingLevel",
      }),
    );
    setConnectionLineConfig(
      readModelSettings(result, {
        provider: "connectionLineProvider",
        model: "connectionLineModel",
        thinkingLevel: "connectionLineThinkingLevel",
      }),
    );
  };

  const setTimezoneOffset = (offset: number): void => {
    timezoneOffset.value = offset;
  };

  const setBackupConfig = (config: {
    gitRemoteUrl: string;
    time: string;
    enabled: boolean;
  }): void => {
    backupGitRemoteUrl.value = config.gitRemoteUrl;
    backupTime.value = config.time;
    backupEnabled.value = config.enabled;
  };

  const setMemoryConfig = (config: ModelSettingsConfig): void => {
    memoryProvider.value = config.provider;
    memoryModel.value = config.model;
    memoryThinkingLevel.value = config.thinkingLevel;
  };

  const setConnectionLineConfig = (config: ModelSettingsConfig): void => {
    connectionLineProvider.value = config.provider;
    connectionLineModel.value = config.model;
    connectionLineThinkingLevel.value = config.thinkingLevel;
  };

  const setBackupStatus = (
    status: "idle" | "running" | "success" | "failed",
    error?: string | null,
  ): void => {
    backupStatus.value = status;
    lastBackupError.value = error ?? null;
  };

  const setLastBackupTime = (time: string): void => {
    lastBackupTime.value = time;
  };

  return {
    timezoneOffset,
    backupGitRemoteUrl,
    backupTime,
    backupEnabled,
    backupStatus,
    lastBackupError,
    lastBackupTime,
    memoryProvider,
    memoryModel,
    memoryThinkingLevel,
    connectionLineProvider,
    connectionLineModel,
    connectionLineThinkingLevel,
    fetchConfig,
    setTimezoneOffset,
    setBackupConfig,
    setMemoryConfig,
    setConnectionLineConfig,
    setBackupStatus,
    setLastBackupTime,
  };
});
