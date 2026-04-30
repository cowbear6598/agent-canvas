import { promises as fs } from "fs";
import * as fsPath from "path";
import { Result, ok, err } from "../../types";
import { config } from "../../config";
import { logger } from "../../utils/logger.js";

class WorkspaceService {
  private validatePath(workspacePath: string): boolean {
    const resolvedPath = fsPath.resolve(workspacePath);
    const resolvedRoot = fsPath.resolve(config.canvasRoot);
    return resolvedPath.startsWith(resolvedRoot + fsPath.sep);
  }

  async createWorkspace(workspacePath: string): Promise<Result<string>> {
    if (!this.validatePath(workspacePath)) {
      logger.error("Workspace", "Error", `路徑驗證失敗：${workspacePath}`);
      return err("無效的工作區路徑");
    }
    try {
      await fs.mkdir(workspacePath, { recursive: true });
      return ok(workspacePath);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("Workspace", "Error", `建立工作區失敗：${message}`);
      return err("建立工作區失敗");
    }
  }

  async deleteWorkspace(workspacePath: string): Promise<Result<void>> {
    if (!this.validatePath(workspacePath)) {
      logger.error("Workspace", "Error", `路徑驗證失敗：${workspacePath}`);
      return err("無效的工作區路徑");
    }
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("Workspace", "Error", `刪除工作區失敗：${message}`);
      return err(`刪除工作區失敗：${message}`);
    }
  }
}

export const workspaceService = new WorkspaceService();
