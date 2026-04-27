import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// 注意：globalSetup / testConfig 已將 logger、config 進行全域 mock，
// 這裡不再 mock，避免與 setup 衝突。本測試只驗證 migrateFromClaudeCanvas 對檔案系統的行為。
import { startupService } from "../../src/services/startupService.js";

interface MigrateAccessor {
  migrateFromClaudeCanvas: () => Promise<void>;
}

function getMigrate(): MigrateAccessor["migrateFromClaudeCanvas"] {
  // 透過 cast 取用 private method 進行單元測試
  const svc = startupService as unknown as MigrateAccessor;
  return svc.migrateFromClaudeCanvas.bind(startupService);
}

describe("StartupService.migrateFromClaudeCanvas", () => {
  let tmpHome: string;
  let oldPath: string;
  let newPath: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // 為每個測試建立隔離的 tmp home，避免碰到真實 ~/Documents
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "startup-migrate-"));
    await fs.mkdir(path.join(tmpHome, "Documents"), { recursive: true });
    oldPath = path.join(tmpHome, "Documents", "ClaudeCanvas");
    newPath = path.join(tmpHome, "Documents", "AgentCanvas");
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  });

  afterEach(async () => {
    homedirSpy.mockRestore();
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("只有舊資料夾存在時應 rename 至新資料夾", async () => {
    await fs.mkdir(oldPath, { recursive: true });
    await fs.writeFile(path.join(oldPath, "marker.txt"), "hello");

    await getMigrate()();

    const oldStillExists = await fs
      .access(oldPath)
      .then(() => true)
      .catch(() => false);
    const newExistsNow = await fs
      .access(newPath)
      .then(() => true)
      .catch(() => false);
    const markerContent = await fs.readFile(
      path.join(newPath, "marker.txt"),
      "utf-8",
    );

    expect(oldStillExists).toBe(false);
    expect(newExistsNow).toBe(true);
    expect(markerContent).toBe("hello");
  });

  it("只有新資料夾存在時應無動作", async () => {
    await fs.mkdir(newPath, { recursive: true });
    await fs.writeFile(path.join(newPath, "marker.txt"), "existing");

    await getMigrate()();

    const oldExistsNow = await fs
      .access(oldPath)
      .then(() => true)
      .catch(() => false);
    const markerContent = await fs.readFile(
      path.join(newPath, "marker.txt"),
      "utf-8",
    );

    expect(oldExistsNow).toBe(false);
    expect(markerContent).toBe("existing");
  });

  it("舊與新資料夾同時存在時應跳過自動搬遷（兩者都保留原狀）", async () => {
    await fs.mkdir(oldPath, { recursive: true });
    await fs.mkdir(newPath, { recursive: true });
    await fs.writeFile(path.join(oldPath, "old.txt"), "old");
    await fs.writeFile(path.join(newPath, "new.txt"), "new");

    await getMigrate()();

    const oldStillExists = await fs
      .access(oldPath)
      .then(() => true)
      .catch(() => false);
    const newStillExists = await fs
      .access(newPath)
      .then(() => true)
      .catch(() => false);
    expect(oldStillExists).toBe(true);
    expect(newStillExists).toBe(true);

    // 內容皆未變動
    const oldContent = await fs.readFile(
      path.join(oldPath, "old.txt"),
      "utf-8",
    );
    const newContent = await fs.readFile(
      path.join(newPath, "new.txt"),
      "utf-8",
    );
    expect(oldContent).toBe("old");
    expect(newContent).toBe("new");
  });

  it("舊與新資料夾皆不存在時應無動作", async () => {
    await getMigrate()();

    const oldExistsNow = await fs
      .access(oldPath)
      .then(() => true)
      .catch(() => false);
    const newExistsNow = await fs
      .access(newPath)
      .then(() => true)
      .catch(() => false);
    expect(oldExistsNow).toBe(false);
    expect(newExistsNow).toBe(false);
  });
});
