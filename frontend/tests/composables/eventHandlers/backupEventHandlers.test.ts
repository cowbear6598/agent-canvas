import { describe, it, expect, vi } from "vitest";
import { setActivePinia } from "pinia";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { useConfigStore } from "@/stores/configStore";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  tryResolvePendingRequest: vi.fn().mockReturnValue(false),
  createWebSocketRequest: vi.fn(),
}));

const { mockShowSuccessToast, mockShowErrorToast } = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

// mock configApi（configStore 依賴）
vi.mock("@/services/configApi", () => ({
  getConfig: vi.fn().mockResolvedValue({ success: true }),
}));

describe("backupEventHandlers", () => {
  setupStoreTest();

  describe("handleBackupStarted", () => {
    it("收到 BACKUP_STARTED 應更新 configStore.backupStatus 為 running", async () => {
      const { handleBackupStarted } =
        await import("@/composables/eventHandlers/backupEventHandlers");
      const configStore = useConfigStore();

      handleBackupStarted({ timestamp: "2026-03-26T03:00:00Z" });

      expect(configStore.backupStatus).toBe("running");
    });
  });

  describe("handleBackupCompleted", () => {
    it("收到 BACKUP_COMPLETED 應更新 configStore.backupStatus 為 success 並更新 lastBackupTime", async () => {
      const { handleBackupCompleted } =
        await import("@/composables/eventHandlers/backupEventHandlers");
      const configStore = useConfigStore();

      handleBackupCompleted({ timestamp: "2026-03-26T03:00:00Z" });

      expect(configStore.backupStatus).toBe("success");
      expect(configStore.lastBackupTime).toBe("2026-03-26T03:00:00Z");
    });

    it("收到 BACKUP_COMPLETED 應顯示成功 toast", async () => {
      const { handleBackupCompleted } =
        await import("@/composables/eventHandlers/backupEventHandlers");

      handleBackupCompleted({ timestamp: "2026-03-26T03:00:00Z" });

      expect(mockShowSuccessToast).toHaveBeenCalledWith("Config", "備份完成");
    });
  });

  describe("handleBackupFailed", () => {
    it("收到 BACKUP_FAILED 應更新 configStore.backupStatus 為 failed 並記錄 lastBackupError", async () => {
      const { handleBackupFailed } =
        await import("@/composables/eventHandlers/backupEventHandlers");
      const configStore = useConfigStore();

      handleBackupFailed({
        error: "remote 無法連線",
        timestamp: "2026-03-26T03:00:00Z",
      });

      expect(configStore.backupStatus).toBe("failed");
      expect(configStore.lastBackupError).toBe("remote 無法連線");
    });

    it("收到 BACKUP_FAILED 不應顯示錯誤 toast（改用 inline 錯誤訊息顯示）", async () => {
      const { handleBackupFailed } =
        await import("@/composables/eventHandlers/backupEventHandlers");

      handleBackupFailed({
        error: "remote 無法連線",
        timestamp: "2026-03-26T03:00:00Z",
      });

      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });
  });
});
