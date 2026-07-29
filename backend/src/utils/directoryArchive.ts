import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";

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
  return content.replace(
    /(https?:\/\/)[^/\s@]+@/gi,
    (_match, protocol: string) => protocol,
  );
}

function setUnixAttributes(
  entry: ZipDeflate | ZipPassThrough,
  mode: number,
  mtime: Date,
): void {
  entry.os = 3;
  entry.attrs = (mode & 0xffff) << 16;
  entry.mtime = mtime;
}

async function addDirectoryToZip(
  zip: Zip,
  rootDir: string,
  currentDir: string,
  waitForDrain: () => Promise<void>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirent of entries) {
    const fullPath = path.join(currentDir, dirent.name);
    const archivePath = toZipPath(path.relative(rootDir, fullPath));
    const stats = await lstat(fullPath);

    if (stats.isDirectory()) {
      const entry = new ZipPassThrough(`${archivePath}/`);
      setUnixAttributes(entry, stats.mode, stats.mtime);
      zip.add(entry);
      entry.push(new Uint8Array(), true);
      await waitForDrain();
      await addDirectoryToZip(zip, rootDir, fullPath, waitForDrain);
      continue;
    }

    if (stats.isSymbolicLink()) {
      const entry = new ZipPassThrough(archivePath);
      setUnixAttributes(entry, stats.mode, stats.mtime);
      zip.add(entry);
      entry.push(strToU8(await readlink(fullPath)), true);
      await waitForDrain();
      continue;
    }

    if (!stats.isFile()) {
      throw new Error(`無法備份不支援的檔案類型：${fullPath}`);
    }

    const entry = new ZipDeflate(archivePath, { level: 6 });
    setUnixAttributes(entry, stats.mode, stats.mtime);
    zip.add(entry);

    if (isGitMetadataWithRemoteUrl(archivePath)) {
      const content = removeUrlCredentials(
        await readFile(fullPath, "utf-8"),
      );
      entry.push(strToU8(content), true);
      await waitForDrain();
      continue;
    }

    for await (const chunk of createReadStream(fullPath)) {
      entry.push(new Uint8Array(chunk), false);
      await waitForDrain();
    }
    entry.push(new Uint8Array(), true);
    await waitForDrain();
  }
}

export async function createDirectoryArchive(
  sourceDir: string,
  destinationPath: string,
): Promise<boolean> {
  try {
    if (!(await lstat(sourceDir)).isDirectory()) {
      throw new Error(`備份來源不是目錄：${sourceDir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  const output = createWriteStream(destinationPath);
  let drainPromise: Promise<void> | null = null;

  const outputDone = new Promise<void>((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });

  const zip = new Zip((error, data, final) => {
    if (error) {
      output.destroy(error);
      return;
    }
    if (final) {
      output.end(data);
    } else if (!output.write(data)) {
      drainPromise = once(output, "drain").then(() => undefined);
    }
  });

  const waitForDrain = async (): Promise<void> => {
    if (drainPromise) {
      await drainPromise;
      drainPromise = null;
    }
  };

  try {
    await addDirectoryToZip(zip, sourceDir, sourceDir, waitForDrain);
    zip.end();
    await outputDone;
    return true;
  } catch (error) {
    zip.terminate();
    output.destroy();
    await outputDone.catch(() => undefined);
    await rm(destinationPath, { force: true });
    throw error;
  }
}
