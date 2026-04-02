import { config } from "../config";
import type { Command } from "../types";
import { validatePodId, validateCommandId } from "../utils/pathValidator.js";
import {
  copyResourceFile,
  deleteResourceDirFromPath,
  findValidatedSrcPath,
} from "./shared/fileResourceHelpers.js";
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

/** 清除 Command list 快取，強制下次 list() 重新讀取磁碟 */
function invalidateCache(): void {
  cachedCommands = null;
  cacheTimestamp = 0;
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

  async copyCommandToPod(
    commandId: string,
    podId: string,
    podWorkspacePath: string,
  ): Promise<void> {
    if (!validatePodId(podId)) {
      throw new Error("無效的 Pod ID 格式");
    }

    const srcPath = await findValidatedSrcPath(
      baseService,
      commandId,
      validateCommandId,
      "Command ID",
    );
    await copyResourceFile(
      srcPath,
      podWorkspacePath,
      "commands",
      `${commandId}.md`,
    );
  },

  async copyCommandToRepository(
    commandId: string,
    repositoryPath: string,
  ): Promise<void> {
    const srcPath = await findValidatedSrcPath(
      baseService,
      commandId,
      validateCommandId,
      "Command ID",
    );
    await copyResourceFile(
      srcPath,
      repositoryPath,
      "commands",
      `${commandId}.md`,
    );
  },

  async deleteCommandFromPath(basePath: string): Promise<void> {
    await deleteResourceDirFromPath(basePath, "commands");
  },
};
