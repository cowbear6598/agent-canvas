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

  describe("取得設定", () => {
    it("DB 無資料時回傳預設值", () => {
      const config = configStore.getAll();

      expect(config.summaryModel).toBe("sonnet");
      expect(config.aiDecideModel).toBe("sonnet");
    });

    it("DB 有資料時回傳 DB 中的值", () => {
      configStore.update({ summaryModel: "opus" });

      const config = configStore.getAll();

      expect(config.summaryModel).toBe("opus");
      expect(config.aiDecideModel).toBe("sonnet");
    });
  });

  describe("更新設定", () => {
    it("成功寫入並讀取回正確值", () => {
      const result = configStore.update({
        summaryModel: "opus",
        aiDecideModel: "haiku",
      });

      expect(result.summaryModel).toBe("opus");
      expect(result.aiDecideModel).toBe("haiku");
    });

    it("只更新 summaryModel 不影響 aiDecideModel", () => {
      configStore.update({ summaryModel: "opus", aiDecideModel: "opus" });
      configStore.update({ summaryModel: "haiku" });

      const config = configStore.getAll();

      expect(config.summaryModel).toBe("haiku");
      expect(config.aiDecideModel).toBe("opus");
    });

    it("只更新 aiDecideModel 不影響 summaryModel", () => {
      configStore.update({ summaryModel: "opus", aiDecideModel: "opus" });
      configStore.update({ aiDecideModel: "haiku" });

      const config = configStore.getAll();

      expect(config.summaryModel).toBe("opus");
      expect(config.aiDecideModel).toBe("haiku");
    });
  });

  describe("取得單一設定", () => {
    it("getSummaryModel 回傳正確值", () => {
      configStore.update({ summaryModel: "haiku" });

      expect(configStore.getSummaryModel()).toBe("haiku");
    });

    it("getAiDecideModel 回傳正確值", () => {
      configStore.update({ aiDecideModel: "opus" });

      expect(configStore.getAiDecideModel()).toBe("opus");
    });
  });

  describe("時區設定", () => {
    it("DB 無資料時 timezoneOffset 回傳預設值 8", () => {
      const config = configStore.getAll();

      expect(config.timezoneOffset).toBe(8);
    });

    it("成功更新 timezoneOffset 並讀取回正確值", () => {
      const result = configStore.update({ timezoneOffset: -5 });

      expect(result.timezoneOffset).toBe(-5);

      const config = configStore.getAll();
      expect(config.timezoneOffset).toBe(-5);
    });

    it("只更新 timezoneOffset 不影響其他設定", () => {
      configStore.update({ summaryModel: "opus" });
      configStore.update({ timezoneOffset: 3 });

      const config = configStore.getAll();
      expect(config.summaryModel).toBe("opus");
      expect(config.timezoneOffset).toBe(3);
    });

    it("更新其他設定不影響 timezoneOffset", () => {
      configStore.update({ timezoneOffset: 5 });
      configStore.update({ summaryModel: "haiku" });

      const config = configStore.getAll();
      expect(config.timezoneOffset).toBe(5);
    });

    it("getTimezoneOffset 回傳正確值", () => {
      configStore.update({ timezoneOffset: -8 });

      expect(configStore.getTimezoneOffset()).toBe(-8);
    });
  });

  describe("備份設定", () => {
    it("DB 無資料時 backupGitRemoteUrl 回傳預設空字串", () => {
      const config = configStore.getAll();

      expect(config.backupGitRemoteUrl).toBe("");
    });

    it("DB 無資料時 backupTime 回傳預設 '03:00'", () => {
      const config = configStore.getAll();

      expect(config.backupTime).toBe("03:00");
    });

    it("DB 無資料時 backupEnabled 回傳預設 false", () => {
      const config = configStore.getAll();

      expect(config.backupEnabled).toBe(false);
    });

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
      configStore.update({ summaryModel: "opus" });
      configStore.update({ backupEnabled: true });

      const config = configStore.getAll();
      expect(config.summaryModel).toBe("opus");
      expect(config.backupEnabled).toBe(true);
    });

    it("更新其他設定不影響備份設定", () => {
      configStore.update({ backupTime: "04:00" });
      configStore.update({ summaryModel: "haiku" });

      const config = configStore.getAll();
      expect(config.backupTime).toBe("04:00");
      expect(config.summaryModel).toBe("haiku");
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
