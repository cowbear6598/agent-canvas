import { WebSocketRequestEvents, WebSocketResponseEvents } from '../../schemas';
import {
  noteCreateSchema,
  noteListSchema,
  noteUpdateSchema,
  noteDeleteSchema,
} from '../../schemas';
import { noteHandlers } from '../noteHandlers.js';
import { createHandlerGroup, createNoteHandlerGroupEntries } from './createHandlerGroup.js';

export const noteHandlerGroup = createHandlerGroup({
  name: 'note',
  handlers: [
    ...createNoteHandlerGroupEntries(
      noteHandlers,
      { create: noteCreateSchema, list: noteListSchema, update: noteUpdateSchema, delete: noteDeleteSchema },
      {
        create: WebSocketRequestEvents.NOTE_CREATE,
        list: WebSocketRequestEvents.NOTE_LIST,
        update: WebSocketRequestEvents.NOTE_UPDATE,
        delete: WebSocketRequestEvents.NOTE_DELETE,
        created: WebSocketResponseEvents.NOTE_CREATED,
        listResult: WebSocketResponseEvents.NOTE_LIST_RESULT,
        updated: WebSocketResponseEvents.NOTE_UPDATED,
        deleted: WebSocketResponseEvents.NOTE_DELETED,
      }
    ),
  ],
});
