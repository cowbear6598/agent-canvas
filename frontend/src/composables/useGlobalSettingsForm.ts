import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import {
  getConfig as getConfigApi,
  updateConfig as updateConfigApi,
} from "@/services/configApi";
import { i18n, setLocale as setLocaleApi } from "@/i18n";
import type { ToastCategory } from "@/composables/useToast";
import type { ConfigGetResultPayload } from "@/types/websocket/responses";
import type { BackupSettingsPayload } from "@/composables/useBackupSettingsForm";

interface GlobalConfigStoreLike {
  setTimezoneOffset(offset: number): void;
}

interface UseGlobalSettingsFormOptions {
  configStore: GlobalConfigStoreLike;
  t: (key: string) => string;
  showSuccessToast: (
    category: ToastCategory,
    action: string,
    target?: string,
  ) => string;
  withErrorToast: <T>(
    promise: Promise<T>,
    category: ToastCategory,
    action: string,
    options?: { swallow?: boolean },
  ) => Promise<T | null>;
  getConfig?: typeof getConfigApi;
  updateConfig?: typeof updateConfigApi;
  setLocale?: typeof setLocaleApi;
  initialLocale?: string;
}

interface LoadGlobalSettingsOptions {
  onLoaded?: (config: ConfigGetResultPayload) => void;
}

interface SaveGlobalSettingsOptions {
  backupPayload: BackupSettingsPayload;
  onBackupSaved?: (payload: BackupSettingsPayload) => void;
  onSaved?: () => void;
}

interface SettingsSnapshot {
  timezoneOffset: string;
  locale: string;
}

interface GlobalSettingsForm {
  timezoneOffset: Ref<string>;
  currentLocale: Ref<string>;
  isLoading: Ref<boolean>;
  isSaving: Ref<boolean>;
  loadFailed: Ref<boolean>;
  isDirty: ComputedRef<boolean>;
  loadConfig: (options?: LoadGlobalSettingsOptions) => Promise<void>;
  handleSave: (options: SaveGlobalSettingsOptions) => Promise<void>;
}

function createSnapshot(timezoneOffset: string, locale: string): SettingsSnapshot {
  return {
    timezoneOffset,
    locale,
  };
}

export function useGlobalSettingsForm({
  configStore,
  t,
  showSuccessToast,
  withErrorToast,
  getConfig = getConfigApi,
  updateConfig = updateConfigApi,
  setLocale = setLocaleApi,
  initialLocale = i18n.global.locale.value,
}: UseGlobalSettingsFormOptions): GlobalSettingsForm {
  const timezoneOffset = ref<string>("8");
  const currentLocale = ref(initialLocale);
  const isLoading = ref<boolean>(false);
  const isSaving = ref<boolean>(false);
  const loadFailed = ref<boolean>(false);
  const lastSavedSnapshot = ref<SettingsSnapshot>(
    createSnapshot(timezoneOffset.value, currentLocale.value),
  );

  const isDirty = computed<boolean>(
    () =>
      timezoneOffset.value !== lastSavedSnapshot.value.timezoneOffset ||
      currentLocale.value !== lastSavedSnapshot.value.locale,
  );

  const loadConfig = async (
    options: LoadGlobalSettingsOptions = {},
  ): Promise<void> => {
    isLoading.value = true;
    loadFailed.value = false;
    try {
      const result = await withErrorToast(
        getConfig(),
        "Config",
        t("settings.loadFailed"),
        { swallow: true },
      );
      if (!result) {
        loadFailed.value = true;
        return;
      }

      if (result.timezoneOffset !== undefined) {
        timezoneOffset.value = String(result.timezoneOffset);
        configStore.setTimezoneOffset(result.timezoneOffset);
      }
      options.onLoaded?.(result);
      lastSavedSnapshot.value = createSnapshot(
        timezoneOffset.value,
        currentLocale.value,
      );
    } finally {
      isLoading.value = false;
    }
  };

  const handleSave = async ({
    backupPayload,
    onBackupSaved,
    onSaved,
  }: SaveGlobalSettingsOptions): Promise<void> => {
    isSaving.value = true;
    try {
      const tzOffset = Number(timezoneOffset.value);
      const result = await withErrorToast(
        updateConfig({
          timezoneOffset: tzOffset,
          backupGitRemoteUrl: backupPayload.backupGitRemoteUrl,
          backupTime: backupPayload.backupTime,
          backupEnabled: backupPayload.backupEnabled,
        }),
        "Config",
        t("settings.saveFailed"),
        { swallow: true },
      );
      if (result) {
        configStore.setTimezoneOffset(tzOffset);
        onBackupSaved?.(backupPayload);
        lastSavedSnapshot.value = createSnapshot(
          timezoneOffset.value,
          currentLocale.value,
        );
        showSuccessToast("Config", t("settings.saveSuccess"));
        onSaved?.();
      }
    } finally {
      isSaving.value = false;
    }
  };

  watch(currentLocale, (next) => setLocale(next));

  return {
    timezoneOffset,
    currentLocale,
    isLoading,
    isSaving,
    loadFailed,
    isDirty,
    loadConfig,
    handleSave,
  };
}
