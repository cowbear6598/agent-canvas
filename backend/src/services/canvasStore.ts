import { v4 as uuidv4 } from "uuid";
import type { Canvas } from "../types";
import { Result, ok, err } from "../types";
import { config } from "../config";
import { logger } from "../utils/logger.js";
import { getDb } from "../database/index.js";
import { getStmts } from "../database/stmtsHelper.js";
import { createI18nError } from "../utils/i18nError.js";

interface CanvasRow {
  id: string;
  name: string;
  sort_index: number;
  password_hash: string | null;
}

function rowToCanvas(row: CanvasRow): Canvas {
  return {
    id: row.id,
    name: row.name,
    sortIndex: row.sort_index,
    passwordHash: row.password_hash,
  };
}

class CanvasStore {
  private activeCanvasMap: Map<string, string> = new Map();

  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  private static readonly WINDOWS_RESERVED_NAMES = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ];

  private validateCanvasName(name: string): Result<void> {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return err("Canvas 名稱不能為空");
    }

    if (trimmedName.length > 50) {
      return err("Canvas 名稱不能超過 50 個字元");
    }

    if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmedName)) {
      return err("Canvas 名稱只能包含英文字母、數字、底線、連字號和空格");
    }

    const upperName = trimmedName.toUpperCase();
    if (CanvasStore.WINDOWS_RESERVED_NAMES.includes(upperName)) {
      return err("Canvas 名稱為系統保留名稱");
    }

    const existing = this.stmts.canvas.selectByName.get(trimmedName);
    if (existing) {
      return err(
        createI18nError("errors.canvasNameExists", { name: trimmedName }),
      );
    }

    return ok(undefined);
  }

  async create(name: string): Promise<Result<Canvas>> {
    const validationResult = this.validateCanvasName(name);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    const id = uuidv4();
    const trimmedName = name.trim();

    const maxRow = this.stmts.canvas.selectMaxSortIndex.get() as {
      max_index: number;
    };
    const sortIndex = maxRow.max_index + 1;

    this.stmts.canvas.insert.run({
      $id: id,
      $name: trimmedName,
      $sortIndex: sortIndex,
    });

    const canvas: Canvas = {
      id,
      name: trimmedName,
      sortIndex,
      passwordHash: null,
    };
    logger.log("Canvas", "Create", `已建立畫布：${trimmedName}`);

    return ok(canvas);
  }

  list(): Canvas[] {
    return (this.stmts.canvas.selectAll.all() as CanvasRow[]).map(rowToCanvas);
  }

  getById(id: string): Canvas | undefined {
    const row = this.stmts.canvas.selectById.get(id) as CanvasRow | undefined;
    if (!row) return undefined;
    return rowToCanvas(row);
  }

  getByName(name: string): Canvas | undefined {
    const row = this.stmts.canvas.selectByName.get(name) as
      | CanvasRow
      | undefined;
    if (!row) return undefined;
    return rowToCanvas(row);
  }

  getNameById(canvasId: string): string {
    const canvas = this.getById(canvasId);
    return canvas?.name ?? canvasId;
  }

  async rename(id: string, newName: string): Promise<Result<Canvas>> {
    const canvas = this.getById(id);
    if (!canvas) {
      return err(createI18nError("errors.canvasNotFound"));
    }

    const trimmedName = newName.trim();

    const validationResult = this.validateCanvasName(trimmedName);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    this.stmts.canvas.updateName.run({ $name: trimmedName, $id: id });

    const oldName = canvas.name;
    const updatedCanvas: Canvas = { ...canvas, name: trimmedName };
    logger.log(
      "Canvas",
      "Rename",
      `已重新命名畫布：${oldName} → ${trimmedName}`,
    );

    return ok(updatedCanvas);
  }

  async delete(id: string): Promise<Result<boolean>> {
    const canvas = this.getById(id);
    if (!canvas) {
      return err(createI18nError("errors.canvasNotFound"));
    }

    this.stmts.canvas.deleteById.run(id);
    logger.log("Canvas", "Delete", `已刪除畫布：${canvas.name}`);

    return ok(true);
  }

  async reorder(canvasIds: string[]): Promise<Result<void>> {
    if (new Set(canvasIds).size !== canvasIds.length) {
      return err(createI18nError("errors.canvasReorderDuplicateIds"));
    }

    for (const id of canvasIds) {
      const row = this.stmts.canvas.selectById.get(id);
      if (!row) {
        return err(createI18nError("errors.canvasNotFound"));
      }
    }

    const transaction = getDb().transaction(() => {
      const allCanvases = this.stmts.canvas.selectAll.all() as CanvasRow[];
      const reorderedSet = new Set(canvasIds);
      const notReordered = allCanvases.filter(
        (canvas) => !reorderedSet.has(canvas.id),
      );
      const reordered = canvasIds.map(
        (canvasId) => allCanvases.find((canvas) => canvas.id === canvasId)!,
      );
      const finalOrder = [...reordered, ...notReordered];
      finalOrder.forEach((canvas, index) => {
        this.stmts.canvas.updateSortIndex.run({
          $id: canvas.id,
          $sortIndex: index,
        });
      });
    });
    transaction();

    logger.log("Canvas", "Reorder", `已重新排序 ${canvasIds.length} 個畫布`);
    return ok(undefined);
  }

  async setPassword(id: string, password: string): Promise<Result<void>> {
    const canvas = this.getById(id);
    if (!canvas) {
      return err(createI18nError("errors.canvasNotFound"));
    }

    const hash = await Bun.password.hash(password);
    this.stmts.canvas.updatePasswordHash.run({ $passwordHash: hash, $id: id });
    logger.log("Canvas", "Update", `已設定畫布密碼：${canvas.name}`);

    return ok(undefined);
  }

  async changePassword(
    id: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<Result<void>> {
    const canvas = this.getById(id);
    if (!canvas) {
      return err(createI18nError("errors.canvasNotFound"));
    }

    if (canvas.passwordHash === null) {
      return err(createI18nError("errors.canvasPasswordNotSet"));
    }

    const isValid = await Bun.password.verify(oldPassword, canvas.passwordHash);
    if (!isValid) {
      return err(createI18nError("errors.canvasOldPasswordWrong"));
    }

    const hash = await Bun.password.hash(newPassword);
    this.stmts.canvas.updatePasswordHash.run({ $passwordHash: hash, $id: id });
    logger.log("Canvas", "Update", `已變更畫布密碼：${canvas.name}`);

    return ok(undefined);
  }

  async removePassword(id: string, password: string): Promise<Result<void>> {
    const canvas = this.getById(id);
    if (!canvas) {
      return err(createI18nError("errors.canvasNotFound"));
    }

    if (canvas.passwordHash === null) {
      return err(createI18nError("errors.canvasPasswordNotSet"));
    }

    const isValid = await Bun.password.verify(password, canvas.passwordHash);
    if (!isValid) {
      return err(createI18nError("errors.canvasPasswordWrong"));
    }

    this.stmts.canvas.updatePasswordHash.run({
      $passwordHash: null,
      $id: id,
    });
    logger.log("Canvas", "Update", `已移除畫布密碼：${canvas.name}`);

    return ok(undefined);
  }

  async verifyPassword(id: string, password: string): Promise<boolean> {
    const canvas = this.getById(id);

    if (!canvas) return false;
    if (canvas.passwordHash === null) return true;

    return Bun.password.verify(password, canvas.passwordHash);
  }

  isLocked(id: string): boolean {
    const canvas = this.getById(id);
    if (!canvas) return false;
    return canvas.passwordHash !== null;
  }

  getCanvasDir(canvasId: string): string | undefined {
    const canvas = this.getById(canvasId);
    if (!canvas) return undefined;
    return config.getCanvasPath(canvas.name);
  }

  getCanvasDataDir(canvasId: string): string | undefined {
    const canvas = this.getById(canvasId);
    if (!canvas) return undefined;
    return config.getCanvasDataPath(canvas.name);
  }

  setActiveCanvas(socketId: string, canvasId: string): void {
    this.activeCanvasMap.set(socketId, canvasId);
  }

  getActiveCanvas(socketId: string): string | undefined {
    return this.activeCanvasMap.get(socketId);
  }

  removeSocket(socketId: string): void {
    this.activeCanvasMap.delete(socketId);
  }
}

export const canvasStore = new CanvasStore();
