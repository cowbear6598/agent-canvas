import os from "os";
import path from "path";

export const APP_DATA_ROOT_ENV_NAME = "AGENT_CANVAS_APP_DATA_DIR";
export const CANVAS_DB_FILE_NAME = "canvas.db";

interface ResolveAppDataPathsOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export interface AppDataPaths {
  appDataRoot: string;
  canvasDbPath: string;
}

export function getDefaultAppDataRoot(homeDir: string = os.homedir()): string {
  return path.join(homeDir, "Documents", "AgentCanvas");
}

export function resolveAppDataRoot(
  options: ResolveAppDataPathsOptions = {},
): string {
  const env = options.env ?? process.env;
  const override = env[APP_DATA_ROOT_ENV_NAME]?.trim();

  if (override) {
    return override;
  }

  return getDefaultAppDataRoot(options.homeDir);
}

export function resolveAppDataPaths(
  options: ResolveAppDataPathsOptions = {},
): AppDataPaths {
  const appDataRoot = resolveAppDataRoot(options);

  return {
    appDataRoot,
    canvasDbPath: path.join(appDataRoot, CANVAS_DB_FILE_NAME),
  };
}
