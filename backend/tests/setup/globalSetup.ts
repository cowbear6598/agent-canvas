// Bun Test 全域 Setup/Teardown
// 透過 preload 載入，使用 beforeAll/afterAll 來管理全域測試生命週期

import { mkdir, rm } from "fs/promises";
import { testConfig } from "./testConfig.js";

/**
 * 全域 beforeAll
 * 在所有測試開始前執行一次（建立測試資料夾）
 */
beforeAll(async () => {
  try {
    await mkdir(testConfig.appDataRoot, { recursive: true });
    await mkdir(testConfig.canvasRoot, { recursive: true });
    await mkdir(testConfig.repositoriesRoot, { recursive: true });
    await mkdir(testConfig.skillsPath, { recursive: true });
    await mkdir(testConfig.agentsPath, { recursive: true });
    await mkdir(testConfig.commandsPath, { recursive: true });
  } catch (error) {
    throw error;
  }
});

/**
 * 全域 afterAll
 * 在所有測試結束後執行一次（清理測試資料夾）
 */
afterAll(async () => {
  try {
    await rm(testConfig.appDataRoot, { recursive: true, force: true });
  } catch {
    // 不拋出錯誤，避免影響測試結果
  }
});
