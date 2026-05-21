/**
 * diskSpace 單元測試
 *
 * 覆蓋以下測試案例（依計畫書編號）：
 * 15 - statfs 回傳正常 → ok:true
 *    - statfs 拋錯 → fallback df → df 成功 → ok:true/false
 *    - statfs 不存在（typeof !== function）→ 直接走 df
 *    - 兩者都失敗 → ok:true, skipped:true（不阻擋）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";

// 安全邊界 100 MB
const SAFETY_MARGIN = 100 * 1024 * 1024;

// 測試用所需大小：1 MB
const REQUIRED_BYTES = 1 * 1024 * 1024;

// 取得 checkDiskSpace 的真實實作（不 mock diskSpace 本身）
// 注意：此測試檔案只 mock fs.statfs 與 child_process.execFile

const mockExecFile = vi.fn();

/**
 * 攔截 child_process.execFile 的 callback 版本。
 *
 * diskSpace.ts 使用 util.promisify(execFile) 來執行 df 指令。
 * promisify 的實作原理：將原始的 callback 版 execFile 包成 Promise，
 * 呼叫時仍會以 execFile(cmd, args, callback) 的形式執行，
 * callback 會作為最後一個引數傳入。
 *
 * 此 mock 攔截方式：
 * - 擷取最後一個引數（即 promisify 注入的 callback）
 * - 將前面的引數（cmd, args）傳給 mockExecFile spy 以供斷言
 * - mockExecFile 的實作可透過手動呼叫 callback 控制成功/失敗
 *
 * 注意限制：若未來 diskSpace.ts 改用非 promisify 的方式（例如直接用
 * execFileSync 或原生 Promise 包裝），此 mock 攔截邏輯需要同步更新。
 * 亦不支援 execFile 使用 AbortSignal / options 物件的情境（引數順序不同）。
 */
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => {
    // 最後一個參數是 promisify 注入的 callback（Node.js callback 慣例：最末位）
    const callback = args[args.length - 1] as (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void;
    // 將 cmd + args 傳給 spy，讓測試可驗證被呼叫的指令與參數
    mockExecFile(...args.slice(0, -1), callback);
  },
}));

// 動態 import 真實 checkDiskSpace（在 child_process mock 之後）
const { checkDiskSpace } = await import("../../src/services/diskSpace.js");

/** 建立模擬 df 成功輸出（Available KB） */
function makeDfOutput(availableKb: number): string {
  return `Filesystem     1K-blocks      Used Available Use% Mounted on\n/dev/disk1s1  976762584 500000000 ${availableKb}  52% /\n`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkDiskSpace — statfs 主路徑（案例 15）", () => {
  it("statfs 回傳足夠空間時應回 ok:true", async () => {
    // 模擬 statfs 存在且回傳大量空間
    const needed = REQUIRED_BYTES + SAFETY_MARGIN;
    const bavail = Math.ceil((needed * 2) / 4096); // 兩倍空間

    vi.spyOn(
      fs as unknown as Record<string, unknown>,
      "statfs",
    ).mockResolvedValue({
      bavail,
      bsize: 4096,
    });

    const result = await checkDiskSpace("/some/path", REQUIRED_BYTES);

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("skipped");
  });

  it("statfs 回傳空間不足時應回 ok:false reason:disk-full", async () => {
    // 模擬 statfs 存在但空間不足
    vi.spyOn(
      fs as unknown as Record<string, unknown>,
      "statfs",
    ).mockResolvedValue({
      bavail: 1, // 只有 1 block
      bsize: 4096,
    });

    const result = await checkDiskSpace("/some/path", REQUIRED_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("disk-full");
    }
  });

  it("statfs 拋錯後 fallback 到 df，df 回傳足夠空間 → ok:true", async () => {
    // statfs 拋錯
    vi.spyOn(
      fs as unknown as Record<string, unknown>,
      "statfs",
    ).mockRejectedValue(new Error("ENOSYS"));

    // df 回傳充足空間（200 GB）
    const availableKb = 200 * 1024 * 1024; // 200 GB in KB
    mockExecFile.mockImplementation(
      (
        _cmd: unknown,
        _args: unknown,
        callback: (err: null, result: { stdout: string }) => void,
      ) => {
        callback(null, { stdout: makeDfOutput(availableKb) });
      },
    );

    const result = await checkDiskSpace("/some/path", REQUIRED_BYTES);

    expect(result.ok).toBe(true);
  });

  it("statfs 拋錯後 fallback 到 df，df 回傳空間不足 → ok:false", async () => {
    // statfs 拋錯
    vi.spyOn(
      fs as unknown as Record<string, unknown>,
      "statfs",
    ).mockRejectedValue(new Error("ENOSYS"));

    // df 回傳極少空間（1 KB）
    mockExecFile.mockImplementation(
      (
        _cmd: unknown,
        _args: unknown,
        callback: (err: null, result: { stdout: string }) => void,
      ) => {
        callback(null, { stdout: makeDfOutput(1) });
      },
    );

    const result = await checkDiskSpace("/some/path", REQUIRED_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("disk-full");
    }
  });

  it("statfs 與 df 都失敗時應回 ok:true skipped:true（不阻擋）", async () => {
    // statfs 拋錯
    vi.spyOn(
      fs as unknown as Record<string, unknown>,
      "statfs",
    ).mockRejectedValue(new Error("模擬失敗"));

    // df 也拋錯
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, callback: (err: Error) => void) => {
        callback(new Error("df 執行失敗"));
      },
    );

    const result = await checkDiskSpace("/some/path", REQUIRED_BYTES);

    expect(result.ok).toBe(true);
    expect((result as { skipped?: boolean }).skipped).toBe(true);
  });
});

// ================================================================
// checkDiskSpace — statfs 不存在時直接走 df fallback（項目 30）
// ================================================================
describe("checkDiskSpace — statfs 不存在時應直接走 df fallback", () => {
  it("fs.statfs 為非 function（undefined）時不呼叫 statfs，直接走 df，df 成功 → ok:true", async () => {
    // 模擬 statfs 不存在（typeof !== function）：暫時將屬性設為 undefined
    const fsRecord = fs as unknown as Record<string, unknown>;
    const original = fsRecord.statfs;
    fsRecord.statfs = undefined;

    // df 回傳充足空間（100 GB）
    const availableKb = 100 * 1024 * 1024;
    mockExecFile.mockImplementation(
      (
        _cmd: unknown,
        _args: unknown,
        callback: (err: null, result: { stdout: string }) => void,
      ) => {
        callback(null, { stdout: makeDfOutput(availableKb) });
      },
    );

    try {
      const result = await checkDiskSpace("/some/path", REQUIRED_BYTES);
      // hasStatfsSupport() 回傳 false，直接走 df fallback
      expect(result.ok).toBe(true);
    } finally {
      // 還原，避免污染其他測試
      fsRecord.statfs = original;
    }
  });

  it("fs.statfs 為非 function（undefined）時，df 回傳空間不足 → ok:false reason:disk-full", async () => {
    // 模擬 statfs 不存在
    const fsRecord = fs as unknown as Record<string, unknown>;
    const original = fsRecord.statfs;
    fsRecord.statfs = undefined;

    // df 回傳極少空間（1 KB）
    mockExecFile.mockImplementation(
      (
        _cmd: unknown,
        _args: unknown,
        callback: (err: null, result: { stdout: string }) => void,
      ) => {
        callback(null, { stdout: makeDfOutput(1) });
      },
    );

    try {
      const result = await checkDiskSpace("/some/path", REQUIRED_BYTES);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("disk-full");
      }
    } finally {
      // 還原，避免污染其他測試
      fsRecord.statfs = original;
    }
  });
});
