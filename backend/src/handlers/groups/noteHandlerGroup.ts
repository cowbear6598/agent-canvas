import { WebSocketRequestEvents, WebSocketResponseEvents } from '../../schemas';
import {
  noteCreateSchema,
  noteListSchema,
  noteUpdateSchema,
  noteDeleteSchema,
} from '../../schemas';
import { noteHandlers } from '../noteHandlers.js';
import { createHandlerGroup } from './createHandlerGroup.js';

export const noteHandlerGroup = createHandlerGroup({
  name: 'note',
  handlers: [
    {
      event: WebSocketRequestEvents.NOTE_CREATE,
      handler: noteHandlers.handleNoteCreate,
      schema: noteCreateSchema,
      responseEvent: WebSocketResponseEvents.NOTE_CREATED,
    },
    {
      event: WebSocketRequestEvents.NOTE_LIST,
      handler: noteHandlers.handleNoteList,
      schema: noteListSchema,
      responseEvent: WebSocketResponseEvents.NOTE_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.NOTE_UPDATE,
      handler: noteHandlers.handleNoteUpdate,
      schema: noteUpdateSchema,
      responseEvent: WebSocketResponseEvents.NOTE_UPDATED,
    },
    {
      event: WebSocketRequestEvents.NOTE_DELETE,
      handler: noteHandlers.handleNoteDelete,
      schema: noteDeleteSchema,
      responseEvent: WebSocketResponseEvents.NOTE_DELETED,
    },
  ],
});
