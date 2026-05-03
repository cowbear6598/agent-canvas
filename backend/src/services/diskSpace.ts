/**
 * 磁碟空間檢查 helper。
 *
 * 注意：fallback df -k 只支援 macOS / Linux，Windows runtime 不在範圍。
 */

import { execFile } from "child_process";
import fs from "fs/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** 安全邊界：100 MB */
const SAFETY_MARGIN_BYTES = 100 * 1024 * 1024;

/**
 * 判斷當前 runtime 是否支援 fs.statfs。
 * Bun 原生支援；Node.js 版本依賴不同，使用前需先透過此 helper 確認。
 */
function hasStatfsSupport(): boolean {
  return (
    typeof (fs as unknown as Record<string, unknown>).statfs === "function"
  );
}

export type DiskSpaceResult =
  | { ok: true; skipped?: false }
  | { ok: false; reason: "disk-full" }
  | { ok: true; skipped: true };

/**
 * 檢查 targetDir 是否有足夠空間存放 requiredBytes 的資料（含 100 MB 安全邊界）。
 *
 * 主路徑：fs.statfs（Bun 原生支援）
 * Fallback：df -k（macOS / Linux）
 * 兩條路徑都失敗：log warn 後回傳 skipped（不阻擋寫入）
 */
export async function checkDiskSpace(
  targetDir: string,
  requiredBytes: number,
): Promise<DiskSpaceResult> {
  const needed = requiredBytes + SAFETY_MARGIN_BYTES;

  // --- 主路徑：fs.statfs ---
  if (hasStatfsSupport()) {
    try {
      const stat = await (
        fs as unknown as {
          statfs(
            path: string,
          ): Promise<{ bavail: bigint | number; bsize: bigint | number }>;
        }
      ).statfs(targetDir);

      const bavail = Number(stat.bavail);
      const bsize = Number(stat.bsize);
      const freeBytes = bavail * bsize;

      if (freeBytes < needed) {
        return { ok: false, reason: "disk-full" };
      }
      return { ok: true };
    } catch {
      // 任何 statfs 錯誤（ENOSYS、TypeError、或其他）都 fall-through 進 df fallback
    }
  }

  // --- Fallback：df -k ---
  try {
    const { stdout } = await execFileAsync("df", ["-k", targetDir]);
    // df 輸出第二行，欄位以空白分隔，第 4 欄為 Available（KB）
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) {
      throw new Error("df 輸出格式不符預期");
    }
    const cols = lines[1].trim().split(/\s+/);
    // cols[3] = Available (KB)；需確認欄位數足夠，避免格式異常時 cols[3] 為 undefined
    if (cols.length < 4) {
      throw new Error(`df 輸出欄位數不足（期望 >= 4，實際 ${cols.length}）`);
    }
    const availableKb = parseInt(cols[3], 10);
    if (isNaN(availableKb)) {
      throw new Error(`df 第 4 欄無法解析為數字：${cols[3]}`);
    }
    const freeBytes = availableKb * 1024;

    if (freeBytes < needed) {
      return { ok: false, reason: "disk-full" };
    }
    return { ok: true };
  } catch {
    // 兩條路徑都失敗，跳過檢查，不阻擋寫入
    return { ok: true, skipped: true };
  }
}
