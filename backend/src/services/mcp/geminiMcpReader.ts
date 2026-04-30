/**
 * geminiMcpReader 模組：讀取 ~/.gemini/settings.json 內的 mcpServers 設定，
 * 回傳各 MCP server 的名稱與連線類型清單。
 *
 * 主要 entry point：
 *   - {@link readGeminiMcpServers}
 *     → 套用 5 秒 TTL 快取後回傳 GeminiMcpServer[]
 *   - {@link resetGeminiMcpCache}（僅供測試使用）
 *     → 清除快取，強制下次呼叫重新讀檔
 *
 * JSON 結構範例（root.mcpServers，非 nested projects）：
 *   {
 *     "mcpServers": {
 *       "figma": {
 *         "httpUrl": "https://mcp.figma.com/mcp"
 *       },
 *       "context7": {
 *         "command": "npx",
 *         "args": ["-y", "@upstash/context7-mcp"]
 *       },
 *       "my-sse-server": {
 *         "url": "https://example.com/sse"
 *       }
 *     }
 *   }
 *
 * type 推導規則：
 *   - command 為非空字串 → "stdio"
 *   - 否則 httpUrl 為非空字串 → "http"
 *   - 否則 url 為非空字串 → "sse"
 *   - 三者皆無 → 略過該筆
 */
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../../utils/logger.js";

/**
 * 取得 ~/.gemini/settings.json 的讀取路徑。
 * 使用函式（lazy）而非 module 頂層常數，避免 module 初始化時過早呼叫 os.homedir()，
 * 方便測試中透過 process.env.GEMINI_SETTINGS_PATH 切換 fixture 路徑。
 */
function getGeminiSettingsPath(): string {
  return (
    process.env.GEMINI_SETTINGS_PATH ??
    path.join(os.homedir(), ".gemini", "settings.json")
  );
}

/** 5 秒 TTL 快取，避免每次請求都重讀磁碟 */
const CACHE_TTL_MS = 5000;

/**
 * Module-level 快取，跨呼叫共用狀態。
 * 使用與 claudeMcpReader 相同的物件型快取結構（{ servers, expiresAt }）。
 */
let cache: { servers: GeminiMcpServer[]; expiresAt: number } | null = null;

/**
 * 僅供測試使用：清除快取，讓下一次呼叫重新讀檔。
 * @internal 不應在生產程式碼中呼叫。
 */
export function resetGeminiMcpCache(): void {
  cache = null;
}

/** 回傳型別：MCP server 名稱與連線類型 */
export interface GeminiMcpServer {
  name: string;
  type: "stdio" | "http" | "sse";
}

/** settings.json 中 mcpServers 單一 entry 的鬆散型別（只取需要的欄位） */
interface RawGeminiMcpEntry {
  command?: unknown;
  httpUrl?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

/** settings.json 的原始 JSON 結構（只取用到的欄位） */
interface GeminiSettingsFile {
  mcpServers?: Record<string, unknown>;
}

/**
 * MCP server name 安全字元集：
 * - 首字元：英文字母、數字、底線（_）或點（.）
 * - 後續字元：英文字母、數字、底線（_）、點（.）或連字號（-）
 * 對齊 mcpSchemas.ts 中的 MCP_SERVER_NAME_PATTERN（module-private，無法直接匯入）。
 */
const SAFE_SERVER_NAME_RE = /^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/;

/**
 * 將 mcpServers 物件（Record<name, value>）轉換為 GeminiMcpServer 陣列。
 * - command 為非空字串 → "stdio"
 * - 否則 httpUrl 為非空字串 → "http"
 * - 否則 url 為非空字串 → "sse"
 * - 三者皆無 → 略過該筆
 * - name 不符合安全字元集 → logger.warn 後略過（僅記錄 name 長度，不洩漏完整名稱）
 */
function parseGeminiMcpServersRecord(
  record: Record<string, unknown>,
): GeminiMcpServer[] {
  const result: GeminiMcpServer[] = [];

  for (const [name, value] of Object.entries(record)) {
    // 驗證 server name 字元集，含特殊字元者略過
    if (!SAFE_SERVER_NAME_RE.test(name)) {
      logger.warn(
        "McpServer",
        "Warn",
        `gemini MCP server name 含不合法字元，已略過（name 長度：${name.length}）`,
      );
      continue;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const entry = value as RawGeminiMcpEntry;

    // type 推導：command → stdio；httpUrl → http；url → sse；三者皆無略過
    if (typeof entry.command === "string" && entry.command.trim() !== "") {
      result.push({ name, type: "stdio" });
    } else if (
      typeof entry.httpUrl === "string" &&
      entry.httpUrl.trim() !== ""
    ) {
      result.push({ name, type: "http" });
    } else if (typeof entry.url === "string" && entry.url.trim() !== "") {
      result.push({ name, type: "sse" });
    }
    // 三者皆無：靜默略過
  }

  return result;
}

/**
 * 讀取 ~/.gemini/settings.json 並回傳 MCP server 清單。
 *
 * - 讀取 root.mcpServers（注意：與 claudeMcpReader 不同，Gemini 是 root-level，
 *   不是 nested 在 projects[homedir] 之下）
 * - 5 秒內重複呼叫走快取，不重讀磁碟
 * - 檔案不存在時回傳空陣列（不拋例外）
 * - JSON 解析失敗時回傳空陣列並 logger.warn 一次（不拋例外）
 */
export function readGeminiMcpServers(): GeminiMcpServer[] {
  const now = Date.now();

  // 快取命中直接回傳
  if (cache !== null && now < cache.expiresAt) {
    return cache.servers;
  }

  // 讀取檔案內容
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(getGeminiSettingsPath(), "utf-8");
  } catch {
    // 檔案不存在（ENOENT）或無讀取權限時靜默回空
    cache = { servers: [], expiresAt: now + CACHE_TTL_MS };
    return [];
  }

  // 解析 JSON
  let data: GeminiSettingsFile;
  try {
    data = JSON.parse(fileContent) as GeminiSettingsFile;
  } catch {
    // JSON 格式錯誤時記錄 warn 後回空
    logger.warn(
      "McpServer",
      "Warn",
      "geminiMcpReader：~/.gemini/settings.json JSON 解析失敗，回傳空清單",
    );
    cache = { servers: [], expiresAt: now + CACHE_TTL_MS };
    return [];
  }

  // 讀取 root-level mcpServers（Gemini 與 Claude 的關鍵差異：Gemini 不走 projects[homedir]）
  const servers: GeminiMcpServer[] =
    data.mcpServers &&
    typeof data.mcpServers === "object" &&
    !Array.isArray(data.mcpServers)
      ? parseGeminiMcpServersRecord(data.mcpServers)
      : [];

  cache = { servers, expiresAt: now + CACHE_TTL_MS };
  return servers;
}
