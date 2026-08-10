import fs from "fs/promises";
import path from "path";
import { strFromU8, unzipSync } from "fflate";
import {
  AttachmentArchiveTooLargeError,
  AttachmentInvalidArchiveError,
  AttachmentWriteError,
} from "./attachmentErrors.js";
import {
  MAX_ZIP_ENTRY_COUNT,
  MAX_ZIP_EXTRACTED_BYTES,
} from "./uploadConstants.js";

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_U16_SENTINEL = 0xffff;
const ZIP64_U32_SENTINEL = 0xffffffff;
const ZIP_SYMLINK_FILE_TYPE = 0xa000;
const ZIP_FILE_TYPE_MASK = 0xf000;
const ZIP_ENCRYPTED_FLAG = 0x0001;
const MAX_RENAME_COUNTER = 9999;

interface ParsedZipEntry {
  /** 寫入磁碟時使用的正常化名稱 */
  name: string;
  /** fflate 依 ZIP UTF-8 flag 解碼後的 lookup key */
  fflateName: string;
  isDirectory: boolean;
  uncompressedSize: number;
}

export interface ExtractZipResult {
  directoryName: string;
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectoryOffset(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 22) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 0xffff - 22);
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32LE(view, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return null;
}

function normalizeAndValidateEntryName(rawName: string): string {
  const normalizedName = rawName.replace(/\\/g, "/");
  const parts = normalizedName.split("/").filter(Boolean);
  const isDirectory = normalizedName.endsWith("/");
  if (
    normalizedName.includes("\0") ||
    normalizedName.startsWith("/") ||
    path.win32.isAbsolute(normalizedName) ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new AttachmentInvalidArchiveError(
      `ZIP 內含不安全路徑：${normalizedName}`,
    );
  }

  return `${parts.join("/")}${isDirectory ? "/" : ""}`;
}

function decodeEntryNames(
  nameBytes: Uint8Array,
  flags: number,
): { name: string; fflateName: string } {
  const usesUtf8Flag = (flags & 0x0800) !== 0;
  const fflateName = strFromU8(nameBytes, !usesUtf8Flag);
  if (usesUtf8Flag) {
    return { name: fflateName, fflateName };
  }

  try {
    const utf8Name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    return { name: utf8Name, fflateName };
  } catch {
    return { name: fflateName, fflateName };
  }
}

function validateEntryTree(entries: ParsedZipEntry[]): void {
  const files = new Set(
    entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name),
  );
  const canonicalPaths = new Set<string>();

  for (const entry of entries) {
    const canonicalPath = entry.name.replace(/\/$/, "");
    if (canonicalPaths.has(canonicalPath)) {
      throw new AttachmentInvalidArchiveError(
        `ZIP 內含衝突路徑：${canonicalPath}`,
      );
    }
    canonicalPaths.add(canonicalPath);

    const parts = canonicalPath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join("/");
      if (files.has(ancestor)) {
        throw new AttachmentInvalidArchiveError(
          `ZIP 內的檔案與資料夾路徑衝突：${ancestor}`,
        );
      }
    }
  }
}

function parseZipEntries(bytes: Uint8Array): ParsedZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectoryOffset(bytes);
  if (eocdOffset === null) {
    throw new AttachmentInvalidArchiveError("找不到 ZIP 中央目錄");
  }

  const diskNumber = readUint16LE(view, eocdOffset + 4);
  const centralDirectoryDiskNumber = readUint16LE(view, eocdOffset + 6);
  const entriesOnThisDisk = readUint16LE(view, eocdOffset + 8);
  const totalEntries = readUint16LE(view, eocdOffset + 10);
  const centralDirectorySize = readUint32LE(view, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(view, eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDiskNumber !== 0 ||
    entriesOnThisDisk !== totalEntries
  ) {
    throw new AttachmentInvalidArchiveError("不支援分割式 ZIP 檔案");
  }

  if (
    totalEntries === ZIP64_U16_SENTINEL ||
    centralDirectorySize === ZIP64_U32_SENTINEL ||
    centralDirectoryOffset === ZIP64_U32_SENTINEL
  ) {
    throw new AttachmentInvalidArchiveError("不支援 ZIP64 格式");
  }

  if (totalEntries === 0) {
    throw new AttachmentInvalidArchiveError("ZIP 內沒有可解壓縮的內容");
  }
  if (totalEntries > MAX_ZIP_ENTRY_COUNT) {
    throw new AttachmentInvalidArchiveError(
      `ZIP 項目數量超過 ${MAX_ZIP_ENTRY_COUNT} 個上限`,
    );
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset >= bytes.byteLength ||
    centralDirectoryEnd > bytes.byteLength
  ) {
    throw new AttachmentInvalidArchiveError("ZIP 中央目錄資料損毀");
  }

  const entries: ParsedZipEntry[] = [];
  const usedNames = new Set<string>();
  let totalUncompressedBytes = 0;
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (
      cursor + 46 > centralDirectoryEnd ||
      readUint32LE(view, cursor) !==
        ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE
    ) {
      throw new AttachmentInvalidArchiveError("ZIP 中央目錄格式不正確");
    }

    const flags = readUint16LE(view, cursor + 8);
    const compressedSize = readUint32LE(view, cursor + 20);
    const uncompressedSize = readUint32LE(view, cursor + 24);
    const fileNameLength = readUint16LE(view, cursor + 28);
    const extraFieldLength = readUint16LE(view, cursor + 30);
    const fileCommentLength = readUint16LE(view, cursor + 32);
    const externalAttributes = readUint32LE(view, cursor + 38);
    const localHeaderOffset = readUint32LE(view, cursor + 42);
    const fileNameOffset = cursor + 46;
    const nextCursor =
      fileNameOffset + fileNameLength + extraFieldLength + fileCommentLength;

    if (nextCursor > centralDirectoryEnd) {
      throw new AttachmentInvalidArchiveError("ZIP 中央目錄資料不完整");
    }
    if (
      compressedSize === ZIP64_U32_SENTINEL ||
      uncompressedSize === ZIP64_U32_SENTINEL ||
      localHeaderOffset === ZIP64_U32_SENTINEL
    ) {
      throw new AttachmentInvalidArchiveError("不支援 ZIP64 格式");
    }
    if (
      localHeaderOffset + 4 > bytes.byteLength ||
      readUint32LE(view, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new AttachmentInvalidArchiveError("ZIP local header 格式不正確");
    }
    if ((flags & ZIP_ENCRYPTED_FLAG) !== 0) {
      throw new AttachmentInvalidArchiveError("不支援加密 ZIP 檔案");
    }

    const decodedNames = decodeEntryNames(
      bytes.subarray(fileNameOffset, fileNameOffset + fileNameLength),
      flags,
    );
    const name = normalizeAndValidateEntryName(decodedNames.name);
    const fflateName = normalizeAndValidateEntryName(decodedNames.fflateName);
    if (usedNames.has(name)) {
      throw new AttachmentInvalidArchiveError(`ZIP 內含重複路徑：${name}`);
    }
    usedNames.add(name);

    const posixMode = (externalAttributes >>> 16) & 0xffff;
    if ((posixMode & ZIP_FILE_TYPE_MASK) === ZIP_SYMLINK_FILE_TYPE) {
      throw new AttachmentInvalidArchiveError(`ZIP 內含 symlink：${name}`);
    }

    const isDirectory = name.endsWith("/");
    if (!isDirectory) {
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > MAX_ZIP_EXTRACTED_BYTES) {
        throw new AttachmentArchiveTooLargeError();
      }
    }

    entries.push({ name, fflateName, isDirectory, uncompressedSize });
    cursor = nextCursor;
  }

  if (!entries.some((entry) => !entry.isDirectory)) {
    throw new AttachmentInvalidArchiveError("ZIP 內沒有可解壓縮的檔案");
  }

  validateEntryTree(entries);

  return entries;
}

function resolveSafeTargetPath(root: string, entryName: string): string {
  const parts = entryName.split("/").filter(Boolean);
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, ...parts);
  if (
    targetPath !== rootPath &&
    !targetPath.startsWith(`${rootPath}${path.sep}`)
  ) {
    throw new AttachmentInvalidArchiveError(
      `ZIP 內含不安全路徑：${entryName}`,
    );
  }
  return targetPath;
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

async function reserveUniqueDirectory(
  parentDirectory: string,
  desiredName: string,
): Promise<ExtractZipResult & { directoryPath: string }> {
  for (let counter = 0; counter <= MAX_RENAME_COUNTER; counter += 1) {
    const directoryName =
      counter === 0 ? desiredName : `${desiredName}-${counter}`;
    const directoryPath = path.join(parentDirectory, directoryName);
    try {
      await fs.mkdir(directoryPath);
      return { directoryName, directoryPath };
    } catch (error) {
      if (isAlreadyExistsError(error)) continue;
      throw new AttachmentWriteError(
        error instanceof Error ? error : undefined,
      );
    }
  }

  throw new AttachmentWriteError(
    new Error(`無法為 ZIP 解壓目錄找到唯一名稱：${desiredName}`),
  );
}

function unzipArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(bytes);
  } catch {
    throw new AttachmentInvalidArchiveError("ZIP 解壓縮失敗");
  }

  const normalizedEntries = new Map<string, Uint8Array>();
  for (const [rawName, fileBytes] of Object.entries(extracted)) {
    const name = normalizeAndValidateEntryName(rawName);
    if (normalizedEntries.has(name)) {
      throw new AttachmentInvalidArchiveError(`ZIP 內含重複路徑：${name}`);
    }
    normalizedEntries.set(name, fileBytes);
  }
  return normalizedEntries;
}

/**
 * 將 ZIP 安全解壓到 staging session 內的同名資料夾。
 * 解壓前先讀取中央目錄驗證大小與路徑，避免 zip bomb 與路徑穿越。
 */
export async function extractZipAttachment(
  bytes: Uint8Array,
  sessionDirectory: string,
  archiveName: string,
): Promise<ExtractZipResult> {
  const entries = parseZipEntries(bytes);
  const archiveBaseName = archiveName.replace(/\.zip$/i, "").trim();
  const desiredName =
    archiveBaseName === "" || archiveBaseName === "." || archiveBaseName === ".."
      ? "archive"
      : archiveBaseName;
  const reserved = await reserveUniqueDirectory(sessionDirectory, desiredName);

  try {
    const extractedFiles = unzipArchive(bytes);
    for (const entry of entries) {
      const targetPath = resolveSafeTargetPath(
        reserved.directoryPath,
        entry.name,
      );
      if (entry.isDirectory) {
        await fs.mkdir(targetPath, { recursive: true });
        continue;
      }

      const fileBytes = extractedFiles.get(entry.fflateName);
      if (
        fileBytes === undefined ||
        fileBytes.byteLength !== entry.uncompressedSize
      ) {
        throw new AttachmentInvalidArchiveError(
          `ZIP 內檔案大小驗證失敗：${entry.name}`,
        );
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, fileBytes);
    }

    return { directoryName: reserved.directoryName };
  } catch (error) {
    await fs
      .rm(reserved.directoryPath, { recursive: true, force: true })
      .catch(() => void 0);
    if (
      error instanceof AttachmentInvalidArchiveError ||
      error instanceof AttachmentArchiveTooLargeError ||
      error instanceof AttachmentWriteError
    ) {
      throw error;
    }
    throw new AttachmentWriteError(
      error instanceof Error ? error : undefined,
    );
  }
}
