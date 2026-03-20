import { configStore } from "../../src/services/configStore.js";
import { initTestDb, closeDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { getStmts } from "../../src/database/stmtsHelper.js";

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

  describe("enabledPluginIds 讀寫", () => {
    it("DB 無資料時 getAll 的 enabledPluginIds 預設為空陣列", () => {
      const config = configStore.getAll();

      expect(config.enabledPluginIds).toEqual([]);
    });

    it("寫入 enabledPluginIds 後可正確讀取", () => {
      const ids = [
        "soap-dev@soap-toolkit",
        "skill-creator@claude-plugins-official",
      ];
      configStore.update({ enabledPluginIds: ids });

      const config = configStore.getAll();

      expect(config.enabledPluginIds).toEqual(ids);
    });

    it("更新 enabledPluginIds 不影響 summaryModel", () => {
      configStore.update({ summaryModel: "opus" });
      configStore.update({ enabledPluginIds: ["soap-dev@soap-toolkit"] });

      const config = configStore.getAll();

      expect(config.summaryModel).toBe("opus");
      expect(config.enabledPluginIds).toEqual(["soap-dev@soap-toolkit"]);
    });

    it("寫入空陣列後回傳空陣列", () => {
      configStore.update({ enabledPluginIds: ["soap-dev@soap-toolkit"] });
      configStore.update({ enabledPluginIds: [] });

      const config = configStore.getAll();

      expect(config.enabledPluginIds).toEqual([]);
    });

    it("getEnabledPluginIds 無資料時回傳空陣列", () => {
      expect(configStore.getEnabledPluginIds()).toEqual([]);
    });

    it("getEnabledPluginIds 有資料時回傳正確值", () => {
      const ids = ["soap-dev@soap-toolkit"];
      configStore.update({ enabledPluginIds: ids });

      expect(configStore.getEnabledPluginIds()).toEqual(ids);
    });

    it("getAll 過濾非 string 元素", () => {
      getStmts().globalSettings.upsert.run({
        $key: "enabled_plugins",
        $value: JSON.stringify(["valid-id", 123, null, "another-id"]),
      });

      const config = configStore.getAll();

      expect(config.enabledPluginIds).toEqual(["valid-id", "another-id"]);
    });

    it("getAll 在 JSON 損毀時回傳空陣列", () => {
      getStmts().globalSettings.upsert.run({
        $key: "enabled_plugins",
        $value: "not-valid-json",
      });

      const config = configStore.getAll();

      expect(config.enabledPluginIds).toEqual([]);
    });
  });
});
