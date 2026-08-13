import { getApiBaseUrl } from "@/services/utils";
import { t } from "@/i18n";
import type {
  PodPackExportRequest,
  PodPackImportResult,
  PodPackPreview,
} from "@/types";

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

function getErrorKey(code: string): string {
  const rules: Array<{ terms: string[]; key: string }> = [
    { terms: ["TOO_LARGE", "SIZE_INVALID"], key: "tooLarge" },
    { terms: ["MANIFEST", "VERSION"], key: "invalidManifest" },
    { terms: ["ARCHIVE", "ZIP", "PATH"], key: "invalidArchive" },
    { terms: ["NOT_FOUND", "MISSING", "REFERENCE"], key: "missingDependency" },
    { terms: ["CREATE_FAILED", "CHANGED_DURING_IMPORT"], key: "atomicFailed" },
  ];
  return rules.find(({ terms }) => terms.some((term) => code.includes(term)))?.key ?? "failed";
}

async function readError(response: FetchResponse): Promise<never> {
  const body = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
  const code = body?.code ?? "POD_PACK_UNKNOWN_ERROR";
  throw new Error(t(`podPack.errors.${getErrorKey(code)}`));
}

export async function exportPodPack(data: PodPackExportRequest): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${getApiBaseUrl()}/api/pod-packs/export`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) return readError(response);
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "pods.podpack";
  return { blob: await response.blob(), filename };
}

function createFileForm(file: File): FormData {
  const form = new FormData();
  form.append("podpack", file);
  return form;
}

export async function previewPodPack(file: File): Promise<PodPackPreview> {
  const response = await fetch(`${getApiBaseUrl()}/api/pod-packs/preview`, {
    method: "POST",
    credentials: "include",
    body: createFileForm(file),
  });
  if (!response.ok) return readError(response);
  const body = (await response.json()) as { preview: PodPackPreview };
  return body.preview;
}

export async function importPodPack(file: File, canvasId: string, target: { x: number; y: number }): Promise<PodPackImportResult> {
  const url = new URL(`${getApiBaseUrl()}/api/pod-packs/import`);
  url.searchParams.set("canvasId", canvasId);
  url.searchParams.set("targetX", String(target.x));
  url.searchParams.set("targetY", String(target.y));
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    body: createFileForm(file),
  });
  if (!response.ok) return readError(response);
  return (await response.json()) as PodPackImportResult;
}
