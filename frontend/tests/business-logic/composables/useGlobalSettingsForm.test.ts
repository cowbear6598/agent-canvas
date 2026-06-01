import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { useGlobalSettingsForm } from "@/composables/useGlobalSettingsForm";
import type {
  ConfigGetResultPayload,
  ConfigUpdatedPayload,
} from "@/types/websocket/responses";
import type { ToastCategory } from "@/composables/useToast";

function createResult(
  payload: Partial<ConfigGetResultPayload> = {},
): ConfigGetResultPayload {
  return {
    requestId: "request-1",
    success: true,
    ...payload,
  };
}

function createUpdatedResult(
  payload: Partial<ConfigUpdatedPayload> = {},
): ConfigUpdatedPayload {
  return {
    requestId: "request-2",
    success: true,
    ...payload,
  };
}

function createOptions() {
  const configStore = reactive<{
    timezoneOffset: number;
    memoryProvider: "claude" | "codex" | "opencode" | null;
    memoryModel: string;
    memoryThinkingLevel: string | null;
    setTimezoneOffset: (offset: number) => void;
    setMemoryConfig: (config: {
      provider: "claude" | "codex" | "opencode" | null;
      model: string;
      thinkingLevel: string | null;
    }) => void;
  }>({
    timezoneOffset: 8,
    memoryProvider: null,
    memoryModel: "",
    memoryThinkingLevel: null,
    setTimezoneOffset: vi.fn((offset: number) => {
      configStore.timezoneOffset = offset;
    }),
    setMemoryConfig: vi.fn(
      (config: {
        provider: "claude" | "codex" | "opencode" | null;
        model: string;
        thinkingLevel: string | null;
      }) => {
        configStore.memoryProvider = config.provider;
        configStore.memoryModel = config.model;
        configStore.memoryThinkingLevel = config.thinkingLevel;
      },
    ),
  });
  const getConfig = vi.fn(async () =>
    createResult({
      timezoneOffset: 9,
      backupGitRemoteUrl: "git@example.com:repo/backup.git",
      backupTime: "04:30",
      backupEnabled: true,
      memoryProvider: "claude",
      memoryModel: "sonnet",
      memoryThinkingLevel: "high",
    }),
  );
  const updateConfig = vi.fn(async () => createUpdatedResult());
  const setLocale = vi.fn();
  const showSuccessToast = vi.fn();
  let shouldSwallowNextError = false;
  const withErrorToast = <T>(
    promise: Promise<T>,
    _category: ToastCategory,
    _action: string,
    _options?: { swallow?: boolean },
  ): Promise<T | null> => {
    if (shouldSwallowNextError) {
      shouldSwallowNextError = false;
      return Promise.resolve(null);
    }

    return promise.then((result) => result);
  };

  return {
    configStore,
    getConfig,
    updateConfig,
    setLocale,
    showSuccessToast,
    withErrorToast,
    swallowNextError: () => {
      shouldSwallowNextError = true;
    },
    t: (key: string) => key,
  };
}

describe("useGlobalSettingsForm", () => {
  it("loadConfig 應載入 timezone、更新 store 並交出備份設定給呼叫端", async () => {
    const options = createOptions();
    const onLoaded = vi.fn();
    const form = useGlobalSettingsForm({
      ...options,
      initialLocale: "zh-TW",
    });

    await form.loadConfig({ onLoaded });

    expect(form.timezoneOffset.value).toBe("9");
    expect(options.configStore.setTimezoneOffset).toHaveBeenCalledWith(9);
    expect(options.configStore.setMemoryConfig).toHaveBeenCalledWith({
      provider: "claude",
      model: "sonnet",
      thinkingLevel: null,
    });
    expect(onLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        backupGitRemoteUrl: "git@example.com:repo/backup.git",
        backupTime: "04:30",
        backupEnabled: true,
      }),
    );
    expect(form.isDirty.value).toBe(false);
  });

  it("currentLocale 改變時應立即委派 setLocale，且 dirty 狀態會反映表單變更", async () => {
    const options = createOptions();
    const form = useGlobalSettingsForm({
      ...options,
      initialLocale: "zh-TW",
    });

    form.currentLocale.value = "en";
    await nextTick();

    expect(options.setLocale).toHaveBeenCalledWith("en");
    expect(form.isDirty.value).toBe(true);
  });

  it("handleSave 應送出 timezone 與備份 payload，成功後更新 store、toast 並關閉", async () => {
    const options = createOptions();
    const onBackupSaved = vi.fn();
    const onSaved = vi.fn();
    const form = useGlobalSettingsForm({
      ...options,
      initialLocale: "zh-TW",
    });
    form.timezoneOffset.value = "7";
    form.memoryProvider.value = "codex";
    form.memoryModel.value = "gpt-5.4";
    await form.handleSave({
      backupPayload: {
        backupGitRemoteUrl: "",
        backupTime: "03:45",
        backupEnabled: false,
      },
      onBackupSaved,
      onSaved,
    });

    expect(options.updateConfig).toHaveBeenCalledWith({
      timezoneOffset: 7,
      backupGitRemoteUrl: "",
      backupTime: "03:45",
      backupEnabled: false,
      memoryProvider: "codex",
      memoryModel: "gpt-5.4",
      memoryThinkingLevel: null,
    });
    expect(options.configStore.setTimezoneOffset).toHaveBeenCalledWith(7);
    expect(options.configStore.setMemoryConfig).toHaveBeenCalledWith({
      provider: "codex",
      model: "gpt-5.4",
      thinkingLevel: null,
    });
    expect(onBackupSaved).toHaveBeenCalledWith({
      backupGitRemoteUrl: "",
      backupTime: "03:45",
      backupEnabled: false,
    });
    expect(options.showSuccessToast).toHaveBeenCalledWith(
      "Config",
      "settings.saveSuccess",
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(form.isSaving.value).toBe(false);
  });

  it("loadConfig 被 withErrorToast 吞掉錯誤時應標記 loadFailed", async () => {
    const options = createOptions();
    options.swallowNextError();
    const form = useGlobalSettingsForm({
      ...options,
      initialLocale: "zh-TW",
    });

    await form.loadConfig();

    expect(form.loadFailed.value).toBe(true);
    expect(form.isLoading.value).toBe(false);
  });
});
