import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// 使用 vi.hoisted 確保 mock 在 vi.mock 中可用
const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}));

vi.mock("@/services/configApi", () => ({
  getConfig: mockGetConfig,
}));

describe("configStore", () => {
  let useConfigStore: typeof import("@/stores/configStore").useConfigStore;

  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    const module = await import("@/stores/configStore");
    useConfigStore = module.useConfigStore;
  });

  it("fetchConfig 應從 API 載入 timezoneOffset 並更新 state", async () => {
    mockGetConfig.mockResolvedValueOnce({
      success: true,
      timezoneOffset: -3,
    });

    const store = useConfigStore();
    await store.fetchConfig();

    expect(store.timezoneOffset).toBe(-3);
  });

  it("setTimezoneOffset 應更新 state", () => {
    const store = useConfigStore();
    store.setTimezoneOffset(5);
    expect(store.timezoneOffset).toBe(5);
  });

  it("fetchConfig 回傳 undefined timezoneOffset 時應保持預設值 8", async () => {
    mockGetConfig.mockResolvedValueOnce({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });

    const store = useConfigStore();
    await store.fetchConfig();

    expect(store.timezoneOffset).toBe(8);
  });

  it("初始備份相關狀態應為預設值", () => {
    const store = useConfigStore();
    expect(store.backupGitRemoteUrl).toBe("");
    expect(store.backupTime).toBe("03:00");
    expect(store.backupEnabled).toBe(false);
    expect(store.backupStatus).toBe("idle");
    expect(store.lastBackupError).toBeNull();
    expect(store.lastBackupTime).toBeNull();
  });

  it("fetchConfig 應從 API 載入備份設定並更新 state", async () => {
    mockGetConfig.mockResolvedValueOnce({
      success: true,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
      backupTime: "04:30",
      backupEnabled: true,
    });

    const store = useConfigStore();
    await store.fetchConfig();

    expect(store.backupGitRemoteUrl).toBe("git@github.com:test/backup.git");
    expect(store.backupTime).toBe("04:30");
    expect(store.backupEnabled).toBe(true);
  });

  it("fetchConfig 回傳無備份欄位時應保持預設值", async () => {
    mockGetConfig.mockResolvedValueOnce({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });

    const store = useConfigStore();
    await store.fetchConfig();

    expect(store.backupGitRemoteUrl).toBe("");
    expect(store.backupTime).toBe("03:00");
    expect(store.backupEnabled).toBe(false);
  });

  it("setBackupConfig 應更新備份相關 state", () => {
    const store = useConfigStore();
    store.setBackupConfig({
      gitRemoteUrl: "git@test.git",
      time: "05:00",
      enabled: true,
    });

    expect(store.backupGitRemoteUrl).toBe("git@test.git");
    expect(store.backupTime).toBe("05:00");
    expect(store.backupEnabled).toBe(true);
  });

  it("setBackupStatus 應更新 backupStatus 與 lastBackupError", () => {
    const store = useConfigStore();
    store.setBackupStatus("failed", "連線逾時");
    expect(store.backupStatus).toBe("failed");
    expect(store.lastBackupError).toBe("連線逾時");

    store.setBackupStatus("idle");
    expect(store.backupStatus).toBe("idle");
    expect(store.lastBackupError).toBeNull();
  });

  it("setLastBackupTime 應更新 lastBackupTime", () => {
    const store = useConfigStore();
    store.setLastBackupTime("2026-03-26T03:00:00Z");
    expect(store.lastBackupTime).toBe("2026-03-26T03:00:00Z");
  });
});
