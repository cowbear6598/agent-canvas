import { useCanvasStore } from "@/stores/canvasStore";

/**
 * 帶 Canvas 密碼驗證的 fetch 工具函式。
 * 若該 Canvas 已有驗證過的密碼，會在請求 headers 加上 X-Canvas-Password。
 * 其餘行為與原生 fetch 完全相同。
 */
export async function fetchWithCanvasPassword(
  url: string,
  canvasId: string,
  options?: RequestInit,
): Promise<Response> {
  const canvasStore = useCanvasStore();
  const password = canvasStore.getCanvasPassword(canvasId);

  if (!password) {
    return fetch(url, options);
  }

  const existingHeaders = new Headers(options?.headers);
  existingHeaders.set("X-Canvas-Password", password);

  return fetch(url, {
    ...options,
    headers: existingHeaders,
  });
}
