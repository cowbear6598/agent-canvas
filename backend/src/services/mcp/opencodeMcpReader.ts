/**
 * opencodeMcpReader 模組：讀取 ~/.config/opencode/opencode.json 內的 mcp 區塊，
 * 回傳各 MCP server 的名稱與連線類型清單。
 *
 * 主要 entry point：
 *   - {@link readOpencodeMcpServers}
 *     → 套用 5 秒 TTL 快取後回傳 OpencodeMcpServer[]
 *   - {@link resetOpencodeMcpCache}（僅供測試使用）
 *     → 清除快取，強制下次呼叫重新讀檔
 *
 * JSON 結構範例（~/.config/opencode/opencode.json）：
 *   {
 *     "mcp": {
 *       "context7": {
 *         "type": "local",
 *         "command": "npx",
 *         "args": ["-y", "@upstash/context7-mcp"]
 *       },
 *       "figma": {
 *         "type": "remote",
 *         "url": "https://mcp.figma.com/mcp"
 *       },
 *       "my-sse-server": {
 *         "type": "remote",
 *         "url": "sse://example.com/sse"
 *       }
 *     }
 *   }
 *
 * type 推導規則：
 *   - entry.type === "local" → "stdio"
 *   - entry.type === "remote" 且 url 以 "http://" 或 "https://" 開頭 → "http"
 *   - entry.type === "remote" 且 url 為其他 scheme（如 "sse://"）→ "sse"
 *   - 無法判斷時靜默略過該筆
 *
 * self-healing：
 *   - 檔案不存在 / 無 mcp 區塊 / JSON parse 失敗時靜默回空陣列、不向上拋錯
 */
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../../utils/logger.js";

/**
 * OpencodeConfigReader interface：
 * 抽象出檔案讀取行為，方便測試時注入 mock。
 */
export interface OpencodeConfigReader {
  readFile(filePath: string): string | null;
}

/**
 * 預設的 fs-based 實作（生產環境使用）。
 */
class FsOpencodeConfigReader implements OpencodeConfigReader {
  readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      const isNotFound =
        error instanceof Error && "code" in error && error.code === "ENOENT";
      if (!isNotFound) {
        logger.warn(
          "McpServer",
          "Warn",
          `讀取 opencode.json 失敗：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }
}

/** 預設 reader singleton（可在測試中被替換） */
let _configReader: OpencodeConfigReader = new FsOpencodeConfigReader();

/**
 * 僅供測試使用：替換 config reader 實作。
 * @internal 不應在生產程式碼中呼叫。
 */
export function setOpencodeConfigReader(reader: OpencodeConfigReader): void {
  _configReader = reader;
}

/**
 * 取得 ~/.config/opencode/opencode.json 的讀取路徑。
 * 使用函式（lazy）而非 module 頂層常數，避免 module 初始化時過早呼叫 os.homedir()，
 * 方便測試中透過 process.env.OPENCODE_CONFIG_PATH 切換 fixture 路徑。
 */
function getOpencodeConfigPath(): string {
  return (
    process.env.OPENCODE_CONFIG_PATH ??
    path.join(os.homedir(), ".config", "opencode", "opencode.json")
  );
}

/** 5 秒 TTL 快取，避免每次請求都重讀磁碟 */
const CACHE_TTL_MS = 5000;

/**
 * Module-level 快取，跨呼叫共用狀態。
 * 使用與 geminiMcpReader 相同的物件型快取結構（{ servers, expiresAt }）。
 */
let cache: { servers: OpencodeMcpServer[]; expiresAt: number } | null = null;

/**
 * 僅供測試使用：清除快取，讓下一次呼叫重新讀檔。
 * @internal 不應在生產程式碼中呼叫。
 */
export function resetOpencodeMcpCache(): void {
  cache = null;
}

/** 回傳型別：MCP server 名稱與連線類型 */
export interface OpencodeMcpServer {
  name: string;
  type: "stdio" | "http" | "sse";
}

/** opencode.json 中 mcp 單一 entry 的鬆散型別（只取需要的欄位） */
interface RawOpencodeMcpEntry {
  type?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

/** opencode.json 的原始 JSON 結構（只取用到的欄位） */
interface OpencodeJsonFile {
  mcp?: Record<string, unknown>;
}

/**
 * 依 entry 的 type / url 欄位推導 MCP server 連線類型。
 * - entry.type === "local" → "stdio"
 * - entry.type === "remote" 且 url 以 "http://" 或 "https://" 開頭 → "http"
 * - entry.type === "remote" 且 url 為其他 scheme → "sse"
 * - 無法判斷 → null（呼叫端略過該筆）
 */
function inferOpencodeMcpServerType(
  entry: object,
): "stdio" | "http" | "sse" | null {
  const e = entry as RawOpencodeMcpEntry;

  if (e.type === "local") {
    return "stdio";
  }

  if (e.type === "remote") {
    if (typeof e.url === "string") {
      const url = e.url.trim();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return "http";
      }
      return "sse";
    }
    // remote 但無 url，靜默略過
    return null;
  }

  return null;
}

/**
 * 將 mcp 物件（Record<name, value>）轉換為 OpencodeMcpServer 陣列。
 * - entry.type === "local" → "stdio"
 * - entry.type === "remote" + http/https url → "http"
 * - entry.type === "remote" + 其他 scheme → "sse"
 * - 無法判斷者略過
 */
function parseOpencodeMcpRecord(
  record: Record<string, unknown>,
): OpencodeMcpServer[] {
  const result: OpencodeMcpServer[] = [];

  for (const [name, value] of Object.entries(record)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const type = inferOpencodeMcpServerType(value);
    if (type !== null) {
      result.push({ name, type });
    }
  }

  return result;
}

/**
 * 讀取 ~/.config/opencode/opencode.json 並回傳 MCP server 清單。
 *
 * - 讀取 root-level mcp 區塊
 * - 5 秒內重複呼叫走快取，不重讀磁碟
 * - 檔案不存在、JSON 解析失敗、無 mcp 區塊時回傳空陣列（不拋例外）
 */
export function readOpencodeMcpServers(): OpencodeMcpServer[] {
  const now = Date.now();

  // 快取命中直接回傳
  if (cache !== null && now < cache.expiresAt) {
    return cache.servers;
  }

  // 讀取檔案內容
  const fileContent = _configReader.readFile(getOpencodeConfigPath());
  if (fileContent === null) {
    // 檔案不存在或讀取失敗，靜默回空
    cache = { servers: [], expiresAt: now + CACHE_TTL_MS };
    return [];
  }

  // 解析 JSON
  let data: OpencodeJsonFile;
  try {
    data = JSON.parse(fileContent) as OpencodeJsonFile;
  } catch {
    // JSON 格式錯誤時記錄 warn 後回空
    logger.warn(
      "McpServer",
      "Warn",
      "opencodeMcpReader：~/.config/opencode/opencode.json JSON 解析失敗，回傳空清單",
    );
    cache = { servers: [], expiresAt: now + CACHE_TTL_MS };
    return [];
  }

  // 讀取 root-level mcp 區塊
  const servers: OpencodeMcpServer[] =
    data.mcp && typeof data.mcp === "object" && !Array.isArray(data.mcp)
      ? parseOpencodeMcpRecord(data.mcp)
      : [];

  cache = { servers, expiresAt: now + CACHE_TTL_MS };
  return servers;
}
