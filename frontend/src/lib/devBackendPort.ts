export const DEFAULT_BACKEND_DEV_PORT = 3001;

export function parseDevBackendPort(rawValue: string | undefined): number {
  const parsed = Number(rawValue ?? String(DEFAULT_BACKEND_DEV_PORT));
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return DEFAULT_BACKEND_DEV_PORT;
}
