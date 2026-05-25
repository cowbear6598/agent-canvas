import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { useBackupSettingsForm } from "@/composables/useBackupSettingsForm";
import type { ConfigGetResultPayload } from "@/types/websocket/responses";

function createConfig(
  payload: Partial<ConfigGetResultPayload>,
): ConfigGetResultPayload {
  return {
    requestId: "request-1",
    success: true,
    ...payload,
  };
}

function createStore() {
  return reactive({
    backupStatus: "idle" as "idle" | "running" | "success" | "failed",
    lastBackupError: null as string | null,
    setBackupConfig: vi.fn(),
  });
}

describe("useBackupSettingsForm", () => {
  it("applyLoadedConfig 應同步備份欄位與 config store", () => {
    const store = createStore();
    const form = useBackupSettingsForm({
      configStore: store,
      t: (key) => key,
    });

    form.applyLoadedConfig(
      createConfig({
        backupGitRemoteUrl: "git@example.com:repo/backup.git",
        backupTime: "05:15",
        backupEnabled: true,
      }),
    );

    expect(form.backupGitRemoteUrl.value).toBe(
      "git@example.com:repo/backup.git",
    );
    expect(form.backupHour.value).toBe("05");
    expect(form.backupMinute.value).toBe("15");
    expect(form.backupEnabled.value).toBe(true);
    expect(store.setBackupConfig).toHaveBeenCalledWith({
      gitRemoteUrl: "git@example.com:repo/backup.git",
      time: "05:15",
      enabled: true,
    });
  });

  it("validateBeforeSave 應阻擋啟用備份但 Remote URL 空白的儲存", () => {
    const form = useBackupSettingsForm({
      configStore: createStore(),
      t: (key) => key,
    });
    form.backupEnabled.value = true;
    form.backupGitRemoteUrl.value = "   ";

    expect(form.validateBeforeSave()).toBe(false);
    expect(form.backupUrlError.value).toBe(true);
  });

  it("buildSavePayload 關閉備份時應送出空 Remote URL 但不提前清掉 UI", () => {
    const form = useBackupSettingsForm({
      configStore: createStore(),
      t: (key) => key,
    });
    form.backupEnabled.value = false;
    form.backupGitRemoteUrl.value = "git@example.com:repo/backup.git";
    form.backupHour.value = "06";
    form.backupMinute.value = "45";

    expect(form.buildSavePayload()).toEqual({
      backupGitRemoteUrl: "",
      backupTime: "06:45",
      backupEnabled: false,
    });
    expect(form.backupGitRemoteUrl.value).toBe(
      "git@example.com:repo/backup.git",
    );
  });

  it("handleTriggerBackup 應呼叫備份 API，失敗時保存 inline 錯誤", async () => {
    const triggerBackup = vi.fn(async () => {
      throw new Error("remote rejected");
    });
    const form = useBackupSettingsForm({
      configStore: createStore(),
      t: (key) => key,
      triggerBackup,
    });
    form.backupGitRemoteUrl.value = "git@example.com:repo/backup.git";

    await form.handleTriggerBackup();

    expect(triggerBackup).toHaveBeenCalledWith(
      "git@example.com:repo/backup.git",
    );
    expect(form.backupError.value).toBe("remote rejected");
  });

  it("排程備份狀態失敗時應同步 inline 錯誤，running 時清除錯誤", async () => {
    const store = createStore();
    const form = useBackupSettingsForm({
      configStore: store,
      t: (key) => key,
    });

    store.backupStatus = "failed";
    store.lastBackupError = "schedule failed";
    await nextTick();

    expect(form.backupError.value).toBe("schedule failed");

    store.backupStatus = "running";
    await nextTick();

    expect(form.backupError.value).toBeNull();
  });
});
