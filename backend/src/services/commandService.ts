import fs from "fs/promises";
import { config } from "../config";
import type { Command } from "../types";
import { deleteResourceDirFromPath } from "./shared/fileResourceHelpers.js";
import { createMarkdownResourceService } from "./shared/createMarkdownResourceService.js";

const baseService = createMarkdownResourceService<Command>({
  resourceDir: config.commandsPath,
  resourceName: "Command",
  createItem: (id, name, _content, groupId) => ({ id, name, groupId }),
  updateItem: (id, _content) => ({ id, name: id, groupId: null }),
  subDir: "commands",
});

// 快取策略：將 list() 結果存放於記憶體，TTL 為 30 秒。
// 每次 create / update / delete / setGroupId 成功後皆清除快取，
// 確保下次 list() 能取得最新資料。
const CACHE_TTL_MS = 30_000;
let cachedCommands: Command[] | null = null;
let cacheTimestamp = 0;

// read() 快取策略：mtime-based，搭配 LRU 上限（256 條目）。
// 以 mtime 作為「內容是否變動」的權威依據，確保外部修改檔案也能被感知。
// 上限設計避免無限成長（例如大量一次性 Command 讀取後快取累積）。
const COMMAND_CONTENT_CACHE_MAX = 256;
const cachedCommandContents: Map<
  string,
  { content: string; mtimeMs: number; filePath: string }
> = new Map();

/** 將 id 加入或更新 cachedCommandContents，並在超過上限時刪除最舊的條目（LRU eviction） */
function setCachedCommandContent(
  id: string,
  value: { content: string; mtimeMs: number; filePath: string },
): void {
  // 若已存在，先刪除後重新插入，使其成為 Map 末尾（最新存取）
  cachedCommandContents.delete(id);
  cachedCommandContents.set(id, value);
  // 超過上限時刪除最舊（Map iteration 順序即插入順序）
  if (cachedCommandContents.size > COMMAND_CONTENT_CACHE_MAX) {
    const oldestKey = cachedCommandContents.keys().next().value;
    if (oldestKey !== undefined) {
      cachedCommandContents.delete(oldestKey);
    }
  }
}

/** 清除 Command list 快取與 read 內容快取，強制下次重新讀取磁碟 */
function invalidateCache(): void {
  cachedCommands = null;
  cacheTimestamp = 0;
  cachedCommandContents.clear();
}

export const commandService = {
  ...baseService,

  /** 回傳所有 Command，若快取未逾期則直接回傳記憶體結果 */
  async list(): Promise<Command[]> {
    const now = Date.now();
    if (cachedCommands !== null && now - cacheTimestamp < CACHE_TTL_MS) {
      return cachedCommands;
    }

    const result = await baseService.list();
    cachedCommands = result;
    cacheTimestamp = Date.now();
    return result;
  },

  async create(name: string, content: string): Promise<Command> {
    const result = await baseService.create(name, content);
    invalidateCache();
    return result;
  },

  async update(id: string, content: string): Promise<Command> {
    const result = await baseService.update(id, content);
    invalidateCache();
    return result;
  },

  async delete(id: string): Promise<void> {
    await baseService.delete(id);
    invalidateCache();
  },

  async setGroupId(id: string, groupId: string | null): Promise<void> {
    await baseService.setGroupId(id, groupId);
    invalidateCache();
  },

  /**
   * 讀取指定 Command 的檔案內容。
   * 使用 mtime-based 快取：只有在檔案修改時間改變時才重新讀取磁碟。
   * id 不合法或檔案不存在時回傳 null，不丟錯。
   */
  async read(id: string): Promise<string | null> {
    // 防禦性 guard：空字串或 falsy id 直接回傳 null，避免不必要的 I/O
    if (!id) return null;

    // 1. 透過 findFilePath 取得實際檔案路徑
    const filePath = await baseService.findFilePath(id);
    if (!filePath) {
      // 找不到檔案時清除此 id 的快取
      cachedCommandContents.delete(id);
      return null;
    }

    // 2. 取得目前的 mtime
    let mtimeMs: number;
    try {
      const stat = await fs.stat(filePath);
      mtimeMs = stat.mtimeMs;
    } catch {
      // stat 失敗代表檔案已消失，清除快取並回傳 null
      cachedCommandContents.delete(id);
      return null;
    }

    // 3. 若快取存在且 filePath 與 mtimeMs 皆相同，直接回傳快取內容
    const cached = cachedCommandContents.get(id);
    if (cached && cached.filePath === filePath && cached.mtimeMs === mtimeMs) {
      return cached.content;
    }

    // 4. 快取不存在或已過期，重新讀取並更新快取
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      // 讀取失敗（例如競態下檔案被刪除），清除快取並回傳 null
      cachedCommandContents.delete(id);
      return null;
    }

    setCachedCommandContent(id, { content, mtimeMs, filePath });
    return content;
  },

  async deleteCommandFromPath(basePath: string): Promise<void> {
    await deleteResourceDirFromPath(basePath, "commands");
  },
};
