import { vi, describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";

// 注意：全域 testConfig.ts（setupFiles）已在模組載入前將 config.commandsPath
// 覆寫為系統臨時目錄下的唯一子目錄，因此 commandService 的 baseService
// 在第一次 import 時即綁定到該安全路徑，不會寫入 ~/Documents/AgentCanvas/。

import { commandService } from "../../src/services/commandService.js";

describe("commandService.read", () => {
  afterEach(async () => {
    // 觸發 invalidateCache，清空 cachedCommandContents
    await commandService.create("__reset__", "").catch(() => {});
    await commandService.delete("__reset__").catch(() => {});
    vi.restoreAllMocks();
  });

  it("對存在的 commandId 回傳 markdown 內容", async () => {
    await commandService.create("cmd-read", "# 測試內容\n這是 markdown");

    const result = await commandService.read("cmd-read");

    expect(result).toBe("# 測試內容\n這是 markdown");

    await commandService.delete("cmd-read").catch(() => {});
  });

  it("對不存在的 commandId 回傳 null，不丟錯", async () => {
    const result = await commandService.read("not-exist-command");

    expect(result).toBeNull();
  });

  it("mtime 未變時命中快取，fs.readFile 不重複呼叫", async () => {
    await commandService.create("cmd-cache", "初始內容");

    // 第一次 read：讀磁碟並建立快取
    const first = await commandService.read("cmd-cache");
    expect(first).toBe("初始內容");

    // spy on fs.readFile，驗證第二次 read 未觸發磁碟讀取
    const readFileSpy = vi.spyOn(fs, "readFile");

    // 第二次 read：mtime 未變，應命中快取，不呼叫 readFile
    const second = await commandService.read("cmd-cache");

    expect(second).toBe("初始內容");
    expect(readFileSpy).not.toHaveBeenCalled();

    await commandService.delete("cmd-cache").catch(() => {});
  });

  it("update 後快取被清除，下次 read 取得新內容", async () => {
    await commandService.create("cmd-update", "舊內容");

    // 先 read 以建立快取
    const before = await commandService.read("cmd-update");
    expect(before).toBe("舊內容");

    // update 呼叫 invalidateCache，清除 cachedCommandContents
    await commandService.update("cmd-update", "新內容");

    const after = await commandService.read("cmd-update");
    expect(after).toBe("新內容");

    await commandService.delete("cmd-update").catch(() => {});
  });

  it("delete 後快取被清除，再次 read 回傳 null", async () => {
    await commandService.create("cmd-delete", "刪除測試");

    // 先 read 建立快取
    const before = await commandService.read("cmd-delete");
    expect(before).toBe("刪除測試");

    // delete 呼叫 invalidateCache
    await commandService.delete("cmd-delete");

    const after = await commandService.read("cmd-delete");
    expect(after).toBeNull();
  });

  it("create 後快取被清除，舊 id 仍可正確 read", async () => {
    // 先建立並 read 以建立快取
    await commandService.create("cmd-create-a", "內容 A");
    const before = await commandService.read("cmd-create-a");
    expect(before).toBe("內容 A");

    // 建立第二個 command（觸發 invalidateCache，清除所有快取）
    await commandService.create("cmd-create-b", "內容 B");

    // 兩個 command 都可以被正確讀取
    const resultA = await commandService.read("cmd-create-a");
    const resultB = await commandService.read("cmd-create-b");

    expect(resultA).toBe("內容 A");
    expect(resultB).toBe("內容 B");

    await commandService.delete("cmd-create-a").catch(() => {});
    await commandService.delete("cmd-create-b").catch(() => {});
  });

  it("setGroupId 後快取被清除，仍可從群組目錄 read 到正確內容", async () => {
    await commandService.create("cmd-group", "群組測試");

    // 先 read 建立快取
    const before = await commandService.read("cmd-group");
    expect(before).toBe("群組測試");

    // setGroupId 呼叫 invalidateCache，並移動檔案到群組子目錄
    await commandService.setGroupId("cmd-group", "my-group");

    // 快取清除後，重新 read 應從群組目錄找到檔案
    const after = await commandService.read("cmd-group");
    expect(after).toBe("群組測試");

    // 清理：還原 groupId 後刪除（或直接刪除）
    await commandService.setGroupId("cmd-group", null).catch(() => {});
    await commandService.delete("cmd-group").catch(() => {});
  });

  it("外部直接以 fs.writeFile 修改檔案（mtime 變動）後，read 自動重讀並回傳新內容", async () => {
    await commandService.create("cmd-external", "原始內容");

    // 第一次 read 建立快取
    const original = await commandService.read("cmd-external");
    expect(original).toBe("原始內容");

    // 取得檔案路徑（用以繞過 service 直接改檔）
    const filePath = await commandService.findFilePath("cmd-external");
    expect(filePath).not.toBeNull();

    // 等待一小段時間確保 mtime 有差異，再直接寫入新內容
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(filePath!, "外部修改後的新內容", "utf-8");

    // 驗證 mtime 確實更新（測試前提條件）
    const stat = await fs.stat(filePath!);
    expect(stat.mtimeMs).toBeGreaterThan(0);

    // 下次 read 應感知到 mtime 變化，重讀磁碟並回傳新內容（不需要等 TTL）
    const updated = await commandService.read("cmd-external");
    expect(updated).toBe("外部修改後的新內容");

    await commandService.delete("cmd-external").catch(() => {});
  });
});
