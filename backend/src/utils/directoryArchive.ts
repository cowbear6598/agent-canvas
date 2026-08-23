import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, readlink, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";

function toZipPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isGitMetadataWithRemoteUrl(archivePath: string): boolean {
  const parts = archivePath.split("/");
  const gitIndex = parts.lastIndexOf(".git");
  if (gitIndex === -1) return false;
  const gitPath = parts.slice(gitIndex + 1);
  return (
    gitPath.at(-1) === "config" ||
    gitPath.includes("logs") ||
    gitPath.at(-1) === "FETCH_HEAD"
  );
}

function removeUrlCredentials(content: string): string {
  return content.replace(/(https?:\/\/)[^/\s@]+@/gi, "$1");
}

export interface DirectoryArchiveOptions {
  /** 回傳 false 可排除項目；目錄被排除時不再往下走訪。 */
  include?: (
    relativePath: string,
    kind: "file" | "directory" | "symlink",
  ) => boolean | Promise<boolean>;
  /** Git 設定、log 與 FETCH_HEAD 預設會移除 URL credential。 */
  sanitizeGitCredentials?: boolean;
}

async function addDirectoryToZip(
  zip: ZipFile,
  rootDir: string,
  currentDir: string,
  options: DirectoryArchiveOptions,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirent of entries) {
    const fullPath = path.join(currentDir, dirent.name);
    const archivePath = toZipPath(path.relative(rootDir, fullPath));
    const stats = await lstat(fullPath);
    const kind = stats.isDirectory()
      ? "directory"
      : stats.isSymbolicLink()
        ? "symlink"
        : "file";
    if (options.include && !(await options.include(archivePath, kind))) continue;

    if (kind === "directory") {
      zip.addEmptyDirectory(`${archivePath}/`, {
        mode: stats.mode,
        mtime: stats.mtime,
      });
      await addDirectoryToZip(zip, rootDir, fullPath, options);
      continue;
    }

    if (kind === "symlink") {
      zip.addBuffer(Buffer.from(await readlink(fullPath)), archivePath, {
        mode: stats.mode,
        mtime: stats.mtime,
        compress: false,
      });
      continue;
    }

    if (kind !== "file" || !stats.isFile()) {
      throw new Error(`無法備份不支援的檔案類型：${fullPath}`);
    }

    if (
      options.sanitizeGitCredentials !== false &&
      isGitMetadataWithRemoteUrl(archivePath)
    ) {
      const content = removeUrlCredentials(await readFile(fullPath, "utf-8"));
      zip.addReadStream(Readable.from(Buffer.from(content)), archivePath, {
        size: Buffer.byteLength(content),
        mode: stats.mode,
        mtime: stats.mtime,
        compress: true,
      });
      continue;
    }

    zip.addFile(fullPath, archivePath, {
      mode: stats.mode,
      mtime: stats.mtime,
      compress: true,
    });
  }
}

export async function createDirectoryArchive(
  sourceDir: string,
  destinationPath: string,
  options: DirectoryArchiveOptions = {},
): Promise<boolean> {
  try {
    if (!(await lstat(sourceDir)).isDirectory()) {
      throw new Error(`備份來源不是目錄：${sourceDir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  const zip = new ZipFile();
  const output = createWriteStream(destinationPath);

  try {
    await addDirectoryToZip(zip, sourceDir, sourceDir, options);
    zip.end({ forceZip64Format: true, comment: "" });
    await pipeline(zip.outputStream, output);
    return true;
  } catch (error) {
    output.destroy();
    await rm(destinationPath, { force: true });
    throw error;
  }
}
