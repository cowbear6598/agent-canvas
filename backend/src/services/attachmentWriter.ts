/**
 * attachmentWriter — 附件寫檔模組。
 *
 * writeAttachmentToStaging：將單一上傳檔案寫入 staging 目錄。
 * promoteStagingToFinal：staging → 正式目錄 atomic rename（WS handler 呼叫）。
 * 任一步驟失敗 → 清除已寫入的部分後 rethrow 對應 Error class。
 */

import fs from "fs/promises";
import path from "path";
import { config } from "../config/index.js";
import {
  AttachmentInvalidNameError,
  AttachmentTooLargeError,
  AttachmentWriteError,
  UploadSessionNotFoundError,
} from "./attachmentErrors.js";
import {
  MAX_SINGLE_BYTES,
  UPLOAD_SESSION_ID_REGEX,
} from "./uploadConstants.js";
import { extractZipAttachment } from "./attachmentZipExtractor.js";

export interface WriteAttachmentsResult {
  /** 最終落地目錄絕對路徑（<tmpRoot>/<chatMessageId>/） */
  dir: string;
  /** 最終 filename 清單，依輸入順序 */
  files: string[];
}

/** staging 單一上傳結果 */
export interface StagingWriteResult {
  /** 落地後的檔案或資料夾名稱（含 collision rename） */
  filename: string;
  /** 檔案 bytes 大小 */
  size: number;
  /** MIME type（由瀏覽器 File.type 傳入） */
  mime: string;
}

/** chatMessageId UUID 驗證正則（寬鬆版：任意版本 UUID，defense-in-depth） */
const CHAT_MESSAGE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 將名稱拆成 `{ base, ext }` 以便 collision rename。
 * 例：`plan.md` → `{ base: "plan", ext: ".md" }`
 *     `a`       → `{ base: "a", ext: "" }`
 *     `.gitignore` → `{ base: ".gitignore", ext: "" }`（dot-file 不拆）
 */
function splitNameParts(filename: string): { base: string; ext: string } {
  const ext = path.extname(filename);
  // dot-file（如 .gitignore）：ext 會等於整個 filename，視為無副檔名
  if (ext === filename) {
    return { base: filename, ext: "" };
  }
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return { base, ext };
}

/** collision rename 的最大嘗試次數（理論上不應達到）*/
const MAX_RENAME_COUNTER = 9999;

/**
 * 解析 collision rename 後的最終 filename。
 * 若 `name` 已在 `usedSet` 中，則嘗試 `base-1.ext`、`base-2.ext`...，直到找到空位。
 * 超過 MAX_RENAME_COUNTER 次仍無空位時拋出 AttachmentWriteError，確保不會無窮迴圈。
 */
function resolveUniqueFilename(name: string, usedSet: Set<string>): string {
  if (!usedSet.has(name)) {
    return name;
  }
  const { base, ext } = splitNameParts(name);
  for (let counter = 1; counter <= MAX_RENAME_COUNTER; counter++) {
    const candidate = `${base}-${counter}${ext}`;
    if (!usedSet.has(candidate)) {
      return candidate;
    }
  }
  throw new AttachmentWriteError(
    new Error(`無法在 ${MAX_RENAME_COUNTER} 次嘗試內找到唯一檔名：${name}`),
  );
}

/**
 * 將單一檔案寫入 staging 目錄（`<stagingRoot>/<uploadSessionId>/`）。
 *
 * - 驗證 uploadSessionId 為 UUID v4 格式（防路徑穿越）
 * - sanitize 檔名，不合法直接拋出 AttachmentInvalidNameError
 * - 讀取目錄已有檔案後做 collision rename，確保不覆蓋同名檔
 * - 單檔超過 MAX_SINGLE_BYTES 拋出 AttachmentTooLargeError
 * - ZIP 檔案安全解壓到同名資料夾，不保留原始壓縮檔
 * - 寫入失敗時清除已寫入的部分檔案後 rethrow AttachmentWriteError
 */
export async function writeAttachmentToStaging(
  uploadSessionId: string,
  file: File,
  originalName: string,
): Promise<StagingWriteResult> {
  if (!UPLOAD_SESSION_ID_REGEX.test(uploadSessionId)) {
    throw new AttachmentWriteError(
      new Error(`無效的 uploadSessionId 格式：${uploadSessionId}`),
    );
  }

  const sanitized = path.basename(originalName).trim();
  if (sanitized === "" || sanitized === ".." || sanitized === ".") {
    throw new AttachmentInvalidNameError(originalName);
  }

  if (file.size > MAX_SINGLE_BYTES) {
    throw new AttachmentTooLargeError();
  }

  const sessionDir = path.join(config.stagingRoot, uploadSessionId);

  // 邊界檢查：確保 sessionDir 仍在 stagingRoot 之內（path traversal 防禦）
  if (
    !path
      .resolve(sessionDir)
      .startsWith(path.resolve(config.stagingRoot) + path.sep)
  ) {
    throw new AttachmentWriteError(
      new Error(`sessionDir 超出 stagingRoot 邊界：${sessionDir}`),
    );
  }

  try {
    await fs.mkdir(sessionDir, { recursive: true });
  } catch (err) {
    throw new AttachmentWriteError(err instanceof Error ? err : undefined);
  }

  let existingFiles: string[] = [];
  try {
    existingFiles = await fs.readdir(sessionDir);
  } catch {
    // 目錄剛建立時可能尚無內容，保持空陣列即可
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (/\.zip$/i.test(sanitized)) {
    const result = await extractZipAttachment(bytes, sessionDir, sanitized);
    return {
      filename: result.directoryName,
      size: bytes.byteLength,
      mime: file.type,
    };
  }

  const usedSet = new Set(existingFiles);
  const finalFilename = resolveUniqueFilename(sanitized, usedSet);
  const destPath = path.join(sessionDir, finalFilename);

  try {
    await fs.writeFile(destPath, bytes);
  } catch (err) {
    // 清除寫到一半的檔案後 rethrow
    await fs.rm(destPath, { force: true }).catch(() => void 0);
    throw new AttachmentWriteError(err instanceof Error ? err : undefined);
  }

  return {
    filename: finalFilename,
    size: bytes.byteLength,
    mime: file.type,
  };
}

/**
 * 將 staging 目錄 atomic rename 為正式附件目錄（`<tmpRoot>/<chatMessageId>/`）。
 *
 * - 驗證兩個 ID 皆為合法 UUID 格式
 * - 檢查 stagingDir 存在；不存在拋出 UploadSessionNotFoundError
 * - 邊界檢查確保兩個目錄皆在 tmpRoot 之內
 * - 用 fs.rename atomic 搬移；失敗則清除 finalDir 殘留並 rethrow AttachmentWriteError
 * - 回傳 WriteAttachmentsResult（dir + files）
 */
export async function promoteStagingToFinal(
  uploadSessionId: string,
  chatMessageId: string,
): Promise<WriteAttachmentsResult> {
  if (!UPLOAD_SESSION_ID_REGEX.test(uploadSessionId)) {
    throw new AttachmentWriteError(
      new Error(`無效的 uploadSessionId 格式：${uploadSessionId}`),
    );
  }

  if (!CHAT_MESSAGE_ID_REGEX.test(chatMessageId)) {
    throw new AttachmentWriteError(
      new Error(`無效的 chatMessageId 格式：${chatMessageId}`),
    );
  }

  const stagingDir = path.join(config.stagingRoot, uploadSessionId);
  const finalDir = path.join(config.tmpRoot, chatMessageId);

  // 邊界檢查：stagingDir 必須在 tmpRoot（stagingRoot 掛在 tmpRoot 下）之內
  if (
    !path
      .resolve(stagingDir)
      .startsWith(path.resolve(config.tmpRoot) + path.sep)
  ) {
    throw new AttachmentWriteError(
      new Error(`stagingDir 超出 tmpRoot 邊界：${stagingDir}`),
    );
  }

  // 邊界檢查：finalDir 必須在 tmpRoot 之內
  if (
    !path.resolve(finalDir).startsWith(path.resolve(config.tmpRoot) + path.sep)
  ) {
    throw new AttachmentWriteError(
      new Error(`finalDir 超出 tmpRoot 邊界：${finalDir}`),
    );
  }

  // 確認 staging 目錄存在；不存在代表 session 無效或已過期
  try {
    await fs.access(stagingDir);
  } catch {
    throw new UploadSessionNotFoundError(uploadSessionId);
  }

  let files: string[];
  try {
    files = await fs.readdir(stagingDir);
  } catch (err) {
    throw new AttachmentWriteError(err instanceof Error ? err : undefined);
  }

  try {
    await fs.rename(stagingDir, finalDir);
  } catch (err) {
    // 清除可能殘留的 finalDir，避免不完整目錄佔用空間
    await fs.rm(finalDir, { recursive: true, force: true }).catch(() => void 0);
    throw new AttachmentWriteError(err instanceof Error ? err : undefined);
  }

  return {
    dir: finalDir,
    files,
  };
}
