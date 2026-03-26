import { defineStore } from "pinia";
import { ref } from "vue";
import { getConfig } from "@/services/configApi";

export const useConfigStore = defineStore("config", () => {
  const timezoneOffset = ref<number>(8);

  // 備份相關狀態
  const backupGitRemoteUrl = ref<string>("");
  const backupTime = ref<string>("03:00");
  const backupEnabled = ref<boolean>(false);
  const backupStatus = ref<"idle" | "running" | "success" | "failed">("idle");
  const lastBackupError = ref<string | null>(null);
  const lastBackupTime = ref<string | null>(null);

  const fetchConfig = async (): Promise<void> => {
    const result = await getConfig();
    if (result.timezoneOffset !== undefined) {
      timezoneOffset.value = result.timezoneOffset;
    }
    if (result.backupGitRemoteUrl !== undefined) {
      backupGitRemoteUrl.value = result.backupGitRemoteUrl;
    }
    if (result.backupTime !== undefined) {
      backupTime.value = result.backupTime;
    }
    if (result.backupEnabled !== undefined) {
      backupEnabled.value = result.backupEnabled;
    }
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
    fetchConfig,
    setTimezoneOffset,
    setBackupConfig,
    setBackupStatus,
    setLastBackupTime,
  };
});
