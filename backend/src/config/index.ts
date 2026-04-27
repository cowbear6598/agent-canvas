import os from "os";
import path from "path";

function validateGitLabUrl(url: string | undefined): void {
  if (!url) {
    return;
  }

  if (!url.startsWith("https://")) {
    throw new Error("GITLAB_URL 必須使用 HTTPS 協議");
  }

  if (!URL.canParse(url)) {
    throw new Error("GITLAB_URL 格式不正確");
  }

  const urlObj = new URL(url);
  if (!urlObj.hostname || urlObj.hostname.includes(" ")) {
    throw new Error("GITLAB_URL 包含無效的主機名稱");
  }
}

interface Config {
  port: number;
  nodeEnv: string;
  appDataRoot: string;
  canvasRoot: string;
  repositoriesRoot: string;
  /** CORS 來源驗證函式。生產環境請設定 ALLOWED_ORIGINS 環境變數（逗號分隔）以指定允許的精確來源 */
  corsOrigin: (origin: string | undefined) => boolean;
  allowedOrigins?: string[];
  githubToken?: string;
  gitlabToken?: string;
  gitlabUrl?: string;
  agentsPath: string;
  commandsPath: string;
  getCanvasPath(canvasName: string): string;
  getCanvasDataPath(canvasName: string): string;
}

function loadConfig(): Config {
  const port = parseInt(process.env.PORT || "3001", 10);
  const nodeEnv = process.env.NODE_ENV || "development";
  const githubToken = process.env.GITHUB_TOKEN;
  const gitlabToken = process.env.GITLAB_TOKEN;
  const gitlabUrl = process.env.GITLAB_URL?.replace(/\/$/, "");

  validateGitLabUrl(gitlabUrl);

  const allowedOriginsRaw = process.env.ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : undefined;

  const corsOrigin = (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }

    const localOriginPattern =
      /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;

    if (nodeEnv === "production") {
      // 生產環境：只允許本地 pattern 以及 ALLOWED_ORIGINS 白名單中的精確匹配，不允許 ngrok wildcard
      const isLocal = localOriginPattern.test(origin);
      const isWhitelisted = allowedOrigins
        ? allowedOrigins.includes(origin)
        : false;
      return isLocal || isWhitelisted;
    }

    // 非生產環境：允許本地、ngrok pattern 以及白名單
    // 開發便利性設計：允許所有 ngrok pattern。staging / production 應改設 ALLOWED_ORIGINS 環境變數以收斂
    const ngrokFreePattern = /^https?:\/\/[\w-]+\.ngrok-free\.dev$/;
    const ngrokProPattern = /^https?:\/\/[\w-]+\.ngrok\.io$/;

    const isLocal = localOriginPattern.test(origin);
    const isNgrok =
      ngrokFreePattern.test(origin) || ngrokProPattern.test(origin);
    const isWhitelisted = allowedOrigins
      ? allowedOrigins.includes(origin)
      : false;

    return isLocal || isNgrok || isWhitelisted;
  };

  const dataRoot = path.join(os.homedir(), "Documents", "AgentCanvas");

  const appDataRoot = dataRoot;
  const canvasRoot = path.join(dataRoot, "canvas");
  const repositoriesRoot = path.join(dataRoot, "repositories");
  const agentsPath = path.join(dataRoot, "agents");
  const commandsPath = path.join(dataRoot, "commands");

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error("PORT 必須是 1 到 65535 之間的有效數字");
  }

  return {
    port,
    nodeEnv,
    appDataRoot,
    canvasRoot,
    repositoriesRoot,
    corsOrigin,
    allowedOrigins,
    githubToken,
    gitlabToken,
    gitlabUrl,
    agentsPath,
    commandsPath,
    getCanvasPath(canvasName: string): string {
      const canvasPath = path.join(canvasRoot, canvasName);
      const resolvedPath = path.resolve(canvasPath);
      const resolvedRoot = path.resolve(canvasRoot);

      if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
        throw new Error("無效的 canvas 名稱：偵測到路徑穿越");
      }

      return canvasPath;
    },
    getCanvasDataPath(canvasName: string): string {
      const canvasPath = path.join(canvasRoot, canvasName, "data");
      const resolvedPath = path.resolve(canvasPath);
      const resolvedRoot = path.resolve(canvasRoot);

      if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
        throw new Error("無效的 canvas 名稱：偵測到路徑穿越");
      }

      return canvasPath;
    },
  };
}

export const config = loadConfig();
