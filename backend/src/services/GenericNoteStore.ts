import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/index.js';
import { getStatements } from '../database/statements.js';
import { safeJsonParse } from '../utils/safeJsonParse.js';

export interface BaseNote {
  id: string;
  name: string;
  x: number;
  y: number;
  boundToPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

interface NoteRow {
  id: string;
  canvas_id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  bound_to_pod_id: string | null;
  original_position_json: string | null;
  foreign_key_id: string | null;
}

interface GenericNoteStoreConfig<T, K extends keyof T> {
  noteType: string;
  foreignKeyField: K;
  storeName: string;
}

export class GenericNoteStore<T extends BaseNote, K extends keyof T> {
  private readonly noteConfig: GenericNoteStoreConfig<T, K>;

  constructor(storeConfig: GenericNoteStoreConfig<T, K>) {
    this.noteConfig = storeConfig;
  }

  private get stmts(): ReturnType<typeof getStatements> {
    return getStatements(getDb());
  }

  private rowToNote(row: NoteRow): T {
    const note: BaseNote = {
      id: row.id,
      name: row.name,
      x: row.x,
      y: row.y,
      boundToPodId: row.bound_to_pod_id,
      originalPosition: row.original_position_json ? safeJsonParse<{ x: number; y: number }>(row.original_position_json) : null,
    };

    (note as unknown as Record<string, unknown>)[this.noteConfig.foreignKeyField as string] = row.foreign_key_id ?? '';

    return note as T;
  }

  create(canvasId: string, data: Omit<T, 'id'>): T {
    const id = uuidv4();
    const baseData = data as unknown as BaseNote;
    const foreignKeyValue = (data as Record<string, unknown>)[this.noteConfig.foreignKeyField as string] as string ?? null;

    this.stmts.note.insert.run({
      $id: id,
      $canvasId: canvasId,
      $type: this.noteConfig.noteType,
      $name: baseData.name,
      $x: baseData.x,
      $y: baseData.y,
      $boundToPodId: baseData.boundToPodId,
      $originalPositionJson: baseData.originalPosition ? JSON.stringify(baseData.originalPosition) : null,
      $foreignKeyId: foreignKeyValue,
    });

    return { id, ...data } as T;
  }

  getById(canvasId: string, id: string): T | undefined {
    const row = this.stmts.note.selectById.get(id) as NoteRow | undefined;

    if (!row || row.type !== this.noteConfig.noteType || row.canvas_id !== canvasId) {
      return undefined;
    }

    return this.rowToNote(row);
  }

  list(canvasId: string): T[] {
    const rows = this.stmts.note.selectByCanvasIdAndType.all({
      $canvasId: canvasId,
      $type: this.noteConfig.noteType,
    }) as NoteRow[];

    return rows.map((row) => this.rowToNote(row));
  }

  update(canvasId: string, id: string, updates: Partial<Omit<T, 'id'>>): T | undefined {
    const existing = this.getById(canvasId, id);
    if (!existing) {
      return undefined;
    }

    const merged = { ...existing, ...updates } as T;
    const foreignKeyValue = (merged as Record<string, unknown>)[this.noteConfig.foreignKeyField as string] as string ?? null;

    this.stmts.note.update.run({
      $id: id,
      $name: merged.name,
      $x: merged.x,
      $y: merged.y,
      $boundToPodId: merged.boundToPodId,
      $originalPositionJson: merged.originalPosition ? JSON.stringify(merged.originalPosition) : null,
      $foreignKeyId: foreignKeyValue,
    });

    return merged;
  }

  delete(canvasId: string, id: string): boolean {
    const existing = this.getById(canvasId, id);
    if (!existing) {
      return false;
    }

    const result = this.stmts.note.deleteById.run(id);

    return result.changes > 0;
  }

  findByBoundPodId(canvasId: string, podId: string): T[] {
    const rows = this.stmts.note.selectByBoundPodId.all({
      $canvasId: canvasId,
      $type: this.noteConfig.noteType,
      $boundToPodId: podId,
    }) as NoteRow[];

    return rows.map((row) => this.rowToNote(row));
  }

  deleteByBoundPodId(canvasId: string, podId: string): string[] {
    const notes = this.findByBoundPodId(canvasId, podId);
    const ids = notes.map((n) => n.id);

    if (ids.length === 0) {
      return [];
    }

    this.stmts.note.deleteByBoundPodId.run({
      $canvasId: canvasId,
      $type: this.noteConfig.noteType,
      $boundToPodId: podId,
    });

    return ids;
  }

  deleteByForeignKey(canvasId: string, foreignKeyValue: string): string[] {
    const rows = this.stmts.note.selectByForeignKeyId.all({
      $canvasId: canvasId,
      $type: this.noteConfig.noteType,
      $foreignKeyId: foreignKeyValue,
    }) as NoteRow[];

    const ids = rows.map((r) => r.id);

    if (ids.length === 0) {
      return [];
    }

    this.stmts.note.deleteByForeignKeyId.run({
      $canvasId: canvasId,
      $type: this.noteConfig.noteType,
      $foreignKeyId: foreignKeyValue,
    });

    return ids;
  }

}

export function createNoteStore<T extends BaseNote, K extends keyof T>(
  config: GenericNoteStoreConfig<T, K>
): GenericNoteStore<T, K> {
  return new GenericNoteStore(config);
}
