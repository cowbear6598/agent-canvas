import {v4 as uuidv4} from 'uuid';
import {promises as fs} from 'fs';
import path from 'path';
import type {Canvas, PersistedCanvas} from '../types';
import {Result, ok, err} from '../types';
import {config} from '../config';
import {logger} from '../utils/logger.js';
import {fsOperation} from '../utils/operationHelpers.js';
import {fileExists} from './shared/fileResourceHelpers.js';
import {safeJsonParse} from '../utils/safeJsonParse.js';

class CanvasStore {
    private canvases: Map<string, Canvas> = new Map();
    private activeCanvasMap: Map<string, string> = new Map();

    private static readonly WINDOWS_RESERVED_NAMES = [
        'CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ];

    private validateCanvasPath(canvasPath: string): Result<void> {
        const resolvedPath = path.resolve(canvasPath);
        const resolvedRoot = path.resolve(config.canvasRoot);
        if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
            logger.error('Canvas', 'Error', `偵測到路徑遍歷攻擊: ${canvasPath}`);
            return err('無效的 Canvas 路徑');
        }
        return ok(undefined);
    }

    private buildPersistedCanvas(canvas: Canvas): PersistedCanvas {
        return {
            id: canvas.id,
            name: canvas.name,
            sortIndex: canvas.sortIndex,
        };
    }

    private validateCanvasName(name: string): Result<void> {
        const trimmedName = name.trim();

        if (!trimmedName) {
            return err('Canvas 名稱不能為空');
        }

        if (trimmedName.length > 50) {
            return err('Canvas 名稱不能超過 50 個字元');
        }

        if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmedName)) {
            return err('Canvas 名稱只能包含英文字母、數字、底線、連字號和空格');
        }

        const upperName = trimmedName.toUpperCase();
        if (CanvasStore.WINDOWS_RESERVED_NAMES.includes(upperName)) {
            return err('Canvas 名稱為系統保留名稱');
        }

        const existingCanvas = Array.from(this.canvases.values()).find(
            (canvas) => canvas.name === trimmedName
        );

        if (existingCanvas) {
            return err('已存在相同名稱的 Canvas');
        }

        return ok(undefined);
    }

    private async persistCanvas(canvas: Canvas): Promise<Result<void>> {
        const canvasPath = config.getCanvasPath(canvas.name);
        const canvasDataPath = config.getCanvasDataPath(canvas.name);
        const canvasJsonPath = path.join(canvasPath, 'canvas.json');

        const pathValidation = this.validateCanvasPath(canvasPath);
        if (!pathValidation.success) {
            return pathValidation;
        }

        return fsOperation(async () => {
            await fs.mkdir(canvasPath, {recursive: true});
            await fs.mkdir(canvasDataPath, {recursive: true});

            const persistedCanvas = this.buildPersistedCanvas(canvas);
            await fs.writeFile(canvasJsonPath, JSON.stringify(persistedCanvas, null, 2), 'utf-8');
        }, `建立 Canvas 檔案失敗: ${canvas.name}`);
    }

    async create(name: string): Promise<Result<Canvas>> {
        const validationResult = this.validateCanvasName(name);
        if (!validationResult.success) {
            return err(validationResult.error);
        }

        const id = uuidv4();
        const trimmedName = name.trim();

        const maxSortIndex = Math.max(0, ...Array.from(this.canvases.values()).map(canvas => canvas.sortIndex));
        const sortIndex = this.canvases.size === 0 ? 0 : maxSortIndex + 1;

        const canvas: Canvas = {
            id,
            name: trimmedName,
            sortIndex,
        };

        const persistResult = await this.persistCanvas(canvas);
        if (!persistResult.success) {
            return err(persistResult.error);
        }

        this.canvases.set(id, canvas);
        logger.log('Canvas', 'Create', `已建立畫布：${trimmedName}`);

        return ok(canvas);
    }

    list(): Canvas[] {
        return Array.from(this.canvases.values()).sort((a, b) => a.sortIndex - b.sortIndex);
    }

    getById(id: string): Canvas | undefined {
        return this.canvases.get(id);
    }

    getByName(name: string): Canvas | undefined {
        return Array.from(this.canvases.values()).find(canvas => canvas.name === name);
    }

    getNameById(canvasId: string): string {
        return this.canvases.get(canvasId)?.name ?? canvasId;
    }

    private validateRenamePaths(canvas: Canvas, trimmedName: string): Result<{ oldPath: string; newPath: string }> {
        const oldPath = config.getCanvasPath(canvas.name);
        const newPath = config.getCanvasPath(trimmedName);

        const oldPathValidation = this.validateCanvasPath(oldPath);
        if (!oldPathValidation.success) {
            return err(oldPathValidation.error);
        }

        const newPathValidation = this.validateCanvasPath(newPath);
        if (!newPathValidation.success) {
            return err(newPathValidation.error);
        }

        return ok({ oldPath, newPath });
    }

    async rename(id: string, newName: string): Promise<Result<Canvas>> {
        const canvas = this.canvases.get(id);
        if (!canvas) {
            return err('找不到 Canvas');
        }

        const trimmedName = newName.trim();

        const validationResult = this.validateCanvasName(trimmedName);
        if (!validationResult.success) {
            return err(validationResult.error);
        }

        const pathsResult = this.validateRenamePaths(canvas, trimmedName);
        if (!pathsResult.success) {
            return err(pathsResult.error);
        }

        const { oldPath, newPath } = pathsResult.data;

        const targetExistsResult = await fsOperation(
            async () => {
                await fs.access(newPath);
                return true;
            },
            '檢查目標路徑失敗'
        );

        if (targetExistsResult.success && targetExistsResult.data) {
            return err('目標路徑已存在');
        }

        const renameResult = await fsOperation(async () => {
            await fs.rename(oldPath, newPath);

            const canvasJsonPath = path.join(newPath, 'canvas.json');
            const updatedCanvas: Canvas = {...canvas, name: trimmedName};
            const persistedCanvas = this.buildPersistedCanvas(updatedCanvas);

            await fs.writeFile(canvasJsonPath, JSON.stringify(persistedCanvas, null, 2), 'utf-8');
        }, `重新命名 Canvas 失敗: ${id}`);

        if (!renameResult.success) {
            return err(renameResult.error);
        }

        const oldName = canvas.name;
        canvas.name = trimmedName;
        this.canvases.set(id, canvas);
        logger.log('Canvas', 'Rename', `已重新命名畫布：${oldName} → ${trimmedName}`);

        return ok(canvas);
    }

    async delete(id: string): Promise<Result<boolean>> {
        const canvas = this.canvases.get(id);
        if (!canvas) {
            return err('找不到 Canvas');
        }

        const canvasPath = config.getCanvasPath(canvas.name);

        const pathValidation = this.validateCanvasPath(canvasPath);
        if (!pathValidation.success) {
            return err(pathValidation.error);
        }

        const deleteResult = await fsOperation(
            async () => {
                await fs.rm(canvasPath, {recursive: true, force: true});
            },
            `刪除 Canvas 失敗: ${id}`
        );

        if (!deleteResult.success) {
            return err(deleteResult.error);
        }

        this.canvases.delete(id);
        logger.log('Canvas', 'Delete', `已刪除畫布：${canvas.name}`);

        return ok(true);
    }

    async reorder(canvasIds: string[]): Promise<Result<void>> {
        if (new Set(canvasIds).size !== canvasIds.length) {
            return err('Canvas IDs 包含重複項目');
        }

        for (const id of canvasIds) {
            if (!this.canvases.has(id)) {
                return err(`找不到 Canvas: ${id}`);
            }
        }

        const reorderResult = await fsOperation(async () => {
            const allCanvases = Array.from(this.canvases.values()).sort((a, b) => a.sortIndex - b.sortIndex);
            const reorderedSet = new Set(canvasIds);

            const notReordered = allCanvases.filter(canvas => !reorderedSet.has(canvas.id));
            const reordered = canvasIds.map(id => this.canvases.get(id)!);

            const finalOrder = [...reordered, ...notReordered];

            for (let i = 0; i < finalOrder.length; i++) {
                const canvas = finalOrder[i];
                canvas.sortIndex = i;

                const canvasJsonPath = path.join(config.getCanvasPath(canvas.name), 'canvas.json');
                const persistedCanvas = this.buildPersistedCanvas(canvas);

                await fs.writeFile(canvasJsonPath, JSON.stringify(persistedCanvas, null, 2), 'utf-8');
            }
        }, '重新排序 Canvas 失敗');

        if (!reorderResult.success) {
            return err(reorderResult.error);
        }

        logger.log('Canvas', 'Reorder', `已重新排序 ${canvasIds.length} 個畫布`);
        return ok(undefined);
    }

    private async loadSingleCanvas(dirName: string): Promise<Canvas | null> {
        const canvasJsonPath = path.join(config.canvasRoot, dirName, 'canvas.json');

        const exists = await fileExists(canvasJsonPath);
        if (!exists) {
            return null;
        }

        const readResult = await fsOperation(
            () => fs.readFile(canvasJsonPath, 'utf-8'),
            `讀取 canvas.json 失敗: ${dirName}`
        );

        if (!readResult.success) {
            return null;
        }

        const persistedCanvas = safeJsonParse<PersistedCanvas>(readResult.data);

        if (!persistedCanvas) {
            logger.error('Canvas', 'Load', `解析 ${dirName} 的 canvas.json 失敗`);
            return null;
        }

        if (persistedCanvas.sortIndex === undefined) {
            logger.error('Canvas', 'Load', `${dirName} 的 canvas.json 缺少 sortIndex`);
            return null;
        }

        return {
            id: persistedCanvas.id,
            name: persistedCanvas.name,
            sortIndex: persistedCanvas.sortIndex,
        };
    }

    async loadFromDisk(): Promise<Result<void>> {
        const loadResult = await fsOperation(async () => {
            await fs.mkdir(config.canvasRoot, {recursive: true});

            const entries = await fs.readdir(config.canvasRoot, {withFileTypes: true});
            const directories = entries.filter((entry) => entry.isDirectory());

            const loadPromises = directories.map((dir) => this.loadSingleCanvas(dir.name));
            const results = await Promise.allSettled(loadPromises);

            const canvases: Canvas[] = [];
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value !== null) {
                    canvases.push(result.value);
                }
            }

            return canvases;
        }, '載入 Canvas 列表失敗');

        if (!loadResult.success) {
            return err(loadResult.error);
        }

        if (!loadResult.data) {
            return err('載入 Canvas 列表失敗');
        }

        this.canvases.clear();
        for (const canvas of loadResult.data) {
            this.canvases.set(canvas.id, canvas);
        }

        logger.log('Canvas', 'Load', `已載入 ${this.canvases.size} 個畫布`);
        return ok(undefined);
    }

    getCanvasDir(canvasId: string): string | undefined {
        const canvas = this.canvases.get(canvasId);
        if (!canvas) {
            return undefined;
        }
        return config.getCanvasPath(canvas.name);
    }

    getCanvasDataDir(canvasId: string): string | undefined {
        const canvas = this.canvases.get(canvasId);
        if (!canvas) {
            return undefined;
        }
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
