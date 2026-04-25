import { promises as fs } from "fs";
import path from "path";
import { Group, GroupType } from "../types";
import { logger } from "../utils/logger.js";
import { config } from "../config";
import { sanitizePathSegment } from "../utils/pathValidator.js";
import { directoryExists } from "./shared/fileResourceHelpers.js";
import { fsOperation } from "../utils/operationHelpers.js";

class GroupStore {
  async create(name: string, type: GroupType): Promise<Group> {
    const safeName = sanitizePathSegment(name);
    const dirPath = path.join(this.getBasePath(type), safeName);

    await fs.mkdir(dirPath, { recursive: true });
    logger.log(
      "Note",
      "Create",
      `[GroupStore] 建立 Group 資料夾: ${safeName} (${type})`,
    );

    return {
      id: safeName,
      name: safeName,
      type,
    };
  }

  async exists(name: string, type: GroupType): Promise<boolean> {
    const safeName = sanitizePathSegment(name);
    const dirPath = path.join(this.getBasePath(type), safeName);
    return directoryExists(dirPath);
  }

  async list(type: GroupType): Promise<Group[]> {
    const basePath = this.getBasePath(type);

    const result = await fsOperation(async () => {
      await fs.mkdir(basePath, { recursive: true });
      const entries = await fs.readdir(basePath, { withFileTypes: true });

      const groups: Group[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          groups.push({
            id: entry.name,
            name: entry.name,
            type,
          });
        }
      }

      return groups;
    }, `[GroupStore] 列出 Groups 失敗 (${type})`);

    return result.success ? (result.data ?? []) : [];
  }

  async delete(name: string, type: GroupType): Promise<boolean> {
    const safeName = sanitizePathSegment(name);
    const dirPath = path.join(this.getBasePath(type), safeName);

    const result = await fsOperation(async () => {
      await fs.rmdir(dirPath);
      logger.log("Note", "Delete", `[GroupStore] 刪除 Group: ${safeName}`);
    }, `[GroupStore] 刪除 Group 失敗: ${safeName}`);

    return result.success;
  }

  async hasItems(name: string, type: GroupType): Promise<boolean> {
    const safeName = sanitizePathSegment(name);
    const dirPath = path.join(this.getBasePath(type), safeName);

    const result = await fsOperation(async () => {
      const entries = await fs.readdir(dirPath);
      return entries.filter((file) => file.endsWith(".md")).length > 0;
    }, `[GroupStore] 讀取 Group 內容失敗: ${safeName}`);

    return result.success ? (result.data ?? false) : false;
  }

  private getBasePath(type: GroupType): string {
    switch (type) {
      case "command":
        return config.commandsPath;
      case "subagent":
        return config.agentsPath;
      default:
        throw new Error(`未知的 GroupType: ${type}`);
    }
  }
}

export const groupStore = new GroupStore();
