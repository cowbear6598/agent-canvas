import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile as YazlZipFile } from "yazl";
import * as yauzl from "yauzl";
import { checkDiskSpace } from "../services/diskSpace.js";

const MAX_ARCHIVE_ENTRIES = 200_000;
const MAX_COMPRESSION_RATIO = 10_000;
const POSIX_TYPE_MASK = 0xf000;
const POSIX_SYMLINK = 0xa000;

export interface ZipDiskEntry {
  archivePath: string;
  filePath: string;
}

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      {
        autoClose: false,
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zip) => (error || !zip ? reject(error) : resolve(zip)),
    );
  });
}

function safeArchivePath(name: string): boolean {
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  if (!normalized || normalized.startsWith("/") || normalized.includes("\\")) {
    return false;
  }
  return normalized.split("/").every((part) => part !== "" && part !== "..");
}

function isSymlink(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & POSIX_TYPE_MASK) === POSIX_SYMLINK;
}

async function assertParentsAreDirectories(
  destination: string,
  target: string,
): Promise<void> {
  let current = path.dirname(target);
  const root = path.resolve(destination);
  while (current !== root) {
    const stat = await fs.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error("POD_PACK_SYMLINK_PARENT_INVALID");
    current = path.dirname(current);
  }
}

async function streamToSmallBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of stream) {
    const chunk = Buffer.from(raw as Uint8Array);
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("POD_PACK_SYMLINK_TARGET_INVALID");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function createStreamingZip(
  destinationPath: string,
  manifest: Uint8Array,
  entries: ZipDiskEntry[],
): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const zip = new YazlZipFile();
  const output = createWriteStream(destinationPath);
  zip.addBuffer(Buffer.from(manifest), "manifest.json", { compress: true });
  for (const entry of entries) {
    if (!safeArchivePath(entry.archivePath)) throw new Error("POD_PACK_PATH_INVALID");
    zip.addFile(entry.filePath, entry.archivePath, { compress: false });
  }
  zip.end({ forceZip64Format: true, comment: "" });
  try {
    await pipeline(zip.outputStream, output);
  } catch (error) {
    await fs.rm(destinationPath, { force: true });
    throw error;
  }
}

export interface ExtractZipOptions {
  allowSymlinks?: boolean;
  allowEmpty?: boolean;
  allowedPath?: (archivePath: string) => boolean;
}

/**
 * 先完整檢查 central directory 與可用空間，再逐檔串流解壓。
 * yauzl 原生支援 ZIP64，且 validateEntrySizes 會驗證實際解壓大小。
 */
export async function extractStreamingZip(
  archivePath: string,
  destination: string,
  options: ExtractZipOptions = {},
): Promise<string[]> {
  const zip = await openZip(archivePath);
  try {
    if ((!options.allowEmpty && zip.entryCount === 0) || zip.entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new Error("POD_PACK_ENTRY_COUNT_INVALID");
    }
    const entries: yauzl.Entry[] = [];
    const names = new Set<string>();
    let requiredBytes = 0;
    for await (const entry of zip.eachEntry()) {
      if (!safeArchivePath(entry.fileName) || names.has(entry.fileName)) {
        throw new Error("POD_PACK_PATH_INVALID");
      }
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error("POD_PACK_ZIP_ENTRY_UNSUPPORTED");
      }
      if (options.allowedPath && !options.allowedPath(entry.fileName)) {
        throw new Error(`POD_PACK_PATH_INVALID:${entry.fileName}`);
      }
      if (isSymlink(entry) && !options.allowSymlinks) {
        throw new Error("POD_PACK_ZIP_ENTRY_UNSUPPORTED");
      }
      if (
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO
      ) {
        throw new Error("POD_PACK_COMPRESSION_RATIO_INVALID");
      }
      names.add(entry.fileName);
      requiredBytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(requiredBytes)) {
        throw new Error("POD_PACK_UNCOMPRESSED_SIZE_INVALID");
      }
      entries.push(entry);
    }

    await fs.mkdir(destination, { recursive: true });
    const disk = await checkDiskSpace(destination, requiredBytes);
    if (!disk.ok) throw new Error("POD_PACK_DISK_FULL");

    const root = path.resolve(destination);
    for (const entry of entries) {
      const name = entry.fileName.endsWith("/")
        ? entry.fileName.slice(0, -1)
        : entry.fileName;
      const target = path.resolve(destination, ...name.split("/"));
      if (!target.startsWith(`${root}${path.sep}`)) {
        throw new Error("POD_PACK_PATH_INVALID");
      }
      await assertParentsAreDirectories(destination, target);
      if (entry.fileName.endsWith("/")) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }

      await fs.mkdir(path.dirname(target), { recursive: true });
      const stream = await zip.openReadStreamPromise(entry);
      if (isSymlink(entry)) {
        const linkTarget = (await streamToSmallBuffer(stream, 4096)).toString();
        const resolvedLink = path.resolve(path.dirname(target), linkTarget);
        if (path.isAbsolute(linkTarget) || !resolvedLink.startsWith(`${root}${path.sep}`)) {
          throw new Error("POD_PACK_SYMLINK_TARGET_INVALID");
        }
        await fs.symlink(linkTarget, target);
        continue;
      }
      await pipeline(stream, createWriteStream(target, { flags: "wx" }));
      const mode = (entry.externalFileAttributes >>> 16) & 0o777;
      if (mode) await fs.chmod(target, mode);
    }
    return [...names];
  } finally {
    zip.close();
  }
}
