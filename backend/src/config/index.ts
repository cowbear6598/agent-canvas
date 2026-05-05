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
  /**
   * 暫存檔案根目錄（拖曳上傳的附件先落地於此，6h 後由 tmpCleanupService 清除）
   *
   * staging 與正式附件目錄都直接掛在 tmpRoot 下，6h TTL 由 tmpCleanupService 一併清理。
   *
   * 正式附件目錄結構：<tmpRoot>/<chatMessageId>/
   *   - promote 階段把 staging 子目錄 rename 過去
   */
  tmpRoot: string;
  /**
   * 上傳暫存區根目錄（`tmpRoot/staging`）
   *
   * 角色分工：
   *   - stagingRoot：附件上傳後先落地於此，尚未與任何 chatMessage 綁定
   *   - tmpRoot：正式附件目錄，每則訊息送出後才從 staging promote 過來
   *
   * staging 子目錄結構：<stagingRoot>/<uploadSessionId>/<sanitized filename>
   *   - uploadSessionId：單次上傳工作階段的唯一識別碼
   *   - sanitized filename：經過安全處理的原始檔案名稱
   */
  stagingRoot: string;
  /** 根據 nodeEnv 與 ALLOWED_ORIGINS 動態決定來源是否允許 */
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

  const localOriginPattern =
    /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;
  const ngrokFreePattern = /^https?:\/\/[\w-]+\.ngrok-free\.dev$/;
  const ngrokProPattern = /^https?:\/\/[\w-]+\.ngrok\.io$/;

  function isLocalOrigin(origin: string): boolean {
    return localOriginPattern.test(origin);
  }

  function isNgrokOrigin(origin: string): boolean {
    return ngrokFreePattern.test(origin) || ngrokProPattern.test(origin);
  }

  function isAllowedByWhitelist(
    origin: string,
    allowedList: string[] | undefined,
  ): boolean {
    return allowedList ? allowedList.includes(origin) : false;
  }

  // ALLOW_NGROK：非生產環境預設開啟（維持開發便利性）；生產環境預設關閉
  const allowNgrok =
    nodeEnv !== "production"
      ? process.env.ALLOW_NGROK !== "0"
      : process.env.ALLOW_NGROK === "1";

  const corsOrigin = (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }

    if (nodeEnv === "production") {
      // 生產環境：只允許本地 pattern 以及 ALLOWED_ORIGINS 白名單中的精確匹配
      return (
        isLocalOrigin(origin) || isAllowedByWhitelist(origin, allowedOrigins)
      );
    }

    // 非生產環境：允許本地、白名單，以及可選的 ngrok pattern
    return (
      isLocalOrigin(origin) ||
      isAllowedByWhitelist(origin, allowedOrigins) ||
      (allowNgrok && isNgrokOrigin(origin))
    );
  };

  const dataRoot = path.join(os.homedir(), "Documents", "AgentCanvas");

  const appDataRoot = dataRoot;
  const canvasRoot = path.join(dataRoot, "canvas");
  const repositoriesRoot = path.join(dataRoot, "repositories");
  const agentsPath = path.join(dataRoot, "agents");
  const commandsPath = path.join(dataRoot, "commands");
  // 暫存目錄：不在此建立，寫檔時由 attachmentWriter 以 mkdir -p 建立
  const tmpRoot = path.join(dataRoot, "tmp");
  // staging 目錄掛在 tmpRoot 下，與正式附件目錄共用同一層；由 tmpCleanupService 6h 一併清理
  const stagingRoot = path.join(tmpRoot, "staging");

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error("PORT 必須是 1 到 65535 之間的有效數字");
  }

  return {
    port,
    nodeEnv,
    appDataRoot,
    canvasRoot,
    repositoriesRoot,
    tmpRoot,
    stagingRoot,
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
