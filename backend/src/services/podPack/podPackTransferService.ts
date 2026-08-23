import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../../config/index.js";
import { checkDiskSpace } from "../diskSpace.js";
import {
  createPodPackArchiveFile,
  importPreparedPodPack,
  preparePodPackArchive,
  type PodPackImportResult,
} from "./podPackService.js";
import type { PodPackImportOptions } from "../../schemas/podPackSchemas.js";

const TRANSFER_ID_PATTERN = /^[0-9a-f-]{36}$/;

interface TransferMetadata {
  id: string;
  filename: string;
  size: number;
  createdAt: string;
  kind: "export" | "import";
}

export interface PodPackTransfer extends TransferMetadata {
  preview?: Awaited<ReturnType<typeof preparePodPackArchive>>["preview"];
}

function transferRoot(): string {
  return path.join(config.tmpRoot, "pod-packs");
}

function transferDirectory(id: string): string {
  if (!TRANSFER_ID_PATTERN.test(id)) throw new Error("POD_PACK_TRANSFER_ID_INVALID");
  return path.join(transferRoot(), id);
}

function archivePath(id: string): string {
  return path.join(transferDirectory(id), "source.podpack");
}

async function writeMetadata(directory: string, metadata: TransferMetadata): Promise<void> {
  await fs.writeFile(path.join(directory, "transfer.json"), JSON.stringify(metadata));
}

async function readMetadata(id: string): Promise<TransferMetadata> {
  let raw: unknown;
  try { raw = JSON.parse(await fs.readFile(path.join(transferDirectory(id), "transfer.json"), "utf-8")); }
  catch { throw new Error("POD_PACK_TRANSFER_NOT_FOUND"); }
  if (!raw || typeof raw !== "object" || (raw as TransferMetadata).id !== id) {
    throw new Error("POD_PACK_TRANSFER_INVALID");
  }
  return raw as TransferMetadata;
}

function requestedTransferId(value?: string): string {
  if (!value) return randomUUID();
  if (!TRANSFER_ID_PATTERN.test(value)) throw new Error("POD_PACK_TRANSFER_ID_INVALID");
  return value;
}

async function createTransferWorkspace(
  requestedId?: string,
): Promise<{ id: string; directory: string; sourcePath: string }> {
  const id = requestedTransferId(requestedId);
  const directory = transferDirectory(id);
  await fs.mkdir(directory);
  return { id, directory, sourcePath: archivePath(id) };
}

export async function createExportTransfer(rawInput: unknown, requestedId?: string): Promise<PodPackTransfer> {
  await fs.mkdir(transferRoot(), { recursive: true });
  const { id, directory, sourcePath } = await createTransferWorkspace(requestedId);
  try {
    await createPodPackArchiveFile(rawInput, sourcePath);
    const stat = await fs.stat(sourcePath);
    const metadata: TransferMetadata = {
      id,
      filename: `pods-${new Date().toISOString().slice(0, 10)}.podpack`,
      size: stat.size,
      createdAt: new Date().toISOString(),
      kind: "export",
    };
    await writeMetadata(directory, metadata);
    return metadata;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function stageImportTransfer(req: Request, filename: string, requestedId?: string): Promise<PodPackTransfer> {
  if (!req.body) throw new Error("POD_PACK_FILE_REQUIRED");
  await fs.mkdir(transferRoot(), { recursive: true });
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 0) {
    const disk = await checkDiskSpace(transferRoot(), contentLength);
    if (!disk.ok) throw new Error("POD_PACK_DISK_FULL");
  }

  const { id, directory, sourcePath } = await createTransferWorkspace(requestedId);
  try {
    const source = Readable.fromWeb(req.body as import("node:stream/web").ReadableStream);
    await pipeline(source, createWriteStream(sourcePath), { signal: req.signal });
    const stat = await fs.stat(sourcePath);
    if (stat.size === 0) throw new Error("POD_PACK_SIZE_INVALID");
    const prepared = await preparePodPackArchive(sourcePath, directory);
    const metadata: TransferMetadata = {
      id,
      filename: path.basename(filename || "import.podpack"),
      size: stat.size,
      createdAt: new Date().toISOString(),
      kind: "import",
    };
    await writeMetadata(directory, metadata);
    return { ...metadata, preview: prepared.preview };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function getTransferDownload(id: string): Promise<{ metadata: TransferMetadata; file: Blob }> {
  const metadata = await readMetadata(id);
  if (metadata.kind !== "export") throw new Error("POD_PACK_TRANSFER_NOT_DOWNLOADABLE");
  const file = Bun.file(archivePath(id));
  if (!(await file.exists())) throw new Error("POD_PACK_TRANSFER_NOT_FOUND");
  return { metadata, file };
}

export async function importTransfer(
  id: string,
  options: PodPackImportOptions,
): Promise<PodPackImportResult> {
  const metadata = await readMetadata(id);
  if (metadata.kind !== "import") throw new Error("POD_PACK_TRANSFER_NOT_IMPORTABLE");
  const directory = transferDirectory(id);
  const prepared = await preparePodPackArchive(archivePath(id), directory);
  const result = await importPreparedPodPack(prepared, options);
  await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  return result;
}

export async function cancelTransfer(id: string): Promise<void> {
  const directory = transferDirectory(id);
  const exists = await fs.lstat(directory).then(() => true).catch(() => false);
  if (!exists) throw new Error("POD_PACK_TRANSFER_NOT_FOUND");
  await fs.rm(directory, { recursive: true, force: true });
}
