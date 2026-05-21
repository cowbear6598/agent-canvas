import { configStore } from "../../src/services/configStore.js";
import { initTestDb, closeDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

describe("ConfigStore", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  describe("時區設定", () => {
    it("成功更新 timezoneOffset 並讀取回正確值", () => {
      const result = configStore.update({ timezoneOffset: -5 });

      expect(result.timezoneOffset).toBe(-5);

      const config = configStore.getAll();
      expect(config.timezoneOffset).toBe(-5);
    });

    it("timezoneOffset 更新應與其他設定互不影響", () => {
      configStore.update({ timezoneOffset: 3 });
      expect(configStore.getAll().timezoneOffset).toBe(3);

      configStore.update({ timezoneOffset: 5 });
      configStore.update({ backupEnabled: true });
      expect(configStore.getAll().timezoneOffset).toBe(5);
    });

    it("getTimezoneOffset 回傳正確值", () => {
      configStore.update({ timezoneOffset: -8 });

      expect(configStore.getTimezoneOffset()).toBe(-8);
    });
  });

  describe("備份設定", () => {
    it("成功更新 backupGitRemoteUrl 並讀取回正確值", () => {
      const result = configStore.update({
        backupGitRemoteUrl: "https://github.com/user/backup.git",
      });

      expect(result.backupGitRemoteUrl).toBe(
        "https://github.com/user/backup.git",
      );

      const config = configStore.getAll();
      expect(config.backupGitRemoteUrl).toBe(
        "https://github.com/user/backup.git",
      );
    });

    it("成功更新 backupTime 並讀取回正確值", () => {
      const result = configStore.update({ backupTime: "05:30" });

      expect(result.backupTime).toBe("05:30");

      const config = configStore.getAll();
      expect(config.backupTime).toBe("05:30");
    });

    it("成功更新 backupEnabled 並讀取回正確值", () => {
      const result = configStore.update({ backupEnabled: true });

      expect(result.backupEnabled).toBe(true);

      const config = configStore.getAll();
      expect(config.backupEnabled).toBe(true);
    });

    it("只更新備份設定不影響其他設定", () => {
      configStore.update({ timezoneOffset: 8 });
      configStore.update({ backupEnabled: true });

      const config = configStore.getAll();
      expect(config.timezoneOffset).toBe(8);
      expect(config.backupEnabled).toBe(true);
    });

    it("更新其他設定不影響備份設定", () => {
      configStore.update({ backupTime: "04:00" });
      configStore.update({ timezoneOffset: 3 });

      const config = configStore.getAll();
      expect(config.backupTime).toBe("04:00");
    });

    it("getBackupConfig 回傳正確的三個備份欄位", () => {
      configStore.update({
        backupGitRemoteUrl: "https://github.com/user/backup.git",
        backupTime: "02:00",
        backupEnabled: true,
      });

      const backupConfig = configStore.getBackupConfig();

      expect(backupConfig.backupGitRemoteUrl).toBe(
        "https://github.com/user/backup.git",
      );
      expect(backupConfig.backupTime).toBe("02:00");
      expect(backupConfig.backupEnabled).toBe(true);
    });
  });
});
