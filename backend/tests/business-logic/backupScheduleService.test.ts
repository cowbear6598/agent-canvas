import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// mock configStore
const mockGetBackupConfig = vi.fn();
const mockGetTimezoneOffset = vi.fn();

vi.mock("../../src/services/configStore.js", () => ({
  configStore: {
    getBackupConfig: mockGetBackupConfig,
    getTimezoneOffset: mockGetTimezoneOffset,
  },
}));

// mock backupService
const mockExecuteBackup = vi.fn();

vi.mock("../../src/services/backupService.js", () => ({
  backupService: {
    executeBackup: mockExecuteBackup,
  },
}));

// mock socketService
const mockEmitToAll = vi.fn();

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToAll: mockEmitToAll,
  },
}));

// mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

const { backupScheduleService } =
  await import("../../src/services/backupScheduleService.js");

describe("BackupScheduleService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 每次測試前重置觸發狀態，避免跨測試互相影響
    backupScheduleService.reset();
    // 預設 offset 為 8（台灣時間）
    mockGetTimezoneOffset.mockReturnValue(8);
  });

  afterEach(() => {
    backupScheduleService.stop();
    vi.useRealTimers();
  });

  describe("start", () => {
    it("backupEnabled 為 true 時啟動 tick", () => {
      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });

      backupScheduleService.start();

      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it("backupEnabled 為 false 時不啟動 tick", () => {
      mockGetBackupConfig.mockReturnValue({
        backupEnabled: false,
        backupTime: "03:00",
        backupGitRemoteUrl: "",
      });

      backupScheduleService.start();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("stop", () => {
    it("停止 tick interval", () => {
      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });

      backupScheduleService.start();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      backupScheduleService.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("tick 判斷", () => {
    it("到達指定時間且今日未備份時觸發 executeBackup", async () => {
      // 設定假時間為 UTC 18:59:59Z，advance 1 秒後變 19:00:00Z = 台灣 03:00:00
      const fakeTime = new Date("2026-03-26T18:59:59Z");
      vi.setSystemTime(fakeTime);

      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });
      mockExecuteBackup.mockResolvedValue({ success: true });

      backupScheduleService.start();

      // advance 1 秒讓 tick 執行，再等待 async fireBackup 完成
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockExecuteBackup).toHaveBeenCalledWith(
        "https://github.com/user/backup.git",
      );

      // 驗證 socket emit 順序：BACKUP_STARTED → BACKUP_COMPLETED
      expect(mockEmitToAll).toHaveBeenCalledTimes(2);
      expect(mockEmitToAll).toHaveBeenNthCalledWith(
        1,
        "backup:started",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
      expect(mockEmitToAll).toHaveBeenNthCalledWith(
        2,
        "backup:completed",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it("未到達指定時間時不觸發", async () => {
      // 設定假時間為 UTC 18:59:00 = offset+8 = 02:59:00（台灣時間）
      const fakeTime = new Date("2026-03-26T18:59:00Z");
      vi.setSystemTime(fakeTime);

      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });

      backupScheduleService.start();

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();

      expect(mockExecuteBackup).not.toHaveBeenCalled();
    });

    it("今日已觸發過時不重複觸發", async () => {
      // 設定假時間為 UTC 18:59:59Z，advance 1 秒後變 19:00:00Z = 台灣 03:00:00
      const fakeTime = new Date("2026-03-26T18:59:59Z");
      vi.setSystemTime(fakeTime);

      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });
      mockExecuteBackup.mockResolvedValue({ success: true });

      backupScheduleService.start();

      // 第一次觸發
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockExecuteBackup).toHaveBeenCalledTimes(1);

      // 再過 1 秒，時間仍在 03:00，但今日已觸發
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      expect(mockExecuteBackup).toHaveBeenCalledTimes(1);
    });
  });

  describe("reload", () => {
    it("backupEnabled 從 true 改為 false 時停止排程", () => {
      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });

      backupScheduleService.start();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // 改為 false
      mockGetBackupConfig.mockReturnValue({
        backupEnabled: false,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });

      backupScheduleService.reload();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("backupEnabled 從 false 改為 true 時啟動排程", () => {
      mockGetBackupConfig.mockReturnValue({
        backupEnabled: false,
        backupTime: "03:00",
        backupGitRemoteUrl: "",
      });

      backupScheduleService.start();
      expect(vi.getTimerCount()).toBe(0);

      // 改為 true
      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });

      backupScheduleService.reload();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it("reload() 不應重置已觸發的 lastTriggeredDate，避免同日重複備份", async () => {
      // 設定假時間為 UTC 18:59:59Z，advance 1 秒後變 19:00:00Z = 台灣 03:00:00
      const fakeTime = new Date("2026-03-26T18:59:59Z");
      vi.setSystemTime(fakeTime);

      mockGetBackupConfig.mockReturnValue({
        backupEnabled: true,
        backupTime: "03:00",
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });
      mockExecuteBackup.mockResolvedValue({ success: true });

      backupScheduleService.start();

      // 觸發第一次備份
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockExecuteBackup).toHaveBeenCalledTimes(1);

      // reload()（模擬使用者修改設定）
      backupScheduleService.reload();

      // reload 後仍在同一分鐘，不應再次觸發
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockExecuteBackup).toHaveBeenCalledTimes(1);
    });
  });
});
