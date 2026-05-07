import os from "os";
import path from "path";

/**
 * 計算 SDK 內建 sandbox 的 filesystem.allowWrite 清單。
 *
 * 包含：
 * - cwd（workspacePath）與 sandbox tmp 目錄
 * - 系統暫存（/tmp，macOS 額外加 /private/tmp）
 * - MCP runtime cache（npx / uvx / bunx 等 stdio MCP 子程序寫入路徑）
 *
 * 不含 ~/.claude / ~/.claude.json — 由 SDK 內建 sandbox 自行處理 Claude 自己的
 * 認證 / 設定檔（這正是從自寫 launcher 遷移過來的核心動機，舊 launcher 把 ~/ 整個
 * ro-bind 反而擋掉 atomic write）。
 */
export function buildClaudeSandboxAllowWrite(
  workspacePath: string,
  sandboxHomePath?: string,
): string[] {
  const home = os.homedir();
  const isDarwin = process.platform === "darwin";

  const dataRoot = isDarwin
    ? path.join(home, "Library", "Application Support")
    : (process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"));

  return [
    workspacePath,
    ...(sandboxHomePath ? [sandboxHomePath] : []),
    // 系統暫存
    "/tmp",
    ...(isDarwin ? ["/private/tmp"] : []),
    // MCP runtime cache：stdio MCP subprocess 寫入路徑
    path.join(home, ".npm"), // npx / Node.js MCP（context7、playwright 等）
    path.join(home, ".cache", "uv"), // uvx Python MCP cache（mcp-server-time 等）
    path.join(dataRoot, "uv"), // uvx Python interpreter / installed tools
    path.join(home, ".bun", "install", "cache"), // bunx MCP
  ];
}

/**
 * 計算 SDK 內建 sandbox 的 network 設定。
 *
 * 網路預設全開（allowedDomains: ["*"]），因為 Claude 在 Bash 工具裡會打各種第三方
 * API（GitHub、Sentry、Slack、internal services...），維護白名單是反 pattern。
 *
 * 若特殊環境（例如 prod）要收緊，設環境變數 CLAUDE_SANDBOX_DENIED_DOMAINS
 * （逗號分隔，支援 SDK 的 wildcard syntax，例如 "*.example.com"）即可逐項擋。
 *
 * 注意：sandbox 內部的網路限制邏輯與 permission 系統並非 1:1 對應 — Bash 工具跑的
 * curl / python 走 OS socket，會被 sandbox 的 HTTP proxy 攔截，需在此層放行。
 */
export function buildClaudeSandboxNetwork(): {
  allowedDomains: string[];
  deniedDomains?: string[];
} {
  const denied = (process.env.CLAUDE_SANDBOX_DENIED_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    allowedDomains: ["*"],
    ...(denied.length > 0 ? { deniedDomains: denied } : {}),
  };
}

/**
 * 計算 SDK 內建 sandbox 的 filesystem.denyWrite 清單。
 *
 * SDK 預設 allow $HOME 整片可寫（讓 Claude 自己寫 ~/.claude.json），所以要靠
 * denyWrite 把敏感的 credential 與 shell 設定檔擋掉，避免 Claude 在 Bash 工具中
 * 誤動或被 prompt injection 操控去寫這些檔案。
 *
 * 不擋整個 $HOME，避免破壞 SDK 內部對 ~/.claude.json 的寫入流程。
 */
export function buildClaudeSandboxDenyWrite(): string[] {
  const home = os.homedir();
  return [
    // Credential / 認證目錄
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
    path.join(home, ".config", "gh"), // GitHub CLI
    // Credential 檔案（含 token）
    path.join(home, ".netrc"),
    path.join(home, ".npmrc"),
    path.join(home, ".docker", "config.json"),
    // Shell 設定（避免被注入 alias / 環境變數）
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".bash_login"),
    path.join(home, ".bash_logout"),
    path.join(home, ".zshrc"),
    path.join(home, ".zprofile"),
    path.join(home, ".zshenv"),
    path.join(home, ".zlogin"),
    path.join(home, ".zlogout"),
    path.join(home, ".profile"),
  ];
}
