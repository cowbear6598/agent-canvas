/**
 * codexMcpReader 模組：讀取 ~/.codex/config.toml 的 mcp_servers 區塊，
 * 回傳各 MCP server 的名稱與類型清單。
 *
 * 主要 entry point：
 *   - {@link readCodexMcpServers}
 *     → 套用 5 秒 TTL 快取後回傳 { name, type }[]
 *   - {@link resetCodexMcpCache}（僅供測試使用）
 *     → 清除快取，強制下次呼叫重新讀檔
 *
 * TOML 結構範例：
 *   [mcp_servers.figma]
 *   url = "https://mcp.figma.com/mcp"
 *
 *   [mcp_servers.context7]
 *   command = "npx"
 *   args = ["-y", "@upstash/context7-mcp"]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../../utils/logger.js";

/**
 * 取得 Codex config.toml 的讀取路徑。
 * 使用函式（lazy）而非 module 頂層常數，避免 module 初始化時過早呼叫 os.homedir()，
 * 方便測試中 mock os.homedir() 後仍能正確套用。
 * 與 claudeMcpReader 的 getClaudeJsonPath() 保持一致模式。
 */
function getCodexConfigPath(): string {
  return (
    process.env.CODEX_CONFIG_PATH ??
    path.join(os.homedir(), ".codex", "config.toml")
  );
}

/** 5 秒 TTL 快取，避免每次請求都重讀磁碟 */
const CACHE_TTL_MS = 5000;
let cachedServers: CodexMcpServer[] | null = null;
let cacheExpiresAt = 0;

/** 回傳型別：MCP server 名稱與連線類型 */
export interface CodexMcpServer {
  name: string;
  type: "stdio" | "http" | "sse";
}

/** 僅供測試使用：清除快取，讓下一次呼叫重新讀檔 */
export function resetCodexMcpCache(): void {
  cachedServers = null;
  cacheExpiresAt = 0;
}

/** TOML 解析後 mcp_servers 單一 entry 的型別（鬆散，只取需要的欄位） */
interface RawMcpServerEntry {
  command?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

/**
 * 讀取 ~/.codex/config.toml 並回傳 mcp_servers 清單。
 * - 檔案不存在、TOML 解析失敗、mcp_servers 區塊不存在時回傳空陣列。
 * - 5 秒內重複呼叫直接走快取。
 */
export function readCodexMcpServers(): CodexMcpServer[] {
  const now = Date.now();

  // 快取命中
  if (cachedServers !== null && now < cacheExpiresAt) {
    return cachedServers;
  }

  const result = parseCodexConfig();
  cachedServers = result;
  cacheExpiresAt = now + CACHE_TTL_MS;

  return result;
}

/** 讀檔並解析 TOML，取出 mcp_servers 清單 */
function parseCodexConfig(): CodexMcpServer[] {
  // 讀取檔案內容
  let raw: string;
  try {
    raw = fs.readFileSync(getCodexConfigPath(), "utf-8");
  } catch (error) {
    const isNotFound =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!isNotFound) {
      // 非「檔案不存在」的錯誤才記錄 warn
      logger.warn(
        "McpServer",
        "Warn",
        `讀取 codex config.toml 失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [];
  }

  // 解析 TOML（Bun 原生 Bun.TOML.parse）
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(raw);
  } catch (error) {
    logger.warn(
      "McpServer",
      "Warn",
      `codex config.toml TOML 解析失敗：${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  // 確認解析結果為物件
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const config = parsed as Record<string, unknown>;

  // 取出 mcp_servers 區塊
  if (
    !config.mcp_servers ||
    typeof config.mcp_servers !== "object" ||
    Array.isArray(config.mcp_servers)
  ) {
    return [];
  }

  const mcpServers = config.mcp_servers as Record<string, unknown>;
  const result: CodexMcpServer[] = [];

  /** 安全字元集：首字必須是字母、數字或底線；後續可含連字號，防止 -- 開頭的 CLI 旗標注入 */
  const SAFE_SERVER_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/;

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (!serverConfig || typeof serverConfig !== "object") continue;

    // 驗證 server name 字元集，含 =、空格、換行、-- 等特殊字元者略過
    if (!SAFE_SERVER_NAME_RE.test(serverName)) {
      logger.warn(
        "McpServer",
        "Warn",
        `codex MCP server name 含不合法字元，已略過（name 長度：${serverName.length}）`,
      );
      continue;
    }

    const entry = serverConfig as RawMcpServerEntry;

    // 含 command 欄位視為 stdio；含 url 欄位視為 http；兩者皆無則跳過
    if (typeof entry.command === "string") {
      result.push({ name: serverName, type: "stdio" });
    } else if (typeof entry.url === "string") {
      result.push({ name: serverName, type: "http" });
    }
    // 兩者皆無：靜默略過
  }

  return result;
}
