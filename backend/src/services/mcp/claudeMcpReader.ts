/**
 * claudeMcpReader 模組：讀取 ~/.claude.json 內的 mcpServers 設定，回傳已設定的 MCP server 清單。
 *
 * 主要 entry point：
 *   - {@link readClaudeMcpServers}
 *     → 讀取並解析 ~/.claude.json，套用 5 秒 TTL 快取後回傳 McpServerEntry[]。
 *     → 僅讀取 user-scoped（top-level mcpServers）。
 *   - {@link resetClaudeMcpCache}（僅供測試使用）
 *     → 清除快取，強制下次呼叫重新讀檔。
 *
 * 資料來源：
 *   - ~/.claude.json（key: top-level mcpServers，value: { command, args, env }）
 *   - Claude 寫入規則：
 *     - `claude mcp add -s user xxx` → 寫入 top-level mcpServers（user-scoped）
 *     - `claude mcp add xxx`（預設）  → 寫入 projects[cwd].mcpServers（project-scoped）
 *   - 本 reader 只讀 user-scoped（top-level mcpServers），不讀 project-scoped。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../../utils/logger.js";

/**
 * 取得 ~/.claude.json 的讀取路徑。
 * 使用函式（lazy）而非 module 頂層常數，避免 module 初始化時過早呼叫 os.homedir()，
 * 方便測試中 mock os.homedir() 後仍能正確套用。
 */
function getClaudeJsonPath(): string {
  return (
    process.env.CLAUDE_JSON_PATH ?? path.join(os.homedir(), ".claude.json")
  );
}

/** 5 秒 TTL 快取，避免每次請求都重讀磁碟 */
const CACHE_TTL_MS = 5000;

/**
 * Module-level 快取，跨呼叫共用狀態。
 * @internal 工具鏈限制匯出，不應在測試以外的生產程式碼中直接操作。
 *   正常消費請透過 {@link readClaudeMcpServers}；清除快取請透過 {@link resetClaudeMcpCache}。
 */
let cache: { servers: McpServerEntry[]; expiresAt: number } | null = null;

/**
 * 僅供測試使用：清除快取，讓下一次呼叫重新讀檔。
 * @internal 工具鏈限制匯出，不應在生產程式碼中呼叫。
 */
export function resetClaudeMcpCache(): void {
  cache = null;
}

/** 單一 MCP server 的設定結構 */
export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** ~/.claude.json 中 mcpServers 每個 value 的原始格式 */
interface RawMcpServerValue {
  command?: unknown;
  args?: unknown;
  env?: unknown;
}

/** ~/.claude.json 中 projects[path] 的原始格式 */
interface RawProjectEntry {
  mcpServers?: Record<string, RawMcpServerValue>;
}

/** ~/.claude.json 的原始 JSON 結構（只取用到的欄位） */
interface ClaudeJsonFile {
  /** user-scoped MCP servers（`claude mcp add -s user` 寫入此處） */
  mcpServers?: Record<string, RawMcpServerValue>;
  /** project-scoped MCP servers（`claude mcp add` 預設寫入 projects[cwd]） */
  projects?: Record<string, RawProjectEntry>;
}

/**
 * env key 黑名單：拒絕可能被濫用注入動態連結器或修改系統路徑的高風險變數。
 * 以前綴比對（startsWith）涵蓋 LD_PRELOAD、LD_LIBRARY_PATH、DYLD_INSERT_LIBRARIES 等衍生 key。
 */
const ENV_KEY_BLACKLIST_PREFIXES = ["LD_", "DYLD_"];
const ENV_KEY_BLACKLIST_EXACT = new Set(["PATH"]);

/** 判斷 env key 是否屬於黑名單 */
function isBlockedEnvKey(key: string): boolean {
  if (ENV_KEY_BLACKLIST_EXACT.has(key)) return true;
  return ENV_KEY_BLACKLIST_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * 將 mcpServers 物件（Record<name, value>）轉換為 McpServerEntry 陣列。
 * command 必須是非空字串，否則略過該筆。
 * env key 若屬黑名單（LD_*、DYLD_*、PATH 等高風險變數）則自動過濾，其餘保留。
 */
function parseMcpServersRecord(
  record: Record<string, RawMcpServerValue>,
): McpServerEntry[] {
  const result: McpServerEntry[] = [];

  for (const [name, value] of Object.entries(record)) {
    // command 必須是字串，否則略過此筆
    if (typeof value.command !== "string" || value.command.trim() === "") {
      continue;
    }

    // args 必須是字串陣列，否則預設空陣列
    const args: string[] = Array.isArray(value.args)
      ? value.args.filter((a): a is string => typeof a === "string")
      : [];

    // env 必須是 string → string 的物件，否則預設空物件
    // 黑名單 key（LD_*、DYLD_*、PATH 等）一律過濾，防止注入動態連結器或覆蓋系統路徑
    const env: Record<string, string> = {};
    if (
      value.env &&
      typeof value.env === "object" &&
      !Array.isArray(value.env)
    ) {
      for (const [k, v] of Object.entries(
        value.env as Record<string, unknown>,
      )) {
        if (typeof v === "string") {
          if (isBlockedEnvKey(k)) {
            // 黑名單 key：記錄 warn 後略過，不傳入 SDK
            logger.warn(
              "McpServer",
              "Warn",
              `claudeMcpReader：MCP server「${name}」的 env key「${k}」屬高風險黑名單，已略過`,
            );
            continue;
          }
          env[k] = v;
        }
      }
    }

    result.push({ name, command: value.command, args, env });
  }

  return result;
}

/**
 * 讀取 ~/.claude.json 並回傳 user-scoped MCP server 清單。
 *
 * - 讀取 top-level mcpServers（`claude mcp add -s user` 寫入 user-scoped 的位置）
 * - project-scoped（projects[cwd].mcpServers）不在本 reader 讀取範圍內
 * - 5 秒內重複呼叫走快取，不重讀磁碟
 * - 檔案不存在、JSON 解析失敗時回傳空陣列（不拋例外）
 */
export function readClaudeMcpServers(): McpServerEntry[] {
  const now = Date.now();

  // 快取命中直接回傳
  if (cache !== null && now < cache.expiresAt) {
    return cache.servers;
  }

  // 讀取檔案內容
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(getClaudeJsonPath(), "utf-8");
  } catch {
    // 檔案不存在（ENOENT）或無讀取權限時靜默回空
    cache = { servers: [], expiresAt: now + CACHE_TTL_MS };
    return [];
  }

  // 解析 JSON
  let data: ClaudeJsonFile;
  try {
    data = JSON.parse(fileContent) as ClaudeJsonFile;
  } catch {
    // JSON 格式錯誤時靜默回空
    cache = { servers: [], expiresAt: now + CACHE_TTL_MS };
    return [];
  }

  // 讀取 user-scoped MCP servers（top-level mcpServers）
  // `claude mcp add -s user xxx` 寫入此處；project-scoped 寫在 projects[cwd].mcpServers
  const servers: McpServerEntry[] =
    data.mcpServers && typeof data.mcpServers === "object"
      ? parseMcpServersRecord(data.mcpServers)
      : [];

  cache = { servers, expiresAt: now + CACHE_TTL_MS };
  return servers;
}
