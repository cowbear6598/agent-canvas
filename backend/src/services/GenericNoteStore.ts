import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import { Result, ok, err } from '../types';
import { logger } from '../utils/logger.js';
import { canvasStore } from './canvasStore.js';
import { persistenceService } from './persistence/index.js';
import { readJsonFileOrDefault } from './shared/fileResourceHelpers.js';
import { CanvasMapStore } from './shared/CanvasMapStore.js';
import { CanvasWriterHelper } from './shared/PersistenceHelper.js';

export interface BaseNote {
  id: string;
  name: string;
  x: number;
  y: number;
  boundToPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

interface GenericNoteStoreConfig<T, K extends keyof T> {
  fileName: string;
  foreignKeyField: K;
  storeName: string;
}

export class GenericNoteStore<T extends BaseNote, K extends keyof T> extends CanvasMapStore<T> {
  protected readonly config: GenericNoteStoreConfig<T, K>;
  private readonly canvasWriter: CanvasWriterHelper;

  constructor(storeConfig: GenericNoteStoreConfig<T, K>) {
    super();
    this.config = storeConfig;
    this.canvasWriter = new CanvasWriterHelper('Note', this.config.storeName);
  }

  create(canvasId: string, data: Omit<T, 'id'>): T {
    const id = uuidv4();

    const note = {
      id,
      ...data,
    } as T;

    const notesMap = this.getOrCreateCanvasMap(canvasId);
    notesMap.set(id, note);
    this.saveToDiskAsync(canvasId);

    return note;
  }

  update(canvasId: string, id: string, updates: Partial<Omit<T, 'id'>>): T | undefined {
    const notesMap = this.dataByCanvas.get(canvasId);
    if (!notesMap) {
      return undefined;
    }

    const note = notesMap.get(id);
    if (!note) {
      return undefined;
    }

    const updatedNote = { ...note, ...updates };
    notesMap.set(id, updatedNote);
    this.saveToDiskAsync(canvasId);

    return updatedNote;
  }

  delete(canvasId: string, id: string): boolean {
    const notesMap = this.dataByCanvas.get(canvasId);
    if (!notesMap) {
      return false;
    }

    const deleted = notesMap.delete(id);
    if (deleted) {
      this.saveToDiskAsync(canvasId);
    }
    return deleted;
  }

  findByBoundPodId(canvasId: string, podId: string): T[] {
    return this.findByPredicate(canvasId, (note) => note.boundToPodId === podId);
  }

  deleteByBoundPodId(canvasId: string, podId: string): string[] {
    return this.deleteByPredicate(canvasId, (note) => note.boundToPodId === podId);
  }

  deleteByForeignKey(canvasId: string, foreignKeyValue: string): string[] {
    return this.deleteByPredicate(canvasId, (note) => note[this.config.foreignKeyField] === foreignKeyValue);
  }

  private deleteByPredicate(canvasId: string, predicate: (note: T) => boolean): string[] {
    const notesMap = this.dataByCanvas.get(canvasId);
    if (!notesMap) {
      return [];
    }

    const deletedIds: string[] = [];
    for (const note of notesMap.values()) {
      if (!predicate(note)) continue;
      notesMap.delete(note.id);
      deletedIds.push(note.id);
    }

    if (deletedIds.length > 0) {
      this.saveToDiskAsync(canvasId);
    }

    return deletedIds;
  }

  async loadFromDisk(canvasId: string, canvasDataDir: string): Promise<Result<void>> {
    const notesFilePath = path.join(canvasDataDir, this.config.fileName);

    await fs.mkdir(canvasDataDir, { recursive: true });

    const notesArray = await readJsonFileOrDefault<T>(notesFilePath);
    if (notesArray === null) {
      this.dataByCanvas.set(canvasId, new Map());
      return ok(undefined);
    }

    const notesMap = new Map<string, T>();
    for (const note of notesArray) {
      notesMap.set(note.id, note);
    }

    this.dataByCanvas.set(canvasId, notesMap);

    const canvasName = canvasStore.getNameById(canvasId);
    logger.log('Note', 'Load', `[${this.config.storeName}] 已載入 ${notesMap.size} 個筆記，畫布 ${canvasName}`);
    return ok(undefined);
  }

  async saveToDisk(canvasId: string): Promise<Result<void>> {
    const canvasDataDir = canvasStore.getCanvasDataDir(canvasId);
    if (!canvasDataDir) {
      return err('找不到 Canvas');
    }

    const notesFilePath = path.join(canvasDataDir, this.config.fileName);

    const notesMap = this.dataByCanvas.get(canvasId);
    const notesArray = notesMap ? Array.from(notesMap.values()) : [];
    return persistenceService.writeJson(notesFilePath, notesArray);
  }

  saveToDiskAsync(canvasId: string): void {
    this.canvasWriter.scheduleSave(canvasId, () => this.saveToDisk(canvasId));
  }

  flushWrites(canvasId: string): Promise<void> {
    return this.canvasWriter.flush(canvasId);
  }
}

export function createNoteStore<T extends BaseNote, K extends keyof T>(
  config: GenericNoteStoreConfig<T, K>
): GenericNoteStore<T, K> {
  return new GenericNoteStore(config);
}
