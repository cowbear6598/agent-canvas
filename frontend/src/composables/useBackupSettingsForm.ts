import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { triggerBackup as triggerBackupApi } from "@/services/backupApi";
import type { ConfigGetResultPayload } from "@/types/websocket/responses";

type BackupStatus = "idle" | "running" | "success" | "failed";

interface BackupConfigStoreLike {
  backupStatus: BackupStatus;
  lastBackupError: string | null;
  setBackupConfig(config: {
    gitRemoteUrl: string;
    time: string;
    enabled: boolean;
  }): void;
}

interface UseBackupSettingsFormOptions {
  configStore: BackupConfigStoreLike;
  t: (key: string) => string;
  triggerBackup?: typeof triggerBackupApi;
}

export interface BackupSettingsPayload {
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
}

interface BackupSettingsForm {
  backupGitRemoteUrl: Ref<string>;
  backupHour: Ref<string>;
  backupMinute: Ref<string>;
  backupEnabled: Ref<boolean>;
  backupUrlError: Ref<boolean>;
  backupError: Ref<string | null>;
  isBackingUp: ComputedRef<boolean>;
  isBackupActionsDisabled: ComputedRef<boolean>;
  applyLoadedConfig: (config: ConfigGetResultPayload) => void;
  validateBeforeSave: () => boolean;
  buildSavePayload: () => BackupSettingsPayload;
  applySavedConfig: (payload: BackupSettingsPayload) => void;
  handleBackupRemoteInput: () => void;
  handleTriggerBackup: () => Promise<void>;
}

export function useBackupSettingsForm({
  configStore,
  t,
  triggerBackup = triggerBackupApi,
}: UseBackupSettingsFormOptions): BackupSettingsForm {
  const backupGitRemoteUrl = ref<string>("");
  const backupHour = ref<string>("03");
  const backupMinute = ref<string>("00");
  const backupEnabled = ref<boolean>(false);
  const backupUrlError = ref<boolean>(false);
  const backupError = ref<string | null>(null);

  const isBackingUp = computed<boolean>(
    () => configStore.backupStatus === "running",
  );
  const isBackupActionsDisabled = computed<boolean>(
    () => !backupEnabled.value || backupGitRemoteUrl.value === "",
  );

  const applyLoadedConfig = (config: ConfigGetResultPayload): void => {
    backupGitRemoteUrl.value = config.backupGitRemoteUrl ?? "";
    backupEnabled.value = config.backupEnabled ?? false;

    if (config.backupTime) {
      const parts = config.backupTime.split(":");
      backupHour.value = parts[0] ?? "03";
      backupMinute.value = parts[1] ?? "00";
    }

    configStore.setBackupConfig({
      gitRemoteUrl: backupGitRemoteUrl.value,
      time: `${backupHour.value}:${backupMinute.value}`,
      enabled: backupEnabled.value,
    });
  };

  const validateBeforeSave = (): boolean => {
    if (backupEnabled.value && backupGitRemoteUrl.value.trim() === "") {
      backupUrlError.value = true;
      return false;
    }

    return true;
  };

  const buildSavePayload = (): BackupSettingsPayload => {
    const backupGitRemoteUrlToSave = backupEnabled.value
      ? backupGitRemoteUrl.value
      : "";

    return {
      backupGitRemoteUrl: backupGitRemoteUrlToSave,
      backupTime: `${backupHour.value}:${backupMinute.value}`,
      backupEnabled: backupEnabled.value,
    };
  };

  const applySavedConfig = (payload: BackupSettingsPayload): void => {
    backupGitRemoteUrl.value = payload.backupGitRemoteUrl;
    configStore.setBackupConfig({
      gitRemoteUrl: payload.backupGitRemoteUrl,
      time: payload.backupTime,
      enabled: payload.backupEnabled,
    });
  };

  const handleBackupRemoteInput = (): void => {
    backupUrlError.value = false;
    backupError.value = null;
  };

  const handleTriggerBackup = async (): Promise<void> => {
    backupError.value = null;
    try {
      await triggerBackup(backupGitRemoteUrl.value);
    } catch (err) {
      backupError.value =
        err instanceof Error ? err.message : t("settings.backup.backingUp");
    }
  };

  watch(
    () => ({
      status: configStore.backupStatus,
      error: configStore.lastBackupError,
    }),
    ({ status, error }) => {
      if (status === "failed" && error) {
        backupError.value = error;
      } else if (status === "running") {
        backupError.value = null;
      }
    },
  );

  return {
    backupGitRemoteUrl,
    backupHour,
    backupMinute,
    backupEnabled,
    backupUrlError,
    backupError,
    isBackingUp,
    isBackupActionsDisabled,
    applyLoadedConfig,
    validateBeforeSave,
    buildSavePayload,
    applySavedConfig,
    handleBackupRemoteInput,
    handleTriggerBackup,
  };
}
