import { getApiBaseUrl } from "@/services/utils";
import { t } from "@/i18n";
import type {
  PodPackExportRequest,
  PodPackImportResult,
  PodPackPreview,
} from "@/types";

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const ERROR_KEY_RULES = [
  { terms: ["DISK_FULL"], key: "diskFull" },
  { terms: ["TOO_LARGE", "SIZE_INVALID"], key: "tooLarge" },
  { terms: ["MANIFEST", "VERSION"], key: "invalidManifest" },
  { terms: ["ARCHIVE", "ZIP", "PATH", "SYMLINK", "COMPRESSION"], key: "invalidArchive" },
  { terms: ["NOT_FOUND", "MISSING", "REFERENCE"], key: "missingDependency" },
  { terms: ["CREATE_FAILED", "CHANGED_DURING_IMPORT", "CONFLICT"], key: "atomicFailed" },
] as const;

export interface PodPackTransfer {
  id: string;
  filename: string;
  size: number;
  createdAt: string;
  kind: "export" | "import";
}

export interface TransferOptions {
  transferId?: string;
  signal?: globalThis.AbortSignal;
  onProgress?: (percent: number | null) => void;
}

function getErrorKey(code: string): string {
  return ERROR_KEY_RULES.find(({ terms }) =>
    terms.some((term) => code.includes(term)))?.key ?? "failed";
}

async function readError(response: FetchResponse): Promise<never> {
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code ?? "POD_PACK_UNKNOWN_ERROR";
  throw new Error(t(`podPack.errors.${getErrorKey(code)}`));
}

function transferHeaders(options: TransferOptions, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Pod-Pack-Transfer-Id": options.transferId ?? crypto.randomUUID(),
    ...extra,
  };
}

export async function exportPodPack(
  data: PodPackExportRequest,
  options: TransferOptions = {},
): Promise<PodPackTransfer> {
  options.onProgress?.(null);
  const response = await fetch(`${getApiBaseUrl()}/api/pod-packs/export`, {
    method: "POST",
    credentials: "include",
    headers: transferHeaders(options, { "Content-Type": "application/json" }),
    body: JSON.stringify(data),
    signal: options.signal,
  });
  if (!response.ok) return readError(response);
  options.onProgress?.(100);
  return ((await response.json()) as { transfer: PodPackTransfer }).transfer;
}

export function downloadPodPack(transfer: PodPackTransfer): void {
  const link = document.createElement("a");
  link.href = `${getApiBaseUrl()}/api/pod-packs/transfers/${encodeURIComponent(transfer.id)}/download`;
  link.download = transfer.filename;
  link.click();
}

export async function previewPodPack(
  file: File,
  options: TransferOptions = {},
): Promise<{ transferId: string; preview: PodPackPreview }> {
  options.onProgress?.(0);
  const response = await fetch(`${getApiBaseUrl()}/api/pod-packs/preview`, {
    method: "POST",
    credentials: "include",
    headers: transferHeaders(options, {
      "Content-Type": "application/vnd.agent-canvas.podpack+zip",
      "X-Pod-Pack-Filename": encodeURIComponent(file.name),
    }),
    body: file,
    signal: options.signal,
  });
  if (!response.ok) return readError(response);
  options.onProgress?.(100);
  return (await response.json()) as { transferId: string; preview: PodPackPreview };
}

export async function importPodPack(
  transferId: string,
  canvasId: string,
  target: { x: number; y: number },
  options: Pick<TransferOptions, "signal" | "onProgress"> = {},
): Promise<PodPackImportResult> {
  options.onProgress?.(null);
  const response = await fetch(`${getApiBaseUrl()}/api/pod-packs/import`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transferId, canvasId, targetX: target.x, targetY: target.y }),
    signal: options.signal,
  });
  if (!response.ok) return readError(response);
  options.onProgress?.(100);
  return (await response.json()) as PodPackImportResult;
}

export async function cancelPodPackTransfer(transferId: string): Promise<void> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/pod-packs/transfers/${encodeURIComponent(transferId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok && response.status !== 404) await readError(response);
}
