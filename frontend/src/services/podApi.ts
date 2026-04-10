import { getApiBaseUrl } from "@/services/utils";

async function readStreamWithProgress(
  body: ReadableStream<Uint8Array>,
  onProgress?: (bytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>[]> {
  const blobParts: Uint8Array<ArrayBuffer>[] = [];
  let downloadedBytes = 0;
  const reader = body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // 複製一份確保底層是純 ArrayBuffer（排除 SharedArrayBuffer）
    const copied = new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    ) as Uint8Array<ArrayBuffer>;
    blobParts.push(copied);
    downloadedBytes += value.byteLength;
    onProgress?.(downloadedBytes);
  }

  return blobParts;
}

function triggerBrowserDownload(
  blobParts: Uint8Array<ArrayBuffer>[],
  filename: string,
): void {
  const blob = new Blob(blobParts, { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function downloadPodDirectory(
  canvasId: string,
  podId: string,
  onProgress?: (downloadedBytes: number) => void,
): Promise<void> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(
    `${baseUrl}/api/canvas/${canvasId}/pods/${podId}/download`,
  );

  if (!response.ok) {
    let errorMessage = `下載失敗（HTTP ${response.status}）`;
    try {
      const body = await response.json();
      if (body?.error) {
        errorMessage = body.error;
      }
    } catch {
      // 無法解析回應內容，使用預設錯誤訊息
    }
    throw new Error(errorMessage);
  }

  const disposition = response.headers.get("Content-Disposition");
  let filename = "download.zip";
  if (disposition) {
    const match = disposition.match(
      /filename[^;=\n]*=(?:(['"])(.+?)\1|([^;\n]*))/i,
    );
    if (match) {
      filename = (match[2] ?? match[3] ?? filename).trim();
    }
  }

  const blobParts: Uint8Array<ArrayBuffer>[] = response.body
    ? await readStreamWithProgress(response.body, onProgress)
    : [];

  triggerBrowserDownload(blobParts, filename);
}
