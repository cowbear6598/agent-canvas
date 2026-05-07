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
