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

interface OptionalModelSettingsValue {
  provider: PodProvider | undefined;
  model: string | undefined;
  thinkingLevel: string | null | undefined;
}

interface GlobalConfigStoreLike {
  setTimezoneOffset(offset: number): void;
  setMemoryConfig(config: ModelSettingsValue): void;
  setConnectionLineConfig(config: ModelSettingsValue): void;
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

function shouldSaveModelSettings(
  hasLoaded: boolean,
  settings: ModelSettingsValue,
): boolean {
  return (
    hasLoaded ||
    settings.provider !== null ||
    settings.model !== "" ||
    settings.thinkingLevel !== null
  );
}

function hasAnyConfigField(
  config: ConfigGetResultPayload,
  fields: readonly (keyof ConfigGetResultPayload)[],
): boolean {
  return fields.some((field) => field in config);
}

function createModelSettings(
  provider: PodProvider | null | undefined,
  model: string | undefined,
  thinkingLevel: string | null | undefined,
): ModelSettingsValue {
  return {
    provider: provider ?? null,
    model: model ?? "",
    thinkingLevel: thinkingLevel ?? null,
  };
}

function createOptionalModelSettings(
  settings: ModelSettingsValue,
  shouldSave: boolean,
): OptionalModelSettingsValue {
  if (!shouldSave) {
    return {
      provider: undefined,
      model: undefined,
      thinkingLevel: undefined,
    };
  }

  return {
    provider: settings.provider ?? undefined,
    model: settings.model,
    thinkingLevel: settings.thinkingLevel,
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

  const getMemorySettings = (): ModelSettingsValue => ({
    provider: memoryProvider.value,
    model: memoryModel.value,
    thinkingLevel: memoryThinkingLevel.value,
  });
  const getConnectionLineSettings = (): ModelSettingsValue => ({
    provider: connectionLineProvider.value,
    model: connectionLineModel.value,
    thinkingLevel: connectionLineThinkingLevel.value,
  });
  const getCurrentSnapshot = (): SettingsSnapshot =>
    createSnapshot(
      timezoneOffset.value,
      currentLocale.value,
      getMemorySettings(),
      getConnectionLineSettings(),
    );
  const lastSavedSnapshot = ref<SettingsSnapshot>(getCurrentSnapshot());

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
      hasLoadedMemorySettings.value = hasAnyConfigField(result, [
        "memoryProvider",
        "memoryModel",
        "memoryThinkingLevel",
      ]);
      hasLoadedConnectionLineSettings.value = hasAnyConfigField(result, [
        "connectionLineProvider",
        "connectionLineModel",
        "connectionLineThinkingLevel",
      ]);
      const memorySettings = createModelSettings(
        result.memoryProvider,
        result.memoryModel,
        result.memoryThinkingLevel,
      );
      const connectionLineSettings = createModelSettings(
        result.connectionLineProvider,
        result.connectionLineModel,
        result.connectionLineThinkingLevel,
      );
      memoryProvider.value = memorySettings.provider;
      memoryModel.value = memorySettings.model;
      memoryThinkingLevel.value = memorySettings.thinkingLevel;
      connectionLineProvider.value = connectionLineSettings.provider;
      connectionLineModel.value = connectionLineSettings.model;
      connectionLineThinkingLevel.value = connectionLineSettings.thinkingLevel;

      if (hasLoadedMemorySettings.value) {
        configStore.setMemoryConfig(getMemorySettings());
      }
      if (hasLoadedConnectionLineSettings.value) {
        configStore.setConnectionLineConfig(getConnectionLineSettings());
      }
      options.onLoaded?.(result);
      lastSavedSnapshot.value = getCurrentSnapshot();
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
      const memorySettings = getMemorySettings();
      const connectionLineSettings = getConnectionLineSettings();
      const shouldSaveMemorySettings = shouldSaveModelSettings(
        hasLoadedMemorySettings.value,
        memorySettings,
      );
      const shouldSaveConnectionLineSettings = shouldSaveModelSettings(
        hasLoadedConnectionLineSettings.value,
        connectionLineSettings,
      );
      const memoryPayload = createOptionalModelSettings(
        memorySettings,
        shouldSaveMemorySettings,
      );
      const connectionLinePayload = createOptionalModelSettings(
        connectionLineSettings,
        shouldSaveConnectionLineSettings,
      );
      const result = await withErrorToast(
        updateConfig({
          timezoneOffset: tzOffset,
          backupGitRemoteUrl: backupPayload.backupGitRemoteUrl,
          backupTime: backupPayload.backupTime,
          backupEnabled: backupPayload.backupEnabled,
          memoryProvider: memoryPayload.provider,
          memoryModel: memoryPayload.model,
          memoryThinkingLevel: memoryPayload.thinkingLevel,
          connectionLineProvider: connectionLinePayload.provider,
          connectionLineModel: connectionLinePayload.model,
          connectionLineThinkingLevel: connectionLinePayload.thinkingLevel,
        }),
        "Config",
        t("settings.saveFailed"),
        { swallow: true },
      );
      if (!result) return;

      configStore.setTimezoneOffset(tzOffset);
      if (shouldSaveMemorySettings) {
        hasLoadedMemorySettings.value = true;
        configStore.setMemoryConfig(memorySettings);
      }
      if (shouldSaveConnectionLineSettings) {
        hasLoadedConnectionLineSettings.value = true;
        configStore.setConnectionLineConfig(connectionLineSettings);
      }
      onBackupSaved?.(backupPayload);
      lastSavedSnapshot.value = getCurrentSnapshot();
      showSuccessToast("Config", t("settings.saveSuccess"));
      onSaved?.();
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
