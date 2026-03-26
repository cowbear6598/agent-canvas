/**
 * ANSI 顏色碼
 */
const ANSI_COLORS = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  GRAY: "\x1b[90m",
} as const;

/**
 * 日誌分類
 */
export type LogCategory =
  | "Startup"
  | "Pod"
  | "Chat"
  | "Skill"
  | "Command"
  | "Repository"
  | "SubAgent"
  | "Workflow"
  | "Connection"
  | "Paste"
  | "Note"
  | "OutputStyle"
  | "Git"
  | "Schedule"
  | "Canvas"
  | "Workspace"
  | "WebSocket"
  | "McpServer"
  | "Slack"
  | "Telegram"
  | "Jira"
  | "Integration"
  | "Run"
  | "Backup"
  | "Encryption"
  | "Shutdown";

/**
 * Category 顏色映射表
 */
const CATEGORY_COLORS: Record<LogCategory, string> = {
  Startup: ANSI_COLORS.GRAY,
  Connection: ANSI_COLORS.GRAY,
  WebSocket: ANSI_COLORS.GRAY,
  Pod: ANSI_COLORS.BLUE,
  Workflow: ANSI_COLORS.BLUE,
  SubAgent: ANSI_COLORS.BLUE,
  Repository: ANSI_COLORS.MAGENTA,
  Workspace: ANSI_COLORS.MAGENTA,
  Canvas: ANSI_COLORS.MAGENTA,
  Skill: ANSI_COLORS.GREEN,
  Command: ANSI_COLORS.GREEN,
  Chat: ANSI_COLORS.GREEN,
  McpServer: ANSI_COLORS.GREEN,
  Git: ANSI_COLORS.YELLOW,
  Note: ANSI_COLORS.YELLOW,
  Paste: ANSI_COLORS.YELLOW,
  OutputStyle: ANSI_COLORS.YELLOW,
  Schedule: ANSI_COLORS.YELLOW,
  Slack: ANSI_COLORS.BLUE,
  Telegram: ANSI_COLORS.BLUE,
  Jira: ANSI_COLORS.BLUE,
  Integration: ANSI_COLORS.BLUE,
  Run: ANSI_COLORS.GREEN,
  Backup: ANSI_COLORS.YELLOW,
  Encryption: ANSI_COLORS.MAGENTA,
  Shutdown: ANSI_COLORS.GRAY,
};

/**
 * 日誌動作
 */
export type LogAction =
  | "Create"
  | "Delete"
  | "Update"
  | "List"
  | "Bind"
  | "Unbind"
  | "Load"
  | "Save"
  | "Error"
  | "Warn"
  | "Complete"
  | "Rename"
  | "Switch"
  | "Check"
  | "Reorder"
  | "Abort"
  | "Pipeline"
  | "Init"
  | "Migrate";

/**
 * 格式化 Category 為帶有顏色的字串
 * @param category 日誌分類
 * @returns 帶有顏色的 [Category] 字串
 */
function formatCategory(category: LogCategory): string {
  const color = CATEGORY_COLORS[category];
  return `${color}[${category}]${ANSI_COLORS.RESET}`;
}

/**
 * 格式化錯誤訊息為完整紅色字串
 * @param category 日誌分類
 * @param action 日誌動作
 * @param message 日誌訊息
 * @returns 完整紅色的日誌訊息字串
 */
function formatErrorMessage(
  category: LogCategory,
  action: LogAction,
  message: string,
): string {
  return `${ANSI_COLORS.RED}[${category}] [${action}] ${message}${ANSI_COLORS.RESET}`;
}

/**
 * 清理字串中的敏感資訊（Token、密碼等）
 * @param str 要清理的字串
 * @returns 清理後的字串
 */
function sanitizeSensitiveInfo(str: string): string {
  // 隱藏敏感的認證令牌，避免日誌洩漏
  return str
    .replace(/https:\/\/[^@\s]+@github\.com/g, "https://***@github.com")
    .replace(
      /https:\/\/oauth2:[^@\s]+@[^\s/]+/g,
      "https://oauth2:***@[REDACTED]",
    )
    .replace(/https:\/\/[^@\s]+@([^\s/]+)/g, "https://***@$1")
    .replace(/ghp_[a-zA-Z0-9]{36}/g, "ghp_***")
    .replace(/glpat-[a-zA-Z0-9_-]{20}/g, "glpat-***")
    .replace(/xox[bpas]-[a-zA-Z0-9-]+/g, "xox***")
    .replace(/xapp-[a-zA-Z0-9-]+/g, "xapp***")
    .replace(/\d{8,12}:[A-Za-z0-9_-]{35}/g, "[BOT_TOKEN_REDACTED]");
}

/**
 * 清理錯誤物件中的敏感資訊
 * @param error 錯誤物件
 * @returns 清理後的錯誤描述字串
 */
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const sanitizedMessage = sanitizeSensitiveInfo(error.message);
    const sanitizedStack = error.stack
      ? sanitizeSensitiveInfo(error.stack)
      : "";
    return sanitizedStack || sanitizedMessage;
  }

  const errorStr = String(error);
  return sanitizeSensitiveInfo(errorStr);
}

/**
 * Logger 類別
 */
class Logger {
  /**
   * 記錄一般日誌
   * @param category 日誌分類
   * @param action 日誌動作
   * @param message 日誌訊息
   */
  log(category: LogCategory, action: LogAction, message: string): void {
    const coloredCategory = formatCategory(category);
    console.log(`${coloredCategory} [${action}] ${message}`);
  }

  /**
   * 記錄警告日誌
   * @param category 日誌分類
   * @param action 日誌動作
   * @param message 日誌訊息
   */
  warn(category: LogCategory, action: LogAction, message: string): void {
    const coloredCategory = formatCategory(category);
    console.warn(
      `${ANSI_COLORS.YELLOW}${coloredCategory} [${action}] ${message}${ANSI_COLORS.RESET}`,
    );
  }

  /**
   * 記錄錯誤日誌
   * @param category 日誌分類
   * @param action 日誌動作
   * @param message 日誌訊息
   * @param error 錯誤物件（選填）
   */
  error(
    category: LogCategory,
    action: LogAction,
    message: string,
    error?: unknown,
  ): void {
    const errorMessage = formatErrorMessage(category, action, message);
    console.error(errorMessage);
    if (error) {
      const sanitizedError = sanitizeError(error);
      console.error(`${ANSI_COLORS.RED}${sanitizedError}${ANSI_COLORS.RESET}`);
    }
  }
}

/**
 * Logger singleton instance
 */
export const logger = new Logger();
