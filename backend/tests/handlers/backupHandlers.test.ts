import { vi, describe, it, expect, beforeEach } from "vitest";

// mock configStore
const mockGetBackupConfig = vi.fn();

vi.mock("../../src/services/configStore.js", () => ({
  configStore: {
    getBackupConfig: mockGetBackupConfig,
  },
}));

// mock backupService
const mockExecuteBackup = vi.fn();
const mockTestConnection = vi.fn();

vi.mock("../../src/services/backupService.js", () => ({
  backupService: {
    executeBackup: mockExecuteBackup,
    testConnection: mockTestConnection,
  },
}));

// mock socketService
const mockEmitToConnection = vi.fn();
const mockEmitToAll = vi.fn();

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
    emitToAll: mockEmitToAll,
  },
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    BACKUP_TRIGGER_RESULT: "backup:triggerResult",
    BACKUP_STARTED: "backup:started",
    BACKUP_COMPLETED: "backup:completed",
    BACKUP_FAILED: "backup:failed",
    BACKUP_TEST_CONNECTION_RESULT: "backup:testConnectionResult",
  },
}));

const { handleBackupTrigger, handleBackupTestConnection } =
  await import("../../src/handlers/backupHandlers.js");

const CONNECTION_ID = "conn-1";
const REQUEST_ID = "req-1";
const REMOTE_URL = "https://github.com/user/backup.git";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleBackupTrigger", () => {
  describe("URL 為空時", () => {
    it("payload 和 config 都沒有 URL 時回傳錯誤", async () => {
      mockGetBackupConfig.mockReturnValue({
        backupGitRemoteUrl: "",
        backupEnabled: true,
        backupTime: "03:00",
      });

      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:triggerResult",
        expect.objectContaining({ success: false, error: expect.any(String) }),
      );
      expect(mockExecuteBackup).not.toHaveBeenCalled();
    });
  });

  describe("正常流程", () => {
    beforeEach(() => {
      mockGetBackupConfig.mockReturnValue({
        backupGitRemoteUrl: REMOTE_URL,
        backupEnabled: true,
        backupTime: "03:00",
      });
    });

    it("備份成功時 ack 後 emit BACKUP_STARTED 和 BACKUP_COMPLETED", async () => {
      mockExecuteBackup.mockResolvedValue({ success: true });

      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:triggerResult",
        expect.objectContaining({ success: true }),
      );
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:started",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:completed",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it("備份失敗時 ack 後 emit BACKUP_STARTED 和 BACKUP_FAILED", async () => {
      mockExecuteBackup.mockResolvedValue({
        success: false,
        error: "認證失敗",
      });

      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:triggerResult",
        expect.objectContaining({ success: true }),
      );
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:started",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:failed",
        expect.objectContaining({
          error: "認證失敗",
          timestamp: expect.any(String),
        }),
      );
    });

    it("備份正在執行中（lock）時回傳錯誤", async () => {
      mockExecuteBackup.mockResolvedValue({
        success: false,
        error: "備份正在執行中",
      });

      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:failed",
        expect.objectContaining({ error: "備份正在執行中" }),
      );
    });

    it("payload 帶 URL 時優先使用 payload URL 而非 config URL", async () => {
      mockGetBackupConfig.mockReturnValue({
        backupGitRemoteUrl: "https://github.com/user/old.git",
        backupEnabled: true,
        backupTime: "03:00",
      });
      mockExecuteBackup.mockResolvedValue({ success: true });

      const payloadUrl = "https://github.com/user/new.git";
      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID, gitRemoteUrl: payloadUrl },
        REQUEST_ID,
      );

      expect(mockExecuteBackup).toHaveBeenCalledWith(payloadUrl);
    });
  });
});

describe("handleBackupTestConnection", () => {
  describe("URL 為空時", () => {
    it("gitRemoteUrl 為空字串時回傳錯誤", async () => {
      await handleBackupTestConnection(
        CONNECTION_ID,
        { requestId: REQUEST_ID, gitRemoteUrl: "" },
        REQUEST_ID,
      );

      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:testConnectionResult",
        expect.objectContaining({ success: false, error: expect.any(String) }),
      );
      expect(mockTestConnection).not.toHaveBeenCalled();
    });
  });

  describe("正常流程", () => {
    it("連線成功時回傳 success: true", async () => {
      mockTestConnection.mockResolvedValue({ success: true });

      await handleBackupTestConnection(
        CONNECTION_ID,
        { requestId: REQUEST_ID, gitRemoteUrl: REMOTE_URL },
        REQUEST_ID,
      );

      expect(mockTestConnection).toHaveBeenCalledWith(REMOTE_URL);
      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:testConnectionResult",
        expect.objectContaining({ requestId: REQUEST_ID, success: true }),
      );
    });

    it("連線失敗時回傳 success: false 和錯誤訊息", async () => {
      mockTestConnection.mockResolvedValue({
        success: false,
        error: "無法連線至遠端伺服器",
      });

      await handleBackupTestConnection(
        CONNECTION_ID,
        { requestId: REQUEST_ID, gitRemoteUrl: REMOTE_URL },
        REQUEST_ID,
      );

      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:testConnectionResult",
        expect.objectContaining({
          success: false,
          error: "無法連線至遠端伺服器",
        }),
      );
    });
  });
});
