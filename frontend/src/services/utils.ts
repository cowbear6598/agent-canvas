import {
  parseDevBackendPort,
} from "@/lib/devBackendPort";

/**
 * 生成 UUID
 * 優先使用 crypto.randomUUID（安全上下文），否則使用 crypto.getRandomValues fallback
 */
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const randomNibble =
      (crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) % 16;
    const hexDigit = c === "x" ? randomNibble : (randomNibble & 0x3) | 0x8;
    return hexDigit.toString(16);
  });
}

export function generateRequestId(): string {
  return generateUUID();
}

/**
 * 取得後端 HTTP API base URL
 * dev 模式（port 5173）指向 http://{hostname}:VITE_BACKEND_DEV_PORT；prod 模式用 window.location.origin
 */
export function getApiBaseUrl(): string {
  const VITE_DEFAULT_DEV_PORT = "5173";
  const backendDevPort = parseDevBackendPort(
    import.meta.env.VITE_BACKEND_DEV_PORT,
  );

  const isDev = window.location.port === VITE_DEFAULT_DEV_PORT;
  return isDev
    ? `http://${window.location.hostname}:${backendDevPort}`
    : window.location.origin;
}
