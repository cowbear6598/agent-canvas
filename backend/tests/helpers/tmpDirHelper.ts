import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 在系統 tmpdir 下建立隔離測試目錄 */
export async function createTmpDir(prefix = "ccc-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** 清除測試目錄（recursive + force，不拋錯） */
export async function cleanupTmpDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * 暫時覆寫 process.env 變數，回傳還原函式。
 * 適用於 beforeEach 中設定、afterEach 中呼叫還原。
 *
 * 使用範例：
 *   const restore = overrideEnv({ CLAUDE_JSON_PATH: "/tmp/foo" })
 *   // ... 測試動作
 *   restore()
 */
export function overrideEnv(
  vars: Record<string, string | undefined>,
): () => void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  return () => {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  };
}
