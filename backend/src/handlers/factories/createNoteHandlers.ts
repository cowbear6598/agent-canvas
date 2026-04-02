import type { GenericNoteStore, BaseNote } from '../../services/GenericNoteStore.js';
import type { WebSocketResponseEvents } from '../../schemas';
import { socketService } from '../../services/socketService.js';
import { emitError, emitNotFound } from '../../utils/websocketResponse.js';
import { createI18nError } from '../../utils/i18nError.js';
import { logger } from '../../utils/logger.js';
import { withCanvasId } from '../../utils/handlerHelpers.js';

interface NoteHandlerConfig<TNote extends BaseNote, TForeignKey extends string> {
  noteStore: GenericNoteStore<TNote, keyof TNote>;
  events: {
    created: WebSocketResponseEvents;
    listResult: WebSocketResponseEvents;
    updated: WebSocketResponseEvents;
    deleted: WebSocketResponseEvents;
  };
  foreignKeyField: TForeignKey;
  entityName: string;
  logOperations?: boolean;
  validateBeforeCreate?: (foreignKeyValue: string) => Promise<boolean>;
}

export interface CreateNoteBasePayload {
  name: string;
  x: number;
  y: number;
  boundToPodId?: string | null;
  originalPosition?: { x: number; y: number } | null;
}

export type CreateNotePayload<TForeignKey extends string = string> = CreateNoteBasePayload & Record<TForeignKey, string>;

export interface ListNotePayload {
  canvasId: string;
  requestId: string;
}

export interface UpdateNotePayload {
  noteId: string;
  x?: number;
  y?: number;
  boundToPodId?: string | null;
  originalPosition?: { x: number; y: number } | null;
}

export interface DeleteNotePayload {
  noteId: string;
}

interface BaseNoteResponse {
  requestId: string;
  canvasId: string;
  success: true;
}


export function createNoteHandlers<TNote extends BaseNote, TForeignKey extends string>(
  config: NoteHandlerConfig<TNote, TForeignKey>
): {
  handleNoteCreate: (connectionId: string, payload: CreateNotePayload<TForeignKey>, requestId: string) => Promise<void>;
  handleNoteList: (connectionId: string, payload: ListNotePayload, requestId: string) => Promise<void>;
  handleNoteUpdate: (connectionId: string, payload: UpdateNotePayload, requestId: string) => Promise<void>;
  handleNoteDelete: (connectionId: string, payload: DeleteNotePayload, requestId: string) => Promise<void>;
} {
  const { noteStore, events, foreignKeyField, entityName } = config;

  const handleNoteCreate = withCanvasId<CreateNotePayload<TForeignKey>>(
    events.created,
    async (connectionId: string, canvasId: string, payload: CreateNotePayload<TForeignKey>, requestId: string): Promise<void> => {
      const { name, x, y, boundToPodId, originalPosition } = payload;
      const foreignKeyValue = payload[foreignKeyField];

      if (config.validateBeforeCreate) {
        const isValid = await config.validateBeforeCreate(foreignKeyValue);
        if (!isValid) {
          emitNotFound(connectionId, events.created, entityName, foreignKeyValue, requestId);
          return;
        }
      }

      const createData = {
        [foreignKeyField]: foreignKeyValue,
        name,
        x,
        y,
        boundToPodId: boundToPodId ?? null,
        originalPosition: originalPosition ?? null,
      } as Omit<TNote, 'id'>;

      const note = noteStore.create(canvasId, createData);

      const response: BaseNoteResponse & { note: TNote } = {
        requestId,
        canvasId,
        success: true,
        note,
      };

      socketService.emitToCanvas(canvasId, events.created, response);

      if (config.logOperations) {
        logger.log('Note', 'Create', `已建立 Note「${note.name}」`);
      }
    }
  );

  const handleNoteList = withCanvasId<ListNotePayload>(
    events.listResult,
    async (connectionId: string, canvasId: string, _payload: ListNotePayload, requestId: string): Promise<void> => {
      const notes = noteStore.list(canvasId);

      const response: BaseNoteResponse & { notes: TNote[] } = {
        requestId,
        canvasId,
        success: true,
        notes,
      };

      socketService.emitToConnection(connectionId, events.listResult, response);
    }
  );

  const handleNoteUpdate = withCanvasId<UpdateNotePayload>(
    events.updated,
    async (connectionId: string, canvasId: string, payload: UpdateNotePayload, requestId: string): Promise<void> => {
      const { noteId, x, y, boundToPodId, originalPosition } = payload;

      const existingNote = noteStore.getById(canvasId, noteId);
      if (!existingNote) {
        emitNotFound(connectionId, events.updated, 'Note', noteId, requestId);
        return;
      }

      const updates: Partial<Pick<UpdateNotePayload, 'x' | 'y' | 'boundToPodId' | 'originalPosition'>> = {};
      if (x !== undefined) updates.x = x;
      if (y !== undefined) updates.y = y;
      if (boundToPodId !== undefined) updates.boundToPodId = boundToPodId;
      if (originalPosition !== undefined) updates.originalPosition = originalPosition;

      const updatedNote = noteStore.update(canvasId, noteId, updates as Partial<Omit<TNote, 'id'>>);

      if (!updatedNote) {
        emitError(
          connectionId,
          events.updated,
          createI18nError('errors.noteUpdateFailed', { id: noteId }),
          requestId,
          undefined,
          'INTERNAL_ERROR'
        );
        return;
      }

      const response: BaseNoteResponse & { note: TNote } = {
        requestId,
        canvasId,
        success: true,
        note: updatedNote,
      };

      socketService.emitToCanvas(canvasId, events.updated, response);
    }
  );

  const handleNoteDelete = withCanvasId<DeleteNotePayload>(
    events.deleted,
    async (connectionId: string, canvasId: string, payload: DeleteNotePayload, requestId: string): Promise<void> => {
      const { noteId } = payload;

      const note = noteStore.getById(canvasId, noteId);
      if (!note) {
        emitNotFound(connectionId, events.deleted, 'Note', noteId, requestId);
        return;
      }

      const deleted = noteStore.delete(canvasId, noteId);

      if (!deleted) {
        emitError(
          connectionId,
          events.deleted,
          createI18nError('errors.noteDeleteFailed', { id: noteId }),
          requestId,
          undefined,
          'INTERNAL_ERROR'
        );
        return;
      }

      const response: BaseNoteResponse & { noteId: string } = {
        requestId,
        canvasId,
        success: true,
        noteId,
      };

      socketService.emitToCanvas(canvasId, events.deleted, response);

      if (config.logOperations) {
        logger.log('Note', 'Delete', `已刪除 Note「${note.name}」`);
      }
    }
  );

  return {
    handleNoteCreate,
    handleNoteList,
    handleNoteUpdate,
    handleNoteDelete,
  };
}
