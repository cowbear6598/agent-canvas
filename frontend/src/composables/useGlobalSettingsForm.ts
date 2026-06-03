import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import {
  getConfig as getConfigApi,
  updateConfig as updateConfigApi,
} from "@/services/configApi";
import { i18n, setLocale as setLocaleApi } from "@/i18n";
import type { ToastCategory } from "@/composables/useToast";
import type { ConfigGetResultPayload } from "@/types/websocket/responses";
import type { BackupSettingsPayload } from "@/composables/useBackupSettingsForm";
import type { PodProvider } from "@/types/pod";

interface ModelSettingsValue {
  provider: PodProvider | null;
  model: string;
  thinkingLevel: string | null;
}

interface GlobalConfigStoreLike {
  setTimezoneOffset(offset: number): void;
  setMemoryConfig?(config: ModelSettingsValue): void;
  setConnectionLineConfig?(config: ModelSettingsValue): void;
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
  memoryProvider: PodProvider | null;
  memoryModel: string;
  memoryThinkingLevel: string | null;
  connectionLineProvider: PodProvider | null;
  connectionLineModel: string;
  connectionLineThinkingLevel: string | null;
}

interface GlobalSettingsForm {
  timezoneOffset: Ref<string>;
  currentLocale: Ref<string>;
  memoryProvider: Ref<PodProvider | null>;
  memoryModel: Ref<string>;
  memoryThinkingLevel: Ref<string | null>;
  connectionLineProvider: Ref<PodProvider | null>;
  connectionLineModel: Ref<string>;
  connectionLineThinkingLevel: Ref<string | null>;
  isLoading: Ref<boolean>;
  isSaving: Ref<boolean>;
  loadFailed: Ref<boolean>;
  isDirty: ComputedRef<boolean>;
  loadConfig: (options?: LoadGlobalSettingsOptions) => Promise<void>;
  handleSave: (options: SaveGlobalSettingsOptions) => Promise<void>;
}

function createSnapshot(
  timezoneOffset: string,
  locale: string,
  memorySettings: ModelSettingsValue,
  connectionLineSettings: ModelSettingsValue,
): SettingsSnapshot {
  return {
    timezoneOffset,
    locale,
    memoryProvider: memorySettings.provider,
    memoryModel: memorySettings.model,
    memoryThinkingLevel: memorySettings.thinkingLevel,
    connectionLineProvider: connectionLineSettings.provider,
    connectionLineModel: connectionLineSettings.model,
    connectionLineThinkingLevel: connectionLineSettings.thinkingLevel,
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
  const memoryProvider = ref<PodProvider | null>(null);
  const memoryModel = ref<string>("");
  const memoryThinkingLevel = ref<string | null>(null);
  const connectionLineProvider = ref<PodProvider | null>(null);
  const connectionLineModel = ref<string>("");
  const connectionLineThinkingLevel = ref<string | null>(null);
  const isLoading = ref<boolean>(false);
  const isSaving = ref<boolean>(false);
  const loadFailed = ref<boolean>(false);
  const hasLoadedMemorySettings = ref<boolean>(false);
  const hasLoadedConnectionLineSettings = ref<boolean>(false);
  const lastSavedSnapshot = ref<SettingsSnapshot>(
    createSnapshot(
      timezoneOffset.value,
      currentLocale.value,
      {
        provider: memoryProvider.value,
        model: memoryModel.value,
        thinkingLevel: memoryThinkingLevel.value,
      },
      {
        provider: connectionLineProvider.value,
        model: connectionLineModel.value,
        thinkingLevel: connectionLineThinkingLevel.value,
      },
    ),
  );

  const isDirty = computed<boolean>(
    () =>
      timezoneOffset.value !== lastSavedSnapshot.value.timezoneOffset ||
      currentLocale.value !== lastSavedSnapshot.value.locale ||
      memoryProvider.value !== lastSavedSnapshot.value.memoryProvider ||
      memoryModel.value !== lastSavedSnapshot.value.memoryModel ||
      memoryThinkingLevel.value !==
        lastSavedSnapshot.value.memoryThinkingLevel ||
      connectionLineProvider.value !==
        lastSavedSnapshot.value.connectionLineProvider ||
      connectionLineModel.value !==
        lastSavedSnapshot.value.connectionLineModel ||
      connectionLineThinkingLevel.value !==
        lastSavedSnapshot.value.connectionLineThinkingLevel,
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
      hasLoadedMemorySettings.value =
        "memoryProvider" in result ||
        "memoryModel" in result ||
        "memoryThinkingLevel" in result;
      hasLoadedConnectionLineSettings.value =
        "connectionLineProvider" in result ||
        "connectionLineModel" in result ||
        "connectionLineThinkingLevel" in result;
      if (hasLoadedMemorySettings.value) {
        memoryProvider.value = result.memoryProvider ?? null;
        memoryModel.value = result.memoryModel ?? "";
        memoryThinkingLevel.value = result.memoryThinkingLevel ?? null;
      } else {
        memoryProvider.value = null;
        memoryModel.value = "";
        memoryThinkingLevel.value = null;
      }
      if (hasLoadedConnectionLineSettings.value) {
        connectionLineProvider.value = result.connectionLineProvider ?? null;
        connectionLineModel.value = result.connectionLineModel ?? "";
        connectionLineThinkingLevel.value =
          result.connectionLineThinkingLevel ?? null;
      } else {
        connectionLineProvider.value = null;
        connectionLineModel.value = "";
        connectionLineThinkingLevel.value = null;
      }
      if (hasLoadedMemorySettings.value) {
        configStore.setMemoryConfig?.({
          provider: memoryProvider.value,
          model: memoryModel.value,
          thinkingLevel: memoryThinkingLevel.value,
        });
      }
      if (hasLoadedConnectionLineSettings.value) {
        configStore.setConnectionLineConfig?.({
          provider: connectionLineProvider.value,
          model: connectionLineModel.value,
          thinkingLevel: connectionLineThinkingLevel.value,
        });
      }
      options.onLoaded?.(result);
      lastSavedSnapshot.value = createSnapshot(
        timezoneOffset.value,
        currentLocale.value,
        {
          provider: memoryProvider.value,
          model: memoryModel.value,
          thinkingLevel: memoryThinkingLevel.value,
        },
        {
          provider: connectionLineProvider.value,
          model: connectionLineModel.value,
          thinkingLevel: connectionLineThinkingLevel.value,
        },
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
      const shouldSaveMemorySettings =
        hasLoadedMemorySettings.value ||
        memoryProvider.value !== null ||
        memoryModel.value !== "" ||
        memoryThinkingLevel.value !== null;
      const shouldSaveConnectionLineSettings =
        hasLoadedConnectionLineSettings.value ||
        connectionLineProvider.value !== null ||
        connectionLineModel.value !== "" ||
        connectionLineThinkingLevel.value !== null;
      const result = await withErrorToast(
        updateConfig({
          timezoneOffset: tzOffset,
          backupGitRemoteUrl: backupPayload.backupGitRemoteUrl,
          backupTime: backupPayload.backupTime,
          backupEnabled: backupPayload.backupEnabled,
          memoryProvider: shouldSaveMemorySettings
            ? (memoryProvider.value ?? undefined)
            : undefined,
          memoryModel: shouldSaveMemorySettings ? memoryModel.value : undefined,
          memoryThinkingLevel: shouldSaveMemorySettings
            ? memoryThinkingLevel.value
            : undefined,
          connectionLineProvider: shouldSaveConnectionLineSettings
            ? (connectionLineProvider.value ?? undefined)
            : undefined,
          connectionLineModel: shouldSaveConnectionLineSettings
            ? connectionLineModel.value
            : undefined,
          connectionLineThinkingLevel: shouldSaveConnectionLineSettings
            ? connectionLineThinkingLevel.value
            : undefined,
        }),
        "Config",
        t("settings.saveFailed"),
        { swallow: true },
      );
      if (result) {
        configStore.setTimezoneOffset(tzOffset);
        if (shouldSaveMemorySettings) {
          hasLoadedMemorySettings.value = true;
          configStore.setMemoryConfig?.({
            provider: memoryProvider.value,
            model: memoryModel.value,
            thinkingLevel: memoryThinkingLevel.value,
          });
        }
        if (shouldSaveConnectionLineSettings) {
          hasLoadedConnectionLineSettings.value = true;
          configStore.setConnectionLineConfig?.({
            provider: connectionLineProvider.value,
            model: connectionLineModel.value,
            thinkingLevel: connectionLineThinkingLevel.value,
          });
        }
        onBackupSaved?.(backupPayload);
        lastSavedSnapshot.value = createSnapshot(
          timezoneOffset.value,
          currentLocale.value,
          {
            provider: memoryProvider.value,
            model: memoryModel.value,
            thinkingLevel: memoryThinkingLevel.value,
          },
          {
            provider: connectionLineProvider.value,
            model: connectionLineModel.value,
            thinkingLevel: connectionLineThinkingLevel.value,
          },
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
    memoryProvider,
    memoryModel,
    memoryThinkingLevel,
    connectionLineProvider,
    connectionLineModel,
    connectionLineThinkingLevel,
    isLoading,
    isSaving,
    loadFailed,
    isDirty,
    loadConfig,
    handleSave,
  };
}
